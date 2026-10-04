import type {
  B2BodyView, B2Output, B4Output, B4WindowView, B5Output, B6DeviceView, B6Output, K1GridView, K2StellarView, K3Output, LevelOutput, StructureView,
} from '@cosmos/engine';
import { duration, energyMeV, fixed, int, pct, sci, si, wavelength, years } from '../../lib/format';
import { Bar, Metric, MetricGrid, Section } from '../controls';

const YEAR = 365.25 * 86400;

function delta(a: number | undefined, b: number | undefined, fmt: (x: number) => string): string | null {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return null;
  const d = a - b;
  return `${d > 0 ? '+' : '−'}${fmt(Math.abs(d))} vs committed`;
}

export function LevelResults({ output, committed }: { output: LevelOutput; committed?: LevelOutput | null }) {
  const v = output.view as never;
  const c = committed?.view as never;
  switch (output.level) {
    case 'k1': return <K1Grid o={v} c={c} />;
    case 'k2': return <><K2Stellar o={v} c={c} /><StructuresList items={(v as { structures?: StructureView[] }).structures ?? []} /></>;
    case 'k3': {
      const k3 = v as (K3Output & { structures?: StructureView[] }) | { structures: StructureView[] };
      return <>{'arrivalSeconds' in k3 ? <K3View o={k3 as never} c={c} /> : null}<StructuresList items={k3.structures ?? []} /></>;
    }
    case 'b2': return <B2Body o={v} />;
    case 'b4': return <B4Room o={v} c={c} />;
    case 'b5': return v ? <B5View o={v} /> : null;
    case 'b6': return <B6Device o={v} c={c} />;
  }
}

function StructuresList({ items }: { items: StructureView[] }) {
  if (!items.length) return null;
  return (
    <Section title={`Structures · ${items.length}`}>
      {items.map((s) => (
        <div key={s.interventionId} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
          <span style={{ flex: 1, color: s.valid ? undefined : 'var(--amber)' }}>{s.label}{s.valid ? '' : ` — ${s.note}`}</span>
          <span className="mono">{s.type === 'habitat' ? `${si(s.servedW, 'W', 2)} / ${si(s.demandW, 'W', 2)}` : si(s.usefulW, 'W', 2)}</span>
        </div>
      ))}
    </Section>
  );
}

const TECH_COLOR: Record<string, string> = {
  solar: '#ffcf5c', wind: '#bff6ff', fusion: '#d58cff', fission: '#7dffb6', geothermal: '#ff8a4c', orbital_solar: '#5ce1ff',
};

function K1Grid({ o, c }: { o: K1GridView; c?: K1GridView }) {
  const t = o.totals;
  const byTech = new Map<string, number>();
  for (const f of o.facilities) byTech.set(f.technology, (byTech.get(f.technology) ?? 0) + f.deliveredW);
  const maxTech = Math.max(1, ...byTech.values());
  const maxBal = Math.max(1, ...o.regions.map((r) => Math.abs(r.exportsW > 0 ? r.localBalanceW : r.balanceW)));
  return (
    <>
      <MetricGrid>
        <Metric big label="Useful power" value={si(t.usefulW, 'W')} tone="amber" sub={`installed ${si(t.installedW, 'W')}`} delta={delta(t.usefulW, c?.totals.usefulW, (x) => si(x, 'W'))} />
        <Metric big label="Achieved K" value={t.achievedK.toFixed(3)} tone="cyan" sub={`baseline K ${t.baselineK.toFixed(3)}`} delta={delta(t.achievedK, c?.totals.achievedK, (x) => x.toFixed(3))} />
        <Metric label="Generated" value={si(t.generatedW, 'W')} sub={`conversion loss ${si(t.conversionLossW, 'W')}`} />
        <Metric label="Transmission loss" value={si(t.transmissionLossW, 'W')} sub="HVDC between regions" />
        <Metric label="Unmet demand" value={si(t.unmetW, 'W')} tone={t.unmetW > 0 ? 'red' : 'green'} sub={`of ${si(t.demandW, 'W')} demand`} />
        <Metric label="Surplus" value={si(t.surplusW, 'W')} tone="green" sub={`ΔT ${o.climate.deltaTK >= 0 ? '+' : ''}${o.climate.deltaTK.toFixed(3)} K`} />
      </MetricGrid>
      <Section title="Regions — supply vs demand (after HVDC trade)">
        {o.regions.map((r) => {
          const net = r.exportsW > 0 ? r.localBalanceW : r.balanceW;
          const col = r.status === 'surplus' ? 'var(--green)' : r.status === 'deficit' ? 'var(--red)' : 'var(--amber)';
          const trade = r.exportsW > 0 ? ` → exports ${si(r.exportsW, 'W', 2)}` : r.importsW > 0 ? ` ← imports ${si(r.importsW, 'W', 2)}` : '';
          return <Bar key={r.id} label={`${r.name} · ${r.status}`} value={Math.abs(net)} max={maxBal} color={col} right={`${net >= 0 ? '+' : '−'}${si(Math.abs(net), 'W', 2)}${trade}`} />;
        })}
      </Section>
      {byTech.size ? (
        <Section title="Delivered by technology">
          {[...byTech].map(([k, w]) => <Bar key={k} label={k.replace('_', ' ')} value={w} max={maxTech} right={si(w, 'W')} color={TECH_COLOR[k]} />)}
        </Section>
      ) : null}
    </>
  );
}

