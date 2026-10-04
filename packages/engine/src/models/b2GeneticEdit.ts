import type { ScienceResidue, ScienceVariant } from '../science.js';
import type { B2MechanismStep, B2Output, B2Phenotype } from './outputs.js';

export const B2_MODEL_ID = 'b2-genetic-edit';
export const B2_MODEL_VERSION = '2.0.0';

export const B2_ASSUMPTIONS = [
  'Edits are single-nucleotide substitutions on the RefSeq MANE CDS (NM_000518); the reference base must match before the edit is applied.',
  'HGVS protein numbering counts the initiator Met; crystal structures (4HHB, 2HBS) use mature numbering, so residue = codon − 1. The mapping is checked against the structure before highlighting.',
  'Cell-level effects follow a declared qualitative rule table (HbS polymerisation, HbC crystallisation, HbE instability, β⁰ nonsense). They are educational labels — not clinical predictions, probabilities or treatment claims.',
  'Delivery, mosaicism, off-target editing, splicing and regulatory effects are not modelled.',
];

const CODON: Record<string, string> = {
  TTT: 'Phe', TTC: 'Phe', TTA: 'Leu', TTG: 'Leu', CTT: 'Leu', CTC: 'Leu', CTA: 'Leu', CTG: 'Leu',
  ATT: 'Ile', ATC: 'Ile', ATA: 'Ile', ATG: 'Met', GTT: 'Val', GTC: 'Val', GTA: 'Val', GTG: 'Val',
  TCT: 'Ser', TCC: 'Ser', TCA: 'Ser', TCG: 'Ser', CCT: 'Pro', CCC: 'Pro', CCA: 'Pro', CCG: 'Pro',
  ACT: 'Thr', ACC: 'Thr', ACA: 'Thr', ACG: 'Thr', GCT: 'Ala', GCC: 'Ala', GCA: 'Ala', GCG: 'Ala',
  TAT: 'Tyr', TAC: 'Tyr', TAA: 'Ter', TAG: 'Ter', CAT: 'His', CAC: 'His', CAA: 'Gln', CAG: 'Gln',
  AAT: 'Asn', AAC: 'Asn', AAA: 'Lys', AAG: 'Lys', GAT: 'Asp', GAC: 'Asp', GAA: 'Glu', GAG: 'Glu',
  TGT: 'Cys', TGC: 'Cys', TGA: 'Ter', TGG: 'Trp', CGT: 'Arg', CGC: 'Arg', CGA: 'Arg', CGG: 'Arg',
  AGT: 'Ser', AGC: 'Ser', AGA: 'Arg', AGG: 'Arg', GGT: 'Gly', GGC: 'Gly', GGA: 'Gly', GGG: 'Gly',
};
const ONE: Record<string, string> = {
  Ala: 'A', Arg: 'R', Asn: 'N', Asp: 'D', Cys: 'C', Gln: 'Q', Glu: 'E', Gly: 'G', His: 'H', Ile: 'I',
  Leu: 'L', Lys: 'K', Met: 'M', Phe: 'F', Pro: 'P', Ser: 'S', Thr: 'T', Trp: 'W', Tyr: 'Y', Val: 'V', Ter: '*',
};

export function translateCodon(codon: string): string {
  return CODON[codon.toUpperCase()] ?? 'Xaa';
}

export function translate(cds: string): string {
  let out = '';
  for (let i = 0; i + 3 <= cds.length; i += 3) out += ONE[translateCodon(cds.slice(i, i + 3))] ?? 'X';
  return out;
}

export interface B2Inputs {
  referenceCds: string;
  currentCds: string;
  transcript: string;
  operation: 'introduce' | 'repair' | 'custom';
  variant: ScienceVariant | null;
  cdsPosition?: number;
  refBase?: string;
  altBase?: string;
  residues: ScienceResidue[];
  betaChains: Record<string, string[]>;
  mechanismRule: 'qualitative_hb_rules' | 'sequence_only';
}

