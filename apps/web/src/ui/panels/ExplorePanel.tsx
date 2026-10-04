import { useMemo } from 'react';
import { int } from '../../lib/format';
import type { StopId } from '../../navigation/stops';
import { STOP_BY_ID } from '../../navigation/stops';
import { useTable } from '../../state/selectors';
import { useUi } from '../../state/ui';
import { Metric, MetricGrid, Section } from '../controls';

/** Exploration-only stops: the cosmic web and the molecular bridge. */
export function ExplorePanel({ stop }: { stop: StopId }) {
  const s = STOP_BY_ID[stop];
  return (
    <div>
      <p className="muted" style={{ marginTop: 0, fontSize: 12.5, lineHeight: 1.55 }}>{s.blurb}</p>
      {stop === 'cosmic' ? <Cosmic /> : null}
      {stop === 'protein' ? <Molecules /> : null}
    </div>
  );
}

function Cosmic() {
  const gals = useTable('sdss_galaxy');
  const stats = useMemo(() => {
    let zmax = 0;
    let dmax = 0;
    for (const g of gals) {
      zmax = Math.max(zmax, g.redshift);
      dmax = Math.max(dmax, g.comovingMpc);
    }
    return { zmax, dmax };
  }, [gals]);
  return (
    <>
      <MetricGrid>
        <Metric big label="Galaxies" value={int(gals.length)} tone="cyan" sub="SDSS DR18 spectroscopic" />
        <Metric big label="Depth" value={`${int(stats.dmax)} Mpc`} tone="amber" sub={`z ≤ ${stats.zmax.toFixed(3)}`} />
      </MetricGrid>
      <Section title="What you are seeing">
        <ul className="muted" style={{ margin: 0, paddingLeft: 16, fontSize: 12.2, lineHeight: 1.6 }}>
          <li>Each point is a galaxy with a measured spectroscopic redshift.</li>
          <li>Distances are derived from redshift with the Planck 2018 cosmology — a model, not a measurement.</li>
          <li>The wedge shape is the SDSS survey footprint; filaments and voids are real large-scale structure.</li>
          <li>A Kardashev III civilisation commands one of these points. Nothing here has been observed to glow in the infrared like one.</li>
        </ul>
      </Section>
    </>
  );
}

function Molecules() {
  const mols = useTable('molecule');
  const cid = useUi((s) => s.moleculeCid);
  const setCid = useUi((s) => s.setMoleculeCid);
  return (
    <>
      <Section title="Molecule">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <button type="button" className={`btn sm ${cid === null ? 'primary' : ''}`} onClick={() => setCid(null)}>Heme + O₂ (4HHB)</button>
          {mols.filter((m) => m.atomCount > 0 && m.cid !== 977).map((m) => (
            <button key={m.cid} type="button" className={`btn sm ${cid === m.cid ? 'primary' : ''}`} onClick={() => setCid(m.cid)}>
              {m.name}
            </button>
          ))}
        </div>
      </Section>
      {cid ? (
        (() => {
          const m = mols.find((x) => x.cid === cid);
          if (!m) return null;
          return (
            <Section title="PubChem record">
              <MetricGrid>
                <Metric label="Formula" value={m.formula} tone="cyan" />
                <Metric label="Molecular weight" value={`${m.molecularWeight} g/mol`} />
                <Metric label="Atoms (3D)" value={int(m.atomCount)} />
                <Metric label="CID" value={String(m.cid)} />
              </MetricGrid>
              <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{m.iupacName}</div>
              <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>{m.conformer}</div>
            </Section>
          );
        })()
      ) : (
        <Section title="Heme b">
          <div className="muted" style={{ fontSize: 12.2, lineHeight: 1.6 }}>
            Atom positions come from the HEM ligand of PDB 4HHB chain A (X-ray, 1.74 Å). PubChem computes no 3D conformer for iron complexes, so the crystal geometry is the honest choice. The O₂ molecule is PubChem CID 977; its approach and binding motion are illustrative.
          </div>
        </Section>
      )}
    </>
  );
}
