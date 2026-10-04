import {
  kardashevFromPowerW,
  type EvidenceKind,
  type K1Output,
  type K2Output,
  type K3Output,
  type LevelId,
  type LevelOutput,
  type ScienceBundle,
  type ScienceTables,
} from '@cosmos/engine';
import { energyMeV, fixed, int, pct, sci, si, years } from '../lib/format';

export interface Grounding {
  label: string;
  value: string;
  source: string;
  kind: EvidenceKind;
}

export interface CivProfile {
  level: LevelId;
  family: 'K' | 'B';
  rank: string;
  title: string;
  tagline: string;
  scale: string;
  howItWorks: { title: string; body: string }[];
  grounding: Grounding[];
  model: string[];
  signatures: string[];
  limits: string[];
}

type Tables = Partial<ScienceTables>;

/** Rendered level outputs for the active branch (authoritative, re-derived locally). */
export type LevelViews = Partial<Record<LevelId, { output: LevelOutput }>>;

function out<T>(p: LevelViews | null, level: LevelId): T | null {
  const v = p?.[level]?.output.view as Record<string, unknown> | null | undefined;
  if (!v) return null;
  if (level === 'k1') return { ...(v as object), achievedK: (v.totals as { achievedK: number }).achievedK } as T;
  if (level === 'k2') return ((v.swarms as unknown[])[0] ?? null) as T | null;
  if (level === 'k3' && !('arrivalSeconds' in v)) return null;
  return v as T;
}

