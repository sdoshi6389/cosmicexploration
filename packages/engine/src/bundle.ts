import { PARSEC_M, TWH_PER_YEAR_TO_W, type ScienceBundle, type ScienceStar, type Sourced } from './science.js';
import type { ScienceTables } from './scienceTables.generated.js';
import type { Evidence } from './types.js';
import { REGIONS } from './regions.js';

/** ICRS → Galactic rotation (Hipparcos convention). */
const ICRS_TO_GAL = [
  [-0.0548755604162154, -0.873437090234885, -0.483835015548713],
  [0.494109427875584, -0.444829629960011, 0.746982244497219],
  [-0.867666149019005, -0.198076373431201, 0.455983776175066],
] as const;

export function icrsToGalactic(x: number, y: number, z: number): { l: number; b: number } {
  const gx = ICRS_TO_GAL[0][0] * x + ICRS_TO_GAL[0][1] * y + ICRS_TO_GAL[0][2] * z;
  const gy = ICRS_TO_GAL[1][0] * x + ICRS_TO_GAL[1][1] * y + ICRS_TO_GAL[1][2] * z;
  const gz = ICRS_TO_GAL[2][0] * x + ICRS_TO_GAL[2][1] * y + ICRS_TO_GAL[2][2] * z;
  const r = Math.hypot(gx, gy, gz) || 1;
  let l = (Math.atan2(gy, gx) * 180) / Math.PI;
  if (l < 0) l += 360;
  return { l, b: (Math.asin(gz / r) * 180) / Math.PI };
}

/** L/L☉ from apparent magnitude and parallax, no bolometric or extinction correction. */
export function photometricLuminosity(mag: number, parallaxMas: number, absSun: number): number {
  const M = mag + 5 * Math.log10(parallaxMas) - 10;
  return 10 ** (-0.4 * (M - absSun));
}