function K2Stellar({ o, c }: { o: K2StellarView; c?: K2StellarView }) {
  const t = o.totals;
  return (
    <>
      <MetricGrid>
        <Metric big label="Useful power" value={si(t.usefulW, 'W')} tone="amber" sub={`intercepted ${si(t.interceptedW, 'W')}`} delta={delta(t.usefulW, c?.totals.usefulW, (x) => si(x, 'W'))} />
        <Metric big label="Achieved K" value={t.achievedK.toFixed(3)} tone="cyan" delta={delta(t.achievedK, c?.totals.achievedK, (x) => x.toFixed(3))} />
        <Metric label="Delivered to loads" value={si(t.deliveredW, 'W')} sub={`beam loss ${si(t.beamLossW, 'W')}`} />
        <Metric label="Unmet demand" value={si(t.unmetW, 'W')} tone={t.unmetW > 0 ? 'red' : 'green'} sub={`unallocated ${si(t.unallocatedW, 'W')}`} />
        <Metric label="Sunlight reaching Earth" value={pct(t.transmittedFraction, 1)} sub={t.earthEquilibriumTempK ? `T_eq ${t.earthEquilibriumTempK.toFixed(0)} K` : undefined} />
        <Metric label="Swarms" value={int(o.swarms.length)} sub={o.swarms.map((s) => `${s.label} ${pct(s.construction, 0)} built`).join(' · ')} />
      </MetricGrid>
      {o.loads.length ? (
        <Section title="Habitats & stations">
          {o.loads.map((l) => (
            <Bar key={l.id} label={`${l.label} · ${l.bodyName} · ${l.distanceAu.toFixed(2)} AU`} value={l.servedFraction} max={1}
              color={l.servedFraction > 0.99 ? 'var(--green)' : l.servedFraction > 0 ? 'var(--amber)' : 'var(--red)'}
              right={`${si(l.deliveredW, 'W', 2)} / ${si(l.demandW, 'W', 2)}`} />
          ))}
        </Section>
      ) : null}
    </>
  );
}

function B2Body({ o }: { o: B2BodyView }) {
  return (
    <>
      <MetricGrid>
        <Metric big label="O₂ delivery" value={`${(o.oxygenDeliveryRelative * 100).toFixed(0)}%`} tone={o.oxygenDeliveryRelative < 0.9 ? 'red' : 'green'} sub="of a typical adult (modelled)" />
        <Metric big label="Phenotype rule" value={o.phenotype.replace('_', ' ')} tone="violet" sub={`zygosity: ${o.zygosity}`} />
        <Metric label="Variant haemoglobin" value={pct(o.variantFraction, 0)} />
        <Metric label="Sickled cells (low O₂)" value={pct(o.sickledFraction, 0)} />
        <Metric label="Haemoglobin" value={`${o.hemoglobinGdl.toFixed(1)} g/dL`} sub={`normal ${o.hemoglobinNormalGdl} g/dL`} />
        <Metric label="Cardiac output" value={`${o.cardiacOutputFactor.toFixed(2)}×`} sub="compensation (declared cap)" />
      </MetricGrid>
      {o.edit ? <B2View o={o.edit} /> : null}
    </>
  );
}

