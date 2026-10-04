import type { ScienceResidue, ScienceVariant } from '../science.js';
import type { Intervention, ModelNode } from '../types.js';
import { computeB2GeneticEdit, translate, translateCodon } from './b2GeneticEdit.js';
import type { B2Output, B2Phenotype } from './outputs.js';

export const B2_BODY_MODEL = 'b2-oxygen-delivery';
export const B2_BODY_VERSION = '1.0.0';

export const B2_BODY_ASSUMPTIONS = [
  'Educational model only — no clinical, efficacy or patient-specific claims.',
  'Zygosity is a declared assumption: "both alleles" applies the edit to both HBB copies; "one allele" makes a carrier (≈40% variant haemoglobin).',
  'Variant haemoglobin fraction → sickled-cell fraction under low oxygen follows a declared threshold rule (no sickling below the threshold).',
  'Steady-state haemoglobin falls linearly with sickled fraction toward a declared severe-anaemia value (haemolysis shortens red-cell life).',
  'Relative O₂ delivery = (Hb / Hb_normal) × (1 − microvascular occlusion × sickled fraction) × cardiac compensation (declared, capped).',
  'Free base edits are classified from the translated protein: synonymous (no effect), curated missense (β6 Glu→Val/Lys), nonsense or lost start (no β-globin); any other missense has no curated rule and is assumed to have no downstream effect (flagged).',
  'Population outcome: the edited genotype applies to the declared fraction of the community; everyone else keeps the reference sequence.',
];

export interface B2Mutation {
  interventionId: string;
  position: number;
  ref: string;
  alt: string;
  codon: number;
  codonBefore: string;
  codonAfter: string;
  aaBefore: string;
  aaAfter: string;
  /** synonymous | missense | nonsense | start_lost | no_change */
  effect: string;
  label: string;
}

export interface B2Population {
  size: number;
  editedFraction: number;
  editedCount: number;
  meanOxygenDelivery: number;
  symptomatic: number;
  carriers: number;
}

export interface B2BodyView {
  edit: B2Output | null;
  edits: { interventionId: string; label: string; applied: boolean }[];
  variantFraction: number;
  sickledFraction: number;
  hemoglobinGdl: number;
  hemoglobinNormalGdl: number;
  cardiacOutputFactor: number;
  oxygenDeliveryRelative: number;
  tissueOxygenation: number;
  phenotype: B2Phenotype;
  zygosity: string;
  /** Current (edited) coding sequence and the reference, for the gene editor. */
  cds: string;
  referenceCds: string;
  protein: string;
  mutations: B2Mutation[];
  population: B2Population;
}