function ev(manifests: ScienceTables['dataset_manifest'], id: string, extra: Partial<Evidence> = {}): Evidence {
  const m = manifests.find((x) => x.id === id);
  return {
    kind: 'observed',
    sourceId: id,
    sourceUrl: m?.sourceUrls.split(' ')[0],
    release: m?.release,
    retrievedAt: m?.retrievedAt,
    ...extra,
  };
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const REQUIRED_TABLES: (keyof ScienceTables)[] = [
  'dataset_manifest', 'horizons_body', 'spice_constant', 'planet_fact', 'energy_record', 'earth_city',
  'gaia_star', 'named_star', 'gene_record', 'sequence_record', 'variant_record', 'pdb_entry', 'pdb_atom',
  'nist_level', 'nist_line', 'ionization_energy', 'pdg_particle', 'nuclide', 'decay_radiation',
];

/** Assemble the engine's sourced inputs from science table rows. Throws listing anything missing. */
export function buildScienceBundle(t: Partial<ScienceTables>): ScienceBundle {
  const missing = REQUIRED_TABLES.filter((k) => !t[k] || t[k]!.length === 0);
  if (missing.length) throw new Error(`Science tables missing or empty: ${missing.join(', ')}`);
  const T = t as ScienceTables;
  const man = T.dataset_manifest;
  const baselineId = `cosmos-${fnv(man.map((m) => `${m.id}:${m.retrievedAt}:${m.rowCount}`).sort().join('|'))}`;

  /* earth */
  const earthSpice = T.spice_constant.find((r) => r.id === 'body.earth');
  const earthRadius = earthSpice?.radiusAKm && earthSpice.radiusCKm
    ? (2 * earthSpice.radiusAKm + earthSpice.radiusCKm) / 3
    : 6371.0;
  const earthFact = T.planet_fact.find((r) => r.id === 'body.earth');
  const primary = T.energy_record
    .filter((r) => r.entity === 'World' && r.metric === 'primary_energy' && r.source === 'total')
    .sort((a, b) => b.year - a.year)[0];
  if (!primary) throw new Error('No world primary-energy record in energy_record');
  const regionalPowerW: Record<string, number> = {};
  for (const r of REGIONS) {
    const rec = T.energy_record
      .filter((e) => e.entity === r.owidEntity && e.metric === 'primary_energy' && e.source === 'total')
      .sort((a, b) => b.year - a.year)[0];
    if (rec) regionalPowerW[r.id] = rec.valueTwh * TWH_PER_YEAR_TO_W;
  }
  const earth: ScienceBundle['earth'] = {
    regionalPowerW,
    radiusKm: { value: earthRadius, evidence: ev(man, 'naif_spice', { kind: 'derived', method: 'mean of pck00011 RADII (2a + c)/3' }) },
    meanSurfaceTempK: {
      value: (earthFact?.meanTemperatureC ?? 15) + 273.15,
      evidence: ev(man, 'nasa_nssdc_factsheet', { sourceRecordId: 'EARTH mean temperature' }),
    },
    primaryPowerW: {
      value: primary.valueTwh * TWH_PER_YEAR_TO_W,
      evidence: ev(man, 'owid_energy', {
        kind: 'derived',
        sourceRecordId: primary.id,
        method: `${primary.valueTwh.toLocaleString('en-US')} TWh/yr (${primary.year}) ÷ 8766 h`,
      }),
    },
    primaryPowerYear: primary.year,
    cities: T.earth_city
      .filter((c) => c.population && c.population > 0)
      .map((c) => ({ id: c.id, name: c.name, latDeg: c.latDeg, lonDeg: c.lonDeg, population: c.population ?? 0 })),
    citySource: ev(man, 'natural_earth'),
  };

  /* sun + bodies */
  const sunSpice = T.spice_constant.find((r) => r.id === 'body.sun');
  const sun: ScienceBundle['sun'] = {
    luminosityW: {
      value: 3.828e26,
      evidence: { kind: 'assumed', method: 'IAU 2015 Resolution B3 nominal solar luminosity (reference constant)' },
    },
    radiusKm: { value: sunSpice?.radiusAKm ?? 695700, evidence: ev(man, 'naif_spice') },
  };
  const bodies = T.horizons_body.map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    parentId: b.parentId,
    positionM: [b.xM, b.yM, b.zM] as [number, number, number],
    velocityMps: [b.vxMps, b.vyMps, b.vzMps] as [number, number, number],
    radiusKm: b.radiusKm,
    massKg: b.massKg,
    epoch: b.epochTdb,
  }));

  /* stars: Sun, Gaia DR3 (named where SIMBAD cross-identifies), then SIMBAD-only bright stars */
  const stars: ScienceStar[] = [{
    id: 'star.sol', name: 'Sun', positionM: [0, 0, 0], lDeg: 0, bDeg: 0, distancePc: 0,
    luminosityLsun: 1, luminositySource: 'flame', sample: 'sun',
  }];
  const nameByGaia = new Map(T.named_star.filter((n) => n.gaiaDr3Id).map((n) => [n.gaiaDr3Id, n]));
  const usedNamed = new Set<string>();
  for (const g of T.gaia_star) {
    const named = nameByGaia.get(g.sourceId);
    if (named) usedNamed.add(named.id);
    const flame = g.luminosityLsun;
    stars.push({
      id: named ? named.id : `gaia.${g.sourceId}`,
      name: named ? named.name : null,
      positionM: [g.xPc * PARSEC_M, g.yPc * PARSEC_M, g.zPc * PARSEC_M],
      lDeg: g.glDeg,
      bDeg: g.gbDeg,
      distancePc: g.distancePc,
      luminosityLsun: flame ?? photometricLuminosity(g.gMag, g.parallaxMas, 4.67),
      luminositySource: flame != null ? 'flame' : 'photometric',
      sample: g.sample,
    });
  }
  for (const n of T.named_star) {
    if (usedNamed.has(n.id) || n.xPc == null || n.yPc == null || n.zPc == null || !n.distancePc) continue;
    const r = n.distancePc;
    const gal = icrsToGalactic(n.xPc / r, n.yPc / r, n.zPc / r);
    stars.push({
      id: n.id,
      name: n.name,
      positionM: [n.xPc * PARSEC_M, n.yPc * PARSEC_M, n.zPc * PARSEC_M],
      lDeg: gal.l,
      bDeg: gal.b,
      distancePc: r,
      luminosityLsun: n.vMag != null && n.parallaxMas ? photometricLuminosity(n.vMag, n.parallaxMas, 4.83) : null,
      luminositySource: n.vMag != null && n.parallaxMas ? 'photometric' : 'none',
      sample: 'named',
    });
  }

  /* HBB */
  const ncbiCds = T.sequence_record.find((s) => s.geneSymbol === 'HBB' && s.kind === 'cds' && s.accession.startsWith('NM_'));
  const ncbiProt = T.sequence_record.find((s) => s.geneSymbol === 'HBB' && s.kind === 'protein' && s.accession.startsWith('NP_'));
  const ensCds = T.sequence_record.find((s) => s.geneSymbol === 'HBB' && s.kind === 'cds' && s.accession.startsWith('ENST'));
  const gene = T.gene_record.find((g) => g.symbol === 'HBB');
  if (!ncbiCds || !ncbiProt) throw new Error('HBB RefSeq CDS/protein missing from sequence_record');
  const betaChains: Record<string, string[]> = {};
  for (const e of T.pdb_entry) {
    const part = e.chains.split('|').map((x) => x.trim()).find((x) => /BETA/i.test(x));
    betaChains[e.id] = part ? part.split('=')[0]!.split(',').map((c) => c.trim()) : [];
  }
  const residues = T.pdb_atom
    .filter((a) => a.atomName === 'CA' && (betaChains[a.entryId] ?? []).includes(a.chain) && a.resSeq <= 146)
    .map((a) => ({ entryId: a.entryId, chain: a.chain, resSeq: a.resSeq, resName: a.resName }));
  const variantLabels: Record<string, string> = {};
  for (const v of T.variant_record) variantLabels[v.rsId] = v.proteinChange;

  /* hydrogen */
  const hLevels = T.nist_level.filter((l) => l.species === 'H I').map((l) => ({
    configuration: l.configuration, term: l.term, j: l.j, n: l.n, l: l.l, energyEv: l.energyEv,
  }));
  const hLines = T.nist_line.filter((l) => l.species === 'H I').map((l) => ({
    lowerConf: l.lowerConf, upperConf: l.upperConf, lowerJ: l.lowerJ, upperJ: l.upperJ,
    wavelengthNm: l.wavelengthVacNm, akiPerS: l.akiPerS, eiEv: l.eiEv, ekEv: l.ekEv,
  }));
  const hIon = T.ionization_energy.find((r) => r.species === 'H I');

  /* Na-22 */
  const na = T.nuclide.find((r) => r.id === '22Na');
  const bp = T.decay_radiation.filter((r) => r.parent === '22na' && r.radiationType === 'beta+')
    .sort((a, b) => (b.intensityPct ?? 0) - (a.intensityPct ?? 0))[0];
  // Exclude the 511 keV annihilation photons IAEA lists alongside true nuclear gammas.
  const gam = T.decay_radiation.filter((r) => r.parent === '22na' && r.radiationType === 'gamma' && Math.abs(r.energyKeV - 511) > 2)
    .sort((a, b) => (b.intensityPct ?? 0) - (a.intensityPct ?? 0))[0];
  const nucEv = ev(man, 'iaea_livechart');
  const na22 = na?.halfLifeS && na.qEcKeV && bp && gam
    ? {
      halfLifeS: { value: na.halfLifeS, evidence: { ...nucEv, sourceRecordId: '22Na half-life' } } as Sourced<number>,
      qEcKeV: { value: na.qEcKeV, evidence: { ...nucEv, sourceRecordId: '22Na Q(EC)' } } as Sourced<number>,
      betaPlusMeanKeV: bp.energyKeV,
      betaPlusIntensityPct: bp.intensityPct ?? 0,
      gammaKeV: gam.energyKeV,
      gammaIntensityPct: gam.intensityPct ?? 0,
      source: nucEv,
    }
    : null;

  const gaiaHosts = new Set(T.exoplanet_system.map((e) => e.gaiaDr3Id).filter(Boolean));
  const exoplanetHostIds = stars.filter((s) => s.id.startsWith('gaia.') && gaiaHosts.has(s.id.slice(5))).map((s) => s.id);
  const mw = (cid: number, fallback: number) => T.molecule.find((m) => m.cid === cid)?.molecularWeight ?? fallback;
  const materials: ScienceBundle['materials'] = {
    // Densities and effective cross-sections are declared literature-scale assumptions (Granqvist 2000 review scale).
    WO3: { id: 'WO3', name: 'WO₃', molarMassG: mw(14811, 231.84), densityGcm3: 7.16, sigmaCm2: 5e-18, peakEv: 1.4, tintHex: '#3a6fd8', coloration: 1, pubchemCid: T.molecule.some((m) => m.cid === 14811) ? 14811 : null },
    NiO: { id: 'NiO', name: 'NiO', molarMassG: mw(14805, 74.69), densityGcm3: 6.67, sigmaCm2: 3e-18, peakEv: 2.6, tintHex: '#8a6a3a', coloration: -1, pubchemCid: T.molecule.some((m) => m.cid === 14805) ? 14805 : null },
  };
  return {
    baselineId,
    exoplanetHostIds,
    materials,
    earth,
    sun,
    bodies,
    bodySource: ev(man, 'jpl_horizons'),
    stars,
    starSource: ev(man, 'esa_gaia_dr3', { method: 'Gaia DR3 (ARI mirror) + SIMBAD named stars' }),
    hbb: {
      cds: { value: ncbiCds.sequence, evidence: ev(man, 'ncbi_datasets', { sourceRecordId: ncbiCds.accession }) },
      protein: { value: ncbiProt.sequence, evidence: ev(man, 'ncbi_datasets', { sourceRecordId: ncbiProt.accession }) },
      transcript: gene?.refseqTranscript ?? ncbiCds.release,
      ensemblTranscript: ensCds?.release ?? '',
      variants: T.variant_record.map((v) => ({
        rsId: v.rsId, label: v.proteinChange, clinvarId: v.clinvarId, hgvsC: v.hgvsC, hgvsP: v.hgvsP,
        cdsPosition: v.cdsPosition, codonRef: v.codonRef, codonAlt: v.codonAlt, refAllele: v.refAllele,
        altAllele: v.altAllele, clinicalSignificance: v.clinicalSignificance, reviewStatus: v.reviewStatus,
        conditions: v.conditions, consequence: v.consequence,
      })),
      variantSource: ev(man, 'ncbi_clinvar'),
      residues,
      betaChains,
      structureSource: ev(man, 'rcsb_pdb'),
    },
    hydrogen: {
      levels: hLevels,
      lines: hLines,
      ionizationEv: { value: hIon?.ionizationEv ?? 13.598434599702, evidence: ev(man, 'nist_asd', { sourceRecordId: 'H I ionization energy' }) },
      source: ev(man, 'nist_asd'),
    },
    particles: T.pdg_particle.map((p) => ({ mcId: p.mcId, name: p.name, massMeV: p.massMeV, massErrMeV: p.massErrMeV, charge: p.charge })),
    particleSource: ev(man, 'pdg'),
    na22,
  };
}