function B4Room({ o, c }: { o: { window: B4WindowView | null; transition: B4Output | null }; c?: { window: B4WindowView | null } }) {
  const w = o.window;
  return (
    <>
      {w ? (
        <MetricGrid>
          <Metric big label="Window transmission" value={pct(w.transmission, 1)} tone="cyan" delta={delta(w.transmission, c?.window?.transmission, (x) => pct(x, 1))} />
          <Metric big label="Room illuminance" value={`${int(w.roomLux)} lx`} tone="amber" sub={w.roomLux >= 300 ? 'enough to read' : w.roomLux >= 100 ? 'dim' : 'dark'} delta={delta(w.roomLux, c?.window?.roomLux, (x) => `${int(x)} lx`)} />
          <Metric label="Ion insertion x" value={w.x.toFixed(3)} sub={`${w.material.id} film · ${int(w.thicknessNm)} nm`} />
          <Metric label="Absorption coefficient" value={`${sci(w.alphaPerCm)} cm⁻¹`} sub={`absorbers ${sci(w.absorberDensityCm3)} cm⁻³`} />
        </MetricGrid>
      ) : null}
      {o.transition ? <B4View o={o.transition} /> : null}
    </>
  );
}

function B6Device({ o, c }: { o: { device: B6DeviceView | null; collision: B6Output | null }; c?: { device: B6DeviceView | null } }) {
  const d = o.device;
  const max = d ? Math.max(d.grossW, d.supplyInputW) : 1;
  return (
    <>
      {d ? (
        <>
          <MetricGrid>
            <Metric big label="Usable electric power" value={si(d.electricalW, 'W')} tone="amber" delta={delta(d.electricalW, c?.device?.electricalW, (x) => si(x, 'W'))} />
            <Metric big label="Lights lit" value={`${Math.round(d.litFraction * d.lightCount)} / ${d.lightCount}`} tone="cyan" sub={`load ${si(d.loadW, 'W')}`} />
            <Metric label="Gross annihilation power" value={si(d.grossW, 'W')} sub={`${sci(d.eventRatePerS)} events/s`} />
            <Metric label="Heat" value={si(d.heatW, 'W')} tone="red" sub="uncaptured + conversion loss" />
            <Metric label="Positron supply input" value={si(d.supplyInputW, 'W')} sub={`${sci(d.positronsPerSecond)} e⁺/s`} />
            <Metric label="Net power" value={si(d.netW, 'W')} tone={d.netW < 0 ? 'red' : 'green'} sub={d.netW < 0 ? 'consumes more than it delivers' : 'after supply cost'} />
          </MetricGrid>
          <Section title="Energy ledger">
            <Bar label="Gross (2·mₑc² + KE per event)" value={d.grossW} max={max} right={si(d.grossW, 'W')} color="var(--violet)" />
            <Bar label="Captured by calorimeter" value={d.capturedW} max={max} right={si(d.capturedW, 'W')} color="var(--cyan)" />
            <Bar label="Electrical" value={d.electricalW} max={max} right={si(d.electricalW, 'W')} color="var(--amber)" />
            <Bar label="Supply input (positron production)" value={d.supplyInputW} max={max} right={si(d.supplyInputW, 'W')} color="var(--red)" />
          </Section>
        </>
      ) : null}
      {o.collision ? <B6View o={o.collision} /> : null}
    </>
  );
}