export interface B2BodyInputs {
  interventions: Intervention[];
  referenceCds: string;
  transcript: string;
  variants: ScienceVariant[];
  residues: ScienceResidue[];
  betaChains: Record<string, string[]>;
  mechanismRule: 'qualitative_hb_rules' | 'sequence_only';
  zygosity: 'both' | 'one';
  sicklingThreshold: number;
  maxSickledFraction: number;
  hbNormal: number;
  hbSevere: number;
  occlusionFactor: number;
  compensationMax: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function computeB2Body(inp: B2BodyInputs): { view: B2BodyView; nodes: ModelNode[]; warnings: string[] } {
  const warnings: string[] = [];
  let cds = inp.referenceCds;
  let last: B2Output | null = null;
  const edits: B2BodyView['edits'] = [];
  const mutations: B2Mutation[] = [];
  for (const iv of inp.interventions.filter((i) => i.kind === 'b2.edit' || i.kind === 'b2.base_edit').sort((a, b) => a.createdSeq - b.createdSeq)) {
    if (iv.kind === 'b2.base_edit') {
      const pos = Math.round(Number(iv.params.position ?? 0));
      const alt = String(iv.params.alt ?? 'T').toUpperCase();
      if (pos < 1 || pos > cds.length) {
        warnings.push(`${iv.label}: position ${pos} is outside the ${cds.length}-nt coding sequence.`);
        edits.push({ interventionId: iv.id, label: iv.label, applied: false });
        continue;
      }
      const ref = cds[pos - 1]!;
      const k = Math.floor((pos - 1) / 3);
      const before = cds.slice(k * 3, k * 3 + 3);
      const nextCds = cds.slice(0, pos - 1) + alt + cds.slice(pos);
      const after = nextCds.slice(k * 3, k * 3 + 3);
      const aaB = translateCodon(before);
      const aaA = translateCodon(after);
      const effect = ref === alt ? 'no_change' : aaB === aaA ? 'synonymous' : k === 0 && aaB === 'M' ? 'start_lost' : aaA === '*' ? 'nonsense' : 'missense';
      mutations.push({ interventionId: iv.id, position: pos, ref, alt, codon: k + 1, codonBefore: before, codonAfter: after, aaBefore: aaB, aaAfter: aaA, effect, label: `c.${pos}${ref}>${alt} · p.${aaB}${k + 1}${aaA}` });
      cds = nextCds;
      edits.push({ interventionId: iv.id, label: iv.label, applied: ref !== alt });
      continue;
    }
    const variant = inp.variants.find((v) => v.rsId === iv.params.variantRsId) ?? null;
    const out = computeB2GeneticEdit({
      referenceCds: inp.referenceCds,
      currentCds: cds,
      transcript: inp.transcript,
      operation: (iv.params.operation as 'introduce' | 'repair') ?? 'introduce',
      variant,
      residues: inp.residues,
      betaChains: inp.betaChains,
      mechanismRule: inp.mechanismRule,
    });
    if (out.applied) cds = out.afterCds;
    else warnings.push(`${iv.label}: ${out.validationMessage}`);
    edits.push({ interventionId: iv.id, label: iv.label, applied: out.applied });
    last = out;
  }
  // Phenotype of the *current* sequence (after all edits), independent of the last operation.
  const ref = translate(inp.referenceCds);
  const now = translate(cds);
  const sickle = ref[6] === 'E' && now[6] === 'V';
  const stopGained = (now.indexOf('*') >= 0 && now.indexOf('*') < ref.length - 1) || now[0] !== 'M';
  const crystal = ref[6] === 'E' && now[6] === 'K';
  const phenotype: B2Phenotype = sickle ? 'sickle' : stopGained ? 'absent_beta' : crystal ? 'crystal' : now === ref ? 'normal' : 'unknown';
  const perAllele = inp.zygosity === 'both' ? 1 : 0.4;
  const variantFraction = phenotype === 'normal' ? 0 : perAllele;
  const sickledFraction = sickle
    ? clamp(((variantFraction - inp.sicklingThreshold) / (1 - inp.sicklingThreshold)) * inp.maxSickledFraction, 0, inp.maxSickledFraction)
    : 0;
  const severity = sickle ? sickledFraction / inp.maxSickledFraction : stopGained && inp.zygosity === 'both' ? 1 : stopGained ? 0.15 : 0;
  const hb = inp.hbNormal - (inp.hbNormal - inp.hbSevere) * severity;
  const deficit = 1 - hb / inp.hbNormal;
  const compensation = 1 + Math.min(inp.compensationMax - 1, deficit * 1.2);
  const delivery = clamp((hb / inp.hbNormal) * (1 - inp.occlusionFactor * sickledFraction) * compensation, 0, 1.5);
  const tissue = clamp(delivery, 0, 1);
  if (phenotype === 'unknown') warnings.push('No curated rule for this sequence change; downstream outputs assume no effect.');
  // Population: the edited genotype applies to a declared fraction of the community.
  const popIv = inp.interventions.find((i) => i.kind === 'b2.population');
  const size = Math.max(1, Math.round(Number(popIv?.params.size ?? 1)));
  const f = clamp(Number(popIv?.params.editedFraction ?? 1), 0, 1);
  const severe = (sickle && sickledFraction > 0.05) || (stopGained && inp.zygosity === 'both');
  const population: B2Population = {
    size, editedFraction: f, editedCount: Math.round(size * f), meanOxygenDelivery: f * delivery + (1 - f) * 1,
    symptomatic: severe ? Math.round(size * f) : 0, carriers: phenotype !== 'normal' && inp.zygosity === 'one' ? Math.round(size * f) : 0,
  };
  const view: B2BodyView = {
    edit: last, edits, variantFraction, sickledFraction, hemoglobinGdl: hb, hemoglobinNormalGdl: inp.hbNormal,
    cardiacOutputFactor: compensation, oxygenDeliveryRelative: delivery, tissueOxygenation: tissue, phenotype, zygosity: inp.zygosity,
    cds, referenceCds: inp.referenceCds, protein: now, mutations, population,
  };
  const q = (value: number | string | boolean, unit: string) => ({ value, unit });
  const nodes: ModelNode[] = [
    { id: 'b2.sequence', label: 'Gene sequence (HBB CDS)', modelId: 'b2-genetic-edit', version: '2.1.0', dependsOn: [],
      inputs: { edits: q(edits.length, 'count'), transcript: q(inp.transcript, ''), baseEdits: q(mutations.map((m) => m.label).join('; ') || 'none', '') },
      outputs: { codon7: q(cds.slice(18, 21), 'codon'), changed: q(cds !== inp.referenceCds, 'bool') }, evidence: 'simulated', assumptions: ['Reference base validated before each edit.'] },
    { id: 'b2.protein', label: 'β-globin protein', modelId: 'standard-genetic-code', version: '1.0.0', dependsOn: ['b2.sequence'],
      inputs: { codon7: q(cds.slice(18, 21), 'codon') }, outputs: { residue6: q(now[6] ?? '?', 'aa'), phenotypeRule: q(phenotype, '') }, evidence: 'derived', assumptions: ['Translation only; folding not predicted.'] },
    { id: 'b2.haemoglobin', label: 'Haemoglobin population', modelId: B2_BODY_MODEL, version: B2_BODY_VERSION, dependsOn: ['b2.protein'],
      inputs: { zygosity: q(inp.zygosity, '') }, outputs: { variantFraction: q(variantFraction, '1') }, evidence: 'assumed', assumptions: [B2_BODY_ASSUMPTIONS[1]!] },
    { id: 'b2.rbc', label: 'Red-cell behaviour', modelId: B2_BODY_MODEL, version: B2_BODY_VERSION, dependsOn: ['b2.haemoglobin'],
      inputs: { variantFraction: q(variantFraction, '1'), threshold: q(inp.sicklingThreshold, '1') }, outputs: { sickledFraction: q(sickledFraction, '1') }, evidence: 'assumed', assumptions: [B2_BODY_ASSUMPTIONS[2]!] },
    { id: 'b2.blood', label: 'Blood haemoglobin', modelId: B2_BODY_MODEL, version: B2_BODY_VERSION, dependsOn: ['b2.rbc'],
      inputs: { sickledFraction: q(sickledFraction, '1') }, outputs: { hemoglobin: q(hb, 'g/dL') }, evidence: 'assumed', assumptions: [B2_BODY_ASSUMPTIONS[3]!] },
    { id: 'b2.oxygen', label: 'Body O₂ delivery', modelId: B2_BODY_MODEL, version: B2_BODY_VERSION, dependsOn: ['b2.blood', 'b2.rbc'],
      inputs: { hemoglobin: q(hb, 'g/dL'), occlusion: q(inp.occlusionFactor, '1') },
      outputs: { oxygenDelivery: q(delivery, '× baseline'), cardiacOutput: q(compensation, '× baseline') }, evidence: 'simulated', assumptions: [B2_BODY_ASSUMPTIONS[0]!, B2_BODY_ASSUMPTIONS[4]!] },
    { id: 'b2.population', label: 'Population health', modelId: B2_BODY_MODEL, version: B2_BODY_VERSION, dependsOn: ['b2.oxygen'],
      inputs: { size: q(size, 'people'), editedFraction: q(f, '1') },
      outputs: { meanO2: q(population.meanOxygenDelivery, '× baseline'), symptomatic: q(population.symptomatic, 'people'), carriers: q(population.carriers, 'people') }, evidence: 'simulated', assumptions: [B2_BODY_ASSUMPTIONS[6]!] },
  ];
  return { view, nodes, warnings };
}