export function civilizationProfile(level: LevelId, bundle: ScienceBundle, t: Tables, p: LevelViews | null): CivProfile {
  const P0 = bundle.earth.primaryPowerW.value;
  const humanK = kardashevFromPowerW(P0);
  switch (level) {
    case 'k1': {
      const k1 = out<K1Output>(p, 'k1');
      const anomaly = [...(t.climate_anomaly ?? [])].sort((a, b) => b.year - a.year)[0];
      const solar = (t.energy_record ?? []).filter((r) => r.metric === 'primary_energy' && r.year === bundle.earth.primaryPowerYear);
      const share = (src: string) => {
        const total = solar.find((r) => r.source === 'total')?.valueTwh ?? 1;
        return (solar.find((r) => r.source === src)?.valueTwh ?? 0) / total;
      };
      const R = bundle.earth.radiusKm.value * 1000;
      const intercepted = 1361 * Math.PI * R * R;
      return {
        level, family: 'K', rank: 'Kardashev I', title: 'Planetary civilisation',
        tagline: 'Commands energy on the scale of everything its home world can supply.',
        scale: '≈10¹⁶ W (Sagan convention) · Earth intercepts ≈1.7×10¹⁷ W of sunlight',
        howItWorks: [
          { title: 'Planet-wide supergrid', body: 'Continental HVDC links share power across time zones and seasons, so solar deserts, windy latitudes and firm (fusion/fission/geothermal) plants act as one machine.' },
          { title: 'Energy from orbit', body: 'Collectors in geostationary orbit see the Sun ~99% of the time and beam power down to ground rectennas near the largest load centres.' },
          { title: 'Climate as an engineered variable', body: 'At 10¹⁶ W, waste heat alone is a climate forcing. A K1 society must manage its planet\'s energy balance deliberately — sunshades, albedo, heat rejection.' },
          { title: 'Where humanity is', body: `Today: ${si(P0, 'W')} (K ${humanK.toFixed(3)}). Reaching K1 means ~${int(1e16 / P0)}× more usable power than in ${bundle.earth.primaryPowerYear}.` },
        ],
        grounding: [
          { label: `World primary energy (${bundle.earth.primaryPowerYear})`, value: si(P0, 'W'), source: 'OWID / Energy Institute', kind: 'derived' },
          { label: 'Humanity\'s current K', value: humanK.toFixed(3), source: 'derived from OWID', kind: 'derived' },
          { label: 'Fossil share of primary energy', value: pct(share('coal') + share('oil') + share('gas')), source: 'OWID', kind: 'observed' },
          { label: 'Solar + wind share', value: pct(share('solar') + share('wind')), source: 'OWID', kind: 'observed' },
          { label: `Global temperature anomaly (${anomaly?.year ?? '—'})`, value: anomaly ? `+${anomaly.anomalyC.toFixed(2)} °C vs ${anomaly.baseline}` : '—', source: 'NOAA NCEI', kind: 'observed' },
          { label: 'Sunlight intercepted by Earth', value: si(intercepted, 'W'), source: 'S·πR² (SPICE radius)', kind: 'derived' },
          { label: 'Load centres', value: `${(t.earth_city ?? []).length} Natural Earth cities`, source: 'Natural Earth', kind: 'observed' },
          ...(k1 ? [{ label: 'This branch\'s achieved K', value: k1.achievedK.toFixed(3), source: 'K1 model', kind: 'simulated' as const }] : []),
        ],
        model: ['P_useful = P₀ + C · u · η', 'K = (log₁₀ P − 6) / 10', 'T_eq = [(S(1−a)/4 + P/4πR²) / εσ]^¼ + ΔT_greenhouse'],
        signatures: ['Night-side light output scales with power use (VIIRS Black Marble shows today\'s footprint).', 'Waste-heat forcing comparable to greenhouse forcing beyond ~10¹⁶ W.', 'Artificial albedo changes visible to remote observers.'],
        limits: ['Infrastructure layout is a scenario on real cities, not an engineering design.', 'Equilibrium temperature only — no weather, ocean or carbon-cycle model.'],
      };
    }
    case 'k2': {
      const k2 = out<K2Output>(p, 'k2');
      const L = bundle.sun.luminosityW.value;
      const mercury = bundle.bodies.find((b) => b.id === 'body.mercury');
      const area1au = 4 * Math.PI * 1.495978707e11 ** 2;
      const arealDensity = mercury?.massKg ? mercury.massKg / area1au : null;
      return {
        level, family: 'K', rank: 'Kardashev II', title: 'Stellar civilisation',
        tagline: 'Captures a large fraction of its star\'s output with a swarm of orbiting collectors.',
        scale: `≈10²⁶ W · the Sun emits ${sci(L)} W`,
        howItWorks: [
          { title: 'A swarm, not a shell', body: 'A rigid Dyson sphere is mechanically unstable. A K2 civilisation builds a swarm: trillions of independent collectors, each on its own Keplerian orbit, arranged in bands.' },
          { title: 'Planets become feedstock', body: `Mining a planet supplies the material. Mercury's mass (${mercury?.massKg ? sci(mercury.massKg) : '—'} kg from SPICE) spread over a 1 AU sphere is ${arealDensity ? arealDensity.toFixed(2) : '—'} kg/m² — enough for thin-film collectors.` },
          { title: 'Energy in situ', body: 'Most captured power is used where it is collected — computation, propulsion, industry — or beamed. Whatever is not converted is radiated as infrared waste heat.' },
          { title: 'Consequences for planets', body: 'A swarm inside 1 AU shades the outer system: Earth\'s sunlight and equilibrium temperature drop with the captured fraction.' },
        ],
        grounding: [
          { label: 'Solar luminosity', value: si(L, 'W'), source: 'IAU 2015 nominal', kind: 'assumed' },
          { label: 'Bodies placed', value: `${bundle.bodies.length} Horizons state vectors`, source: 'JPL Horizons', kind: 'observed' },
          { label: 'Mercury mass (material budget)', value: mercury?.massKg ? `${sci(mercury.massKg)} kg` : '—', source: 'SPICE GM / G', kind: 'derived' },
          { label: 'K of the full Sun', value: kardashevFromPowerW(L).toFixed(3), source: 'derived', kind: 'derived' },
          ...(k2
            ? [
              { label: 'Swarm radiator temperature', value: `${k2.swarmRadiatorTempK.toFixed(0)} K (peak ${k2.radiatorPeakMicron.toFixed(1)} µm)`, source: 'K2 model', kind: 'simulated' as const },
              { label: 'This branch\'s achieved K', value: k2.achievedK.toFixed(3), source: 'K2 model', kind: 'simulated' as const },
            ]
            : []),
        ],
        model: ['P_intercepted = f · L☉,  P_useful = η · f · L☉', 'A_eff = f · 4πr²', 'T_rad = [(1−η) f L / (4πr²σ)]^¼', 'Band period P = 2π√(r³ / GM☉)'],
        signatures: ['Dimming of the star by the captured fraction.', 'Strong mid-infrared excess (waste heat at a few hundred K) — the target of Gaia + WISE "Dyson sphere" searches.', 'Transit-like irregular dips from collector bands.'],
        limits: ['No collision, shadowing or orbital-stability model.', 'Construction time and materials processing are not simulated.'],
      };
    }
    case 'k3': {
      const k3 = out<K3Output>(p, 'k3');
      const flame = bundle.stars.filter((s) => s.luminositySource === 'flame').length;
      const hosts = new Set((t.exoplanet_system ?? []).map((e) => e.hostname)).size;
      return {
        level, family: 'K', rank: 'Kardashev III', title: 'Galactic civilisation',
        tagline: 'Spreads star to star until it commands the light of a galaxy.',
        scale: '≈10³⁶ W · ~2×10¹¹ stars',
        howItWorks: [
          { title: 'Settlement waves', body: 'Colony ships (or self-replicating probes) leave each settled system after a settlement delay and head for its nearest neighbours. Expansion is a wavefront through a real 3-D star field.' },
          { title: 'Speed vs. delay', body: 'At high ship speed the settlement delay dominates; at low speed travel time does. Either way, a single civilisation could cross the Milky Way in well under 1% of its age.' },
          { title: 'Each star becomes K2', body: 'Every settled system captures a fraction of its own star\'s luminosity, so civilisation power grows with the number and brightness of settled stars.' },
          { title: 'The Fermi question', body: 'Because expansion is fast compared to galactic ages, the absence of obvious K3 signatures (galaxy-wide infrared excess) is a real constraint.' },
        ],
        grounding: [
          { label: 'Stars in the sample', value: int(bundle.stars.length), source: 'Gaia DR3 + SIMBAD', kind: 'observed' },
          { label: 'With Gaia FLAME luminosity', value: int(flame), source: 'Gaia DR3', kind: 'observed' },
          { label: 'Known planetary systems', value: `${int(hosts)} hosts / ${int((t.exoplanet_system ?? []).length)} planets`, source: 'NASA Exoplanet Archive', kind: 'observed' },
          { label: 'Galaxies in the wider web', value: int((t.sdss_galaxy ?? []).length), source: 'SDSS DR18', kind: 'observed' },
          ...(k3
            ? [
              { label: 'Settled in this branch', value: `${int(k3.settledCount)} (${pct(k3.coverageFraction)})`, source: 'K3 model', kind: 'simulated' as const },
              { label: 'Time to 50% of reachable sample', value: years((k3.milestones.find((m) => m.fraction === 0.5)?.seconds ?? Infinity) / (365.25 * 86400)), source: 'K3 model', kind: 'simulated' as const },
              { label: 'Galaxy-wide extrapolated K', value: k3.galaxyExtrapolation.extrapolatedK.toFixed(3), source: 'disk extrapolation', kind: 'assumed' as const },
            ]
            : []),
        ],
        model: ['k-NN graph over Gaia positions (k-d tree)', 't_arrival = Σ (d_hop / v + τ_settle)  (Dijkstra)', 'P = Σ_settled L★ · f · η', 'P_galaxy ≈ N★ · ⟨L⟩ · f · η · F_disk(r_front)'],
        signatures: ['Galaxy-wide mid-infrared excess and optical dimming.', 'Surveys of ~10⁵ galaxies (WISE "Ĝ" search) have found no clear K3 candidates.'],
        limits: ['The sample is a bright/nearby/field selection, not a census.', 'Galaxy-wide power is an explicit extrapolation with declared disk parameters.'],
      };
    }
    case 'b2': {
      const v = (t.variant_record ?? []).find((x) => x.rsId === 'rs334');
      return {
        level, family: 'B', rank: 'Barrow II', title: 'Genetic mastery',
        tagline: 'Reads and rewrites the genomes of living things base by base.',
        scale: '10⁻⁹ m · one nucleotide ≈ 0.34 nm',
        howItWorks: [
          { title: 'Information → structure → behaviour', body: 'A single base change in DNA alters one codon, one amino acid, one protein surface — and can change how whole cells behave.' },
          { title: 'The sickle-cell example', body: 'In HBB, c.20A>T turns Glu into Val at β6. In deoxygenated haemoglobin that valine docks into a neighbour, nucleating fibres that deform red cells (seen directly in the 2HBS crystal).' },
          { title: 'Repair as a counterfactual', body: 'A Barrow-II civilisation can introduce or reverse such variants at will. COSMOS checks the reference base before any edit and keeps the outcome labelled as an educational rule.' },
        ],
        grounding: [
          { label: 'HBB transcript', value: bundle.hbb.transcript, source: 'NCBI RefSeq', kind: 'observed' },
          { label: 'CDS length', value: `${bundle.hbb.cds.value.length} nt`, source: 'NCBI E-utilities', kind: 'observed' },
          { label: 'HbS variant', value: v ? `${v.hgvsC} · ${v.clinvarId}` : '—', source: 'ClinVar', kind: 'observed' },
          { label: 'ClinVar classification', value: v?.clinicalSignificance ?? '—', source: 'ClinVar', kind: 'observed' },
          { label: 'Structures', value: '4HHB (HbA) · 2HBS (HbS)', source: 'RCSB PDB', kind: 'observed' },
          { label: 'Blood/marrow cell atlases', value: `${(t.hca_project ?? []).length} HCA projects`, source: 'Human Cell Atlas', kind: 'observed' },
        ],
        model: ['Edit: validate ref base at c.N, substitute', 'Codon = CDS[3k..3k+2] → amino acid (standard code)', 'Residue (structure) = codon − 1 (Met cleaved), checked against 4HHB/2HBS'],
        signatures: ['Changed protein surface chemistry', 'Altered red-cell morphology under the declared rule'],
        limits: ['No delivery, efficiency, off-target or clinical model.', 'Cell behaviour is a qualitative rule, not a probability.'],
      };
    }
    case 'b4': {
      const lines = bundle.hydrogen.lines.filter((l) => l.akiPerS != null).length;
      return {
        level, family: 'B', rank: 'Barrow IV', title: 'Atomic mastery',
        tagline: 'Places single electrons into chosen quantum states.',
        scale: '10⁻¹⁰ m · Bohr radius 52.9 pm',
        howItWorks: [
          { title: 'Quantised energy', body: 'An electron in hydrogen can only occupy discrete levels. Moving it between levels absorbs or emits a photon whose energy exactly matches the gap.' },
          { title: 'Selection rules', body: 'Single-photon (dipole) transitions need Δl = ±1. Others are "forbidden": they happen rarely, through slower channels.' },
          { title: 'Why it matters', body: 'Atomic control underlies lasers, atomic clocks and quantum computers — the toolkit of a Barrow-IV civilisation.' },
        ],
        grounding: [
          { label: 'H I levels', value: `${bundle.hydrogen.levels.length} evaluated levels`, source: 'NIST ASD', kind: 'observed' },
          { label: 'H I lines with Einstein A', value: int(lines), source: 'NIST ASD', kind: 'observed' },
          { label: 'Ionisation energy', value: `${fixed(bundle.hydrogen.ionizationEv.value, 6)} eV`, source: 'NIST ASD', kind: 'observed' },
        ],
        model: ['ΔE = E_f − E_i (NIST)', 'ν = |ΔE| / h,  λ = c / ν', 'Cloud: |ψ_nlm|² exact hydrogen solution'],
        signatures: ['Spectral lines (Lyman UV, Balmer visible, Paschen IR)'],
        limits: ['Hydrogen only for orbital shapes; other species would need many-electron models.'],
      };
    }
    case 'b5': {
      const na = bundle.na22;
      return {
        level, family: 'B', rank: 'Barrow V', title: 'Nuclear mastery',
        tagline: 'Transmutes elements by reshaping atomic nuclei.',
        scale: '10⁻¹⁴ m · nuclear radius ≈ 3.4 fm',
        howItWorks: [
          { title: 'Weak-force transmutation', body: 'In β⁺ decay a proton becomes a neutron, emitting a positron and a neutrino: sodium becomes neon.' },
          { title: 'Energy bookkeeping', body: 'The mass difference (Q-value) is shared between the positron, neutrino and a gamma ray from the excited daughter.' },
          { title: 'The bridge to B6', body: 'The positron produced here is antimatter — the input to the particle-level annihilation.' },
        ],
        grounding: [
          { label: 'Na-22 half-life', value: na ? years(na.halfLifeS.value / (365.25 * 86400)) : '—', source: 'IAEA / ENSDF', kind: 'observed' },
          { label: 'Q(EC)', value: na ? `${fixed(na.qEcKeV.value, 1)} keV` : '—', source: 'AME2020 via IAEA', kind: 'observed' },
          { label: 'Gamma line', value: na ? `${fixed(na.gammaKeV, 1)} keV (${fixed(na.gammaIntensityPct, 1)}%)` : '—', source: 'ENSDF', kind: 'observed' },
          { label: 'Nuclides catalogued', value: int((t.nuclide ?? []).length), source: 'IAEA LiveChart', kind: 'observed' },
        ],
        model: ['T_max(e⁺) = Q_EC − 2mₑc² − E_level', 'E_ν = T_max − T(e⁺)'],
        signatures: ['511 keV annihilation photons', '1274.5 keV gamma line'],
        limits: ['Single-decay kinematics; no spectrum shape or angular correlations.'],
      };
    }
    case 'b6': {
      const e = bundle.particles.find((x) => x.mcId === 11);
      return {
        level, family: 'B', rank: 'Barrow VI', title: 'Particle mastery',
        tagline: 'Creates and annihilates the elementary building blocks of matter.',
        scale: '10⁻¹⁵ m and below',
        howItWorks: [
          { title: 'Matter meets antimatter', body: 'An electron and positron annihilate; their rest energy and kinetic energy reappear as photons.' },
          { title: 'Conservation is the law', body: 'Energy, momentum, charge and lepton number must balance exactly — the ledger is checked for every event.' },
          { title: 'Opening channels', body: 'With enough collision energy, heavier pairs (muons, pions, protons, taus) become kinematically possible.' },
        ],
        grounding: [
          { label: 'Electron mass', value: e?.massMeV ? `${e.massMeV} MeV` : '—', source: 'PDG 2025', kind: 'observed' },
          { label: 'Particles catalogued', value: int(bundle.particles.length), source: 'PDG 2025', kind: 'observed' },
          { label: 'Muon pair threshold', value: energyMeV(2 * (bundle.particles.find((x) => x.mcId === 13)?.massMeV ?? 0)), source: 'PDG 2025', kind: 'derived' },
        ],
        model: ['E_cm = 2(mₑc² + T)', 'E_γ = E_cm / 2,  λ = hc / E_γ', 'Σp_in = Σp_out = 0'],
        signatures: ['Back-to-back photon pairs (511 keV at rest — the basis of PET imaging)'],
        limits: ['No cross-sections, rates or QED radiative corrections.'],
      };
    }
  }
}