function K3View({ o, c }: { o: K3Output; c?: K3Output }) {
  const ly = (m: number) => m / 9.4607304725808e15;
  return (
    <>
      <MetricGrid>
        <Metric big label="Settled systems" value={int(o.settledCount)} tone="green" sub={`${pct(o.coverageFraction)} of ${int(o.sampleSize)} sample stars`} delta={delta(o.settledCount, c?.settledCount, (x) => int(x))} />
        <Metric big label="Achieved K (sample)" value={o.achievedK.toFixed(3)} tone="cyan" sub={si(o.sampleUsefulPowerW, 'W')} delta={delta(o.achievedK, c?.achievedK, (x) => x.toFixed(3))} />
        <Metric label="Causal front" value={`${int(ly(o.frontRadiusM))} ly`} sub={`${fixed(o.travelSpeedFractionC, 3)} c · ${years(o.scenarioTimeSeconds / YEAR)}`} />
        <Metric label="Farthest settlement" value={`${int(ly(o.settledExtentM))} ly`} sub={`${int(o.reachableCount)} reachable`} />
        <Metric label="Galaxy fraction inside front" value={pct(o.galaxyExtrapolation.fractionOfGalaxyInsideFront, 3)} sub="exponential-disk model" tone="amber" />
        <Metric label="Extrapolated galaxy K" value={o.galaxyExtrapolation.extrapolatedK.toFixed(3)} sub={si(o.galaxyExtrapolation.extrapolatedPowerW, 'W')} tone="amber" />
      </MetricGrid>
      <Section title="Expansion milestones (reachable sample)">
        {o.milestones.map((m) => (
          <Bar key={m.fraction} label={`${pct(m.fraction, 0)} settled`} value={Math.min(m.seconds, o.scenarioTimeSeconds)} max={Math.max(o.scenarioTimeSeconds, 1)} right={years(m.seconds / YEAR)} color={m.seconds <= o.scenarioTimeSeconds ? 'var(--green)' : 'var(--faint)'} />
        ))}
      </Section>
      {o.speculativeFtl ? <div className="chip assumed" style={{ marginBottom: 10 }}>speculative FTL</div> : null}
    </>
  );
}

function B2View({ o }: { o: B2Output }) {
  const idx = o.cdsPosition - 1 - o.windowStart;
  return (
    <>
      <MetricGrid>
        <Metric big label="Codon" value={`${o.beforeCodon} → ${o.afterCodon}`} tone={o.applied ? 'violet' : 'red'} sub={o.applied ? `c.${o.cdsPosition}${o.refBase}>${o.altBase}` : 'edit rejected'} />
        <Metric big label="β-globin residue" value={`${o.beforeAminoAcid}${o.structureResidue} → ${o.afterAminoAcid}`} tone="amber" sub={`HGVS p.${o.hgvsResidue}`} />
        <Metric label="Cell rule outcome" value={o.phenotype.replace('_', ' ')} tone={o.phenotype === 'sickle' ? 'violet' : o.phenotype === 'normal' ? 'green' : 'amber'} sub={o.phenotype === 'sickle' ? `tendency ${pct(o.polymerisationTendency, 0)} (qualitative)` : undefined} />
        <Metric label="Structure" value={o.structureEntry} sub={o.structureMappingValidated ? 'residue mapping validated' : 'mapping not validated'} tone={o.structureMappingValidated ? 'green' : 'red'} />
      </MetricGrid>
      <Section title="Sequence window">
        <SeqRow label="before" seq={o.windowBefore} start={o.windowStart} mark={idx} />
        <SeqRow label="after" seq={o.windowAfter} start={o.windowStart} mark={idx} highlight={o.applied} />
        <div className="mono muted" style={{ fontSize: 11, marginTop: 6 }}>
          protein {o.beforeProteinWindow} → {o.afterProteinWindow}
        </div>
      </Section>
      {o.clinvarId ? (
        <Section title="ClinVar">
          <div style={{ fontSize: 12.5 }}>
            <span className="mono" style={{ color: 'var(--cyan)' }}>{o.clinvarId}</span> · {o.clinicalSignificance} · <span className="muted">{o.reviewStatus}</span>
          </div>
        </Section>
      ) : null}
      <Section title="Mechanism">
        {o.mechanism.map((m) => (
          <div key={m.stage} style={{ display: 'grid', gridTemplateColumns: '74px 1fr', gap: 8, marginBottom: 8 }}>
            <span className="eyebrow" style={{ color: 'var(--violet)' }}>{m.stage}</span>
            <div>
              <div style={{ fontSize: 12.5 }}>{m.title}: <span className="mono">{m.before}</span> → <span className="mono" style={{ color: 'var(--violet)' }}>{m.after}</span></div>
              <div className="muted" style={{ fontSize: 11.5 }}>{m.note}</div>
            </div>
          </div>
        ))}
      </Section>
    </>
  );
}