interface Rule {
  residue: number; // HGVS numbering
  ref: string;
  alt: string;
  phenotype: B2Phenotype;
  tendency: number;
  text: string;
}

const RULES: Rule[] = [
  { residue: 7, ref: 'E', alt: 'V', phenotype: 'sickle', tendency: 0.85,
    text: 'HbS rule: β6 Val creates a hydrophobic patch that lets deoxy-haemoglobin polymerise into fibres that deform red cells (qualitative).' },
  { residue: 7, ref: 'E', alt: 'K', phenotype: 'crystal', tendency: 0.3,
    text: 'HbC rule: β6 Lys lowers solubility; oxy-HbC tends to crystallise and cells dehydrate (qualitative).' },
  { residue: 27, ref: 'E', alt: 'K', phenotype: 'unstable', tendency: 0.12,
    text: 'HbE rule: β26 Lys activates a cryptic splice site and gives a mildly unstable globin (qualitative).' },
];

export function computeB2GeneticEdit(inputs: B2Inputs): B2Output {
  const ref = inputs.referenceCds.toUpperCase();
  const cur = (inputs.currentCds || ref).toUpperCase();
  let pos = inputs.cdsPosition ?? inputs.variant?.cdsPosition ?? 0;
  let expected = (inputs.refBase ?? '').toUpperCase();
  let replacement = (inputs.altBase ?? '').toUpperCase();
  if (inputs.variant && inputs.operation !== 'custom') {
    pos = inputs.variant.cdsPosition ?? 0;
    const m = /c\.\d+([ACGT])>([ACGT])/.exec(inputs.variant.hgvsC);
    const r = m?.[1] ?? '';
    const a = m?.[2] ?? '';
    expected = inputs.operation === 'introduce' ? r : a;
    replacement = inputs.operation === 'introduce' ? a : r;
  }

  let applied = false;
  let message = '';
  let after = cur;
  if (!pos || pos < 1 || pos > cur.length) {
    message = `Position c.${pos} is outside the coding sequence (intronic/UTR edits are not modelled).`;
  } else if (!/^[ACGT]$/.test(replacement)) {
    message = 'Alternate base must be one of A, C, G, T.';
  } else if (cur[pos - 1] !== expected) {
    message = `Reference check failed: the branch has ${cur[pos - 1]} at c.${pos}, the edit expects ${expected}.`;
  } else {
    after = cur.slice(0, pos - 1) + replacement + cur.slice(pos);
    applied = true;
    message = `c.${pos}${expected}>${replacement} applied to ${inputs.transcript}.`;
  }

  const codonIndex = Math.max(0, Math.floor((pos - 1) / 3));
  const beforeCodon = cur.slice(codonIndex * 3, codonIndex * 3 + 3);
  const afterCodon = after.slice(codonIndex * 3, codonIndex * 3 + 3);
  const beforeAA = translateCodon(beforeCodon);
  const afterAA = translateCodon(afterCodon);
  const hgvsResidue = codonIndex + 1;
  const structureResidue = codonIndex; // initiator Met is cleaved in the mature β chain

  // Structure mapping check against the entry that matches the *current* residue.
  const refProtein = translate(ref);
  const afterProtein = translate(after);
  const phen = phenotypeFor(refProtein, afterProtein, inputs.mechanismRule);
  const checkEntry = beforeAA === 'Val' && hgvsResidue === 7 ? '2HBS' : '4HHB';
  const chains = inputs.betaChains[checkEntry] ?? [];
  const res = inputs.residues.find(
    (r) => r.entryId === checkEntry && chains.includes(r.chain) && r.resSeq === structureResidue,
  );
  const validated = Boolean(res && res.resName.toUpperCase() === beforeAA.toUpperCase());
  const structureNote = res
    ? `${checkEntry} chain ${res.chain} residue ${structureResidue} is ${res.resName} — ${validated ? 'matches' : 'does NOT match'} the CDS (${beforeAA}).`
    : `${checkEntry} has no modelled β residue ${structureResidue}; no structural highlight is drawn.`;

  const ws = Math.max(0, codonIndex * 3 - 18);
  const pw = Math.max(0, codonIndex - 8);
  const steps: B2MechanismStep[] = [
    {
      stage: 'dna', title: 'DNA · HBB coding strand', before: beforeCodon, after: afterCodon,
      note: applied ? message : `Edit rejected — ${message}`,
      assumption: 'A declared sequence operation; no delivery method or editing efficiency is modelled.',
    },
    {
      stage: 'mrna', title: 'mRNA codon', before: beforeCodon.replace(/T/g, 'U'), after: afterCodon.replace(/T/g, 'U'),
      note: 'Transcription of the edited codon (T→U). Splicing and UTRs are omitted.',
      assumption: 'Codon is read in frame from the RefSeq CDS start.',
    },
    {
      stage: 'protein', title: `β-globin residue ${structureResidue} (HGVS p.${hgvsResidue})`,
      before: beforeAA, after: afterAA,
      note: structureNote,
      assumption: 'Translation only — folding and stability are not predicted.',
    },
    {
      stage: 'cell', title: 'Red-cell behaviour (declared rule)', before: 'normal', after: phen.phenotype,
      note: phen.text,
      assumption: 'Qualitative rule table, not a clinical probability, treatment or cure claim.',
    },
  ];

  return {
    operation: inputs.operation,
    variantRsId: inputs.variant?.rsId ?? null,
    variantLabel: inputs.variant?.label ?? `c.${pos}${expected}>${replacement}`,
    clinvarId: inputs.variant?.clinvarId ?? null,
    clinicalSignificance: inputs.variant?.clinicalSignificance ?? null,
    reviewStatus: inputs.variant?.reviewStatus ?? null,
    transcript: inputs.transcript,
    cdsPosition: pos,
    refBase: expected,
    altBase: replacement,
    applied,
    validationMessage: message,
    codonIndex,
    beforeCodon,
    afterCodon,
    beforeAminoAcid: beforeAA,
    afterAminoAcid: afterAA,
    hgvsResidue,
    structureResidue,
    structureMappingValidated: validated,
    structureNote,
    betaChains: chains,
    afterCds: after,
    windowStart: ws,
    windowBefore: cur.slice(ws, ws + 42),
    windowAfter: after.slice(ws, ws + 42),
    beforeProteinWindow: translate(cur).slice(pw, pw + 17),
    afterProteinWindow: afterProtein.slice(pw, pw + 17),
    phenotype: phen.phenotype,
    polymerisationTendency: phen.tendency,
    mechanismRule: inputs.mechanismRule,
    mechanism: steps,
    structureEntry: phen.phenotype === 'sickle' ? '2HBS' : '4HHB',
  };
}

/** Applies the rule table to every residue that differs from the reference protein. */
function phenotypeFor(
  refProtein: string,
  protein: string,
  rule: B2Inputs['mechanismRule'],
): { phenotype: B2Phenotype; tendency: number; text: string } {
  if (rule === 'sequence_only') {
    return { phenotype: 'unknown', tendency: 0, text: 'Cell-level rule disabled (sequence-only mode).' };
  }
  const stop = protein.indexOf('*');
  if (stop >= 0 && stop < refProtein.length - 1) {
    return {
      phenotype: 'absent_beta', tendency: 0,
      text: `β⁰ rule: premature stop at codon ${stop + 1} — no full-length β-globin; cells are small and pale (qualitative).`,
    };
  }
  for (const r of RULES) {
    const i = r.residue - 1;
    if (refProtein[i] === r.ref && protein[i] === r.alt) return r;
  }
  const changed = [...protein].some((aa, i) => aa !== refProtein[i]);
  return changed
    ? { phenotype: 'unknown', tendency: 0, text: 'No curated rule for this substitution; cell behaviour is not inferred.' }
    : { phenotype: 'normal', tendency: 0.05, text: 'Protein matches the reference β-globin; cells keep their biconcave shape.' };
}