function SeqRow({ label, seq, start, mark, highlight }: { label: string; seq: string; start: number; mark: number; highlight?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span className="eyebrow" style={{ width: 44 }}>{label}</span>
      <span className="mono" style={{ fontSize: 11.5, letterSpacing: '0.04em', wordBreak: 'break-all' }}>
        {seq.split('').map((b, i) => {
          const codonStart = (start + i) % 3 === 0;
          return (
            <span
              key={i}
              style={{
                color: i === mark ? (highlight ? 'var(--violet)' : 'var(--amber)') : { A: '#3fe08a', T: '#ff7a8c', G: '#ffcf5c', C: '#7ea8ff' }[b] ?? 'var(--text)',
                fontWeight: i === mark ? 700 : 400,
                textShadow: i === mark ? '0 0 8px currentColor' : 'none',
                marginLeft: codonStart && i > 0 ? 4 : 0,
              }}
            >
              {b}
            </span>
          );
        })}
      </span>
    </div>
  );
}

function B4View({ o }: { o: B4Output }) {
  return (
    <>
      <MetricGrid>
        <Metric big label="Transition" value={`${o.initial.configuration} → ${o.final.configuration}`} tone="violet" sub={o.seriesName ?? o.process} />
        <Metric big label="Photon" value={wavelength(o.photonWavelengthNm)} tone="cyan" sub={`${o.band}${o.visibleColorHex ? '' : ' · false colour'}`} />
        <Metric label="ΔE" value={`${o.deltaEnergyEv >= 0 ? '+' : ''}${o.deltaEnergyEv.toFixed(4)} eV`} sub={o.process} />
        <Metric label="Frequency" value={`${sci(o.photonFrequencyHz)} Hz`} />
        <Metric label="Einstein A" value={o.einsteinAPerS ? `${sci(o.einsteinAPerS)} s⁻¹` : '—'} sub={o.upperLifetimeS ? `lifetime ${duration(o.upperLifetimeS)}` : o.selectionRuleAllowed ? 'no evaluated rate' : 'dipole-forbidden'} tone={o.selectionRuleAllowed ? 'green' : 'red'} />
        <Metric label="Energies" value={o.energySource === 'nist' ? 'NIST ASD' : 'Bohr model'} sub={`⟨r⟩ = ${o.orbital.meanRadiusBohr.toFixed(1)} a₀`} />
      </MetricGrid>
      <Section title="Energy levels (relative to ionisation)">
        <Ladder o={o} />
      </Section>
    </>
  );
}

function Ladder({ o }: { o: B4Output }) {
  const ns = [1, 2, 3, 4, 5, 6];
  // Ground state at the bottom, ionisation limit (0 eV) at the top.
  const y = (e: number) => 160 - ((e + 13.7) / 13.7) * 150;
  const lv = (n: number) => o.levels.find((l) => l.n === n)?.energyEv ?? -13.6057 / (n * n);
  const yi = y(o.initial.energyEv);
  const yf = y(o.final.energyEv);
  const color = o.visibleColorHex ?? (o.band === 'uv' ? '#a46bff' : '#ff5a5a');
  return (
    <svg viewBox="0 0 320 170" style={{ width: '100%', height: 170 }}>
      {ns.map((n) => (
        <g key={n}>
          <line x1={40} x2={300} y1={y(lv(n))} y2={y(lv(n))} stroke={n === o.final.n ? 'var(--cyan)' : 'rgba(140,200,255,0.25)'} strokeWidth={n === o.final.n ? 2 : 1} />
          <text x={8} y={y(lv(n)) + 4} fill="var(--muted)" fontSize={10} fontFamily="JetBrains Mono">n={n}</text>
          <text x={302} y={y(lv(n)) - 3} fill="var(--faint)" fontSize={9} fontFamily="JetBrains Mono" textAnchor="end">{lv(n).toFixed(2)} eV</text>
        </g>
      ))}
      <line x1={40} x2={300} y1={y(0)} y2={y(0)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
      <defs>
        <marker id="arr" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" fill={color} />
        </marker>
      </defs>
      <line x1={170} x2={170} y1={yi} y2={yf + (yf > yi ? -4 : 4)} stroke={color} strokeWidth={2.5} markerEnd="url(#arr)" style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
      <text x={178} y={(yi + yf) / 2} fill={color} fontSize={11} fontFamily="JetBrains Mono">{wavelength(o.photonWavelengthNm)}</text>
    </svg>
  );
}

function B5View({ o }: { o: B5Output }) {
  return (
    <>
      <MetricGrid>
        <Metric big label="Positron energy" value={`${o.positronKineticKeV.toFixed(1)} keV`} tone="cyan" sub={`endpoint ${o.positronEndpointKeV.toFixed(1)} keV`} />
        <Metric big label="Gamma" value={`${o.gammaKeV.toFixed(1)} keV`} tone="amber" sub="²²Ne* de-excitation" />
        <Metric label="Neutrino" value={`${o.neutrinoEnergyKeV.toFixed(1)} keV`} />
        <Metric label="Half-life" value={years(o.halfLifeS / YEAR)} sub={`${sci(o.activityBqPerMicrogram)} Bq/µg`} />
      </MetricGrid>
      <Section title="Conservation ledger">
        <Ledger rows={[
          ['Charge', `${o.ledger.chargeIn}`, `${o.ledger.chargeOut}`, o.ledger.chargeIn === o.ledger.chargeOut],
          ['Baryon number', `${o.ledger.baryonIn}`, `${o.ledger.baryonOut}`, o.ledger.baryonIn === o.ledger.baryonOut],
          ['Lepton number', `${o.ledger.leptonIn}`, `${o.ledger.leptonOut}`, o.ledger.leptonIn === o.ledger.leptonOut],
          ['Energy (keV)', o.ledger.energyAvailableKeV.toFixed(2), o.ledger.energyAccountedKeV.toFixed(2), o.ledger.balanced],
        ]} />
      </Section>
    </>
  );
}

function B6View({ o, c }: { o: B6Output; c?: B6Output }) {
  const cons = o.conservation;
  return (
    <>
      <MetricGrid>
        <Metric big label="Centre-of-mass energy" value={energyMeV(o.totalEnergyMev)} tone="amber" delta={delta(o.totalEnergyMev, c?.totalEnergyMev, energyMeV)} />
        <Metric big label="Each photon" value={energyMeV(o.photonEnergyMev)} tone="cyan" sub={wavelength(o.photonWavelengthNm)} />
        <Metric label="Lepton speed" value={`${o.incomingBetaFractionC.toFixed(6)} c`} sub={`γ = ${o.lorentzGamma.toFixed(3)}`} />
        <Metric label="Electron mass" value={`${o.electronMassMev} MeV`} sub="PDG 2025" />
      </MetricGrid>
      <Section title="Conservation ledger">
        <Ledger rows={[
          ['Energy (MeV)', cons.energyInMev.toPrecision(7), cons.energyOutMev.toPrecision(7), cons.residualEnergyMev < 1e-9],
          ['|Σp| (MeV/c)', Math.hypot(...cons.momentumInMevC).toExponential(1), Math.hypot(...cons.momentumOutMevC).toExponential(1), cons.residualMomentumMevC < 1e-9],
          ['Charge', `${cons.chargeIn}`, `${cons.chargeOut}`, cons.chargeIn === cons.chargeOut],
          ['Lepton number', `${cons.leptonNumberIn}`, `${cons.leptonNumberOut}`, cons.leptonNumberIn === cons.leptonNumberOut],
        ]} />
      </Section>
      <Section title="Channels at this energy">
        {o.channels.map((ch) => (
          <div key={ch.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', color: ch.open ? 'var(--text)' : 'var(--faint)' }}>
            <span>{ch.label}</span>
            <span className="mono" style={{ fontSize: 11 }}>
              {ch.executed ? <span style={{ color: 'var(--green)' }}>executed</span> : ch.open ? <span style={{ color: 'var(--amber)' }}>open · not simulated</span> : `closed < ${energyMeV(ch.thresholdMev)}`}
            </span>
          </div>
        ))}
      </Section>
    </>
  );
}

function Ledger({ rows }: { rows: [string, string, string, boolean][] }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 28px', padding: '6px 10px', background: 'rgba(255,255,255,0.03)' }} className="eyebrow">
        <span>Quantity</span><span>In</span><span>Out</span><span />
      </div>
      {rows.map(([q, a, b, ok]) => (
        <div key={q} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr 28px', padding: '6px 10px', borderTop: '1px solid var(--line)', fontSize: 12 }}>
          <span className="muted">{q}</span>
          <span className="mono">{a}</span>
          <span className="mono">{b}</span>
          <span style={{ color: ok ? 'var(--green)' : 'var(--red)' }}>{ok ? '✓' : '✗'}</span>
        </div>
      ))}
    </div>
  );
}
