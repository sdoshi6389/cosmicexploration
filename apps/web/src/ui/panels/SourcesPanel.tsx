import { ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { STDB_DB } from '../../data/spacetime';
import { int } from '../../lib/format';
import type { StopId } from '../../navigation/stops';
import { useScience } from '../../state/science';
import { useTable } from '../../state/selectors';
import { EvidenceChip, Section } from '../controls';

const SOURCES_FOR: Record<StopId, string[]> = {
  cosmic: ['sdss_dr18'],
  galaxy: ['esa_gaia_dr3', 'cds_simbad', 'nasa_exoplanet_archive', 'nasa_heasarc'],
  solar: ['jpl_horizons', 'naif_spice', 'nasa_pds', 'nasa_nssdc_factsheet'],
  earth: ['owid_energy', 'nasa_earthdata', 'natural_earth', 'noaa_ncei', 'usgs_earthquakes', 'nasa_nssdc_factsheet', 'naif_spice'],
  town: ['ncbi_clinvar', 'ensembl_rest', 'ncbi_datasets'],
  body: ['ncbi_clinvar', 'ensembl_rest', 'rcsb_pdb'],
  cell: ['ncbi_datasets', 'ensembl_rest', 'ncbi_clinvar', 'rcsb_pdb', 'human_cell_atlas'],
  protein: ['rcsb_pdb'],
  gene: ['ncbi_datasets', 'ensembl_rest', 'ncbi_clinvar'],
  city: ['pubchem', 'nist_asd'],
  room: ['pubchem', 'nist_asd'],
  lattice: ['pubchem'],
  atom: ['nist_asd'],
  grid: ['pdg'],
  device: ['pdg', 'iaea_livechart'],
  particle: ['pdg'],
};

export function SourcesPanel({ stop }: { stop: StopId }) {
  const manifests = useTable('dataset_manifest');
  const origin = useScience((s) => s.origin);
  const fromCache = useScience((s) => s.fromCache);
  const [showAll, setShowAll] = useState(false);
  const ids = showAll ? manifests.map((m) => m.id) : SOURCES_FOR[stop];
  const rows = ids.map((id) => manifests.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => Boolean(m));
  const total = manifests.reduce((s, m) => s + m.rowCount, 0);
  return (
    <div>
      <div style={{ padding: 12, borderRadius: 11, border: '1px solid var(--line)', marginBottom: 14, background: 'rgba(92,225,255,0.04)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="eyebrow">Baseline served from</span>
          <span className={`chip ${origin === 'spacetimedb' ? 'observed' : 'assumed'}`}><span className="dot" />{origin ?? '—'}</span>
        </div>
        <div className="mono" style={{ fontSize: 12, marginTop: 6 }}>SpacetimeDB · {STDB_DB}</div>
        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
          {manifests.length} sources · {int(total)} rows · immutable, versioned baseline
          {fromCache.length ? ` · offline cache for ${fromCache.join(', ')}` : ''}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}>
        <button type="button" className="btn sm ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Show this stop only' : `Show all ${manifests.length} sources`}
        </button>
      </div>
      {rows.map((m) => (
        <Section key={m.id} title={m.category.replace('_', ' ')}>
          <div style={{ padding: 12, borderRadius: 11, border: '1px solid var(--line)', background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 600, fontSize: 13, flex: 1 }}>{m.sourceName}</div>
              <EvidenceChip kind={m.validationStatus === 'ok' ? 'observed' : 'assumed'} title={`validation: ${m.validationStatus}`} />
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>{m.coverage}</div>
            <dl style={{ display: 'grid', gridTemplateColumns: '78px 1fr', gap: '3px 10px', margin: '10px 0 0', fontSize: 11.5 }}>
              <dt className="faint">Release</dt><dd style={{ margin: 0 }}>{m.release}</dd>
              <dt className="faint">Retrieved</dt><dd style={{ margin: 0 }} className="mono">{m.retrievedAt}</dd>
              <dt className="faint">Tables</dt><dd style={{ margin: 0 }} className="mono">{m.tables}</dd>
              <dt className="faint">Units</dt><dd style={{ margin: 0 }}>{m.units || '—'}</dd>
              {m.frame ? (<><dt className="faint">Frame</dt><dd style={{ margin: 0 }}>{m.frame}</dd></>) : null}
              <dt className="faint">Licence</dt><dd style={{ margin: 0 }}>{m.license}</dd>
              <dt className="faint">Query</dt><dd style={{ margin: 0, wordBreak: 'break-word' }} className="mono">{m.query.length > 220 ? `${m.query.slice(0, 220)}…` : m.query}</dd>
              {m.checksum ? (<><dt className="faint">Checksum</dt><dd style={{ margin: 0, wordBreak: 'break-all' }} className="mono">{m.checksum.slice(0, 64)}…</dd></>) : null}
              {m.note ? (<><dt className="faint">Note</dt><dd style={{ margin: 0, color: 'var(--amber)' }}>{m.note}</dd></>) : null}
            </dl>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {m.sourceUrls.split(' ').filter(Boolean).slice(0, 3).map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="btn sm" style={{ textDecoration: 'none', maxWidth: '100%' }}>
                  <ExternalLink size={11} /> {new URL(u).hostname}
                </a>
              ))}
            </div>
            <div className="faint" style={{ fontSize: 10.5, marginTop: 8 }}>{m.attribution}</div>
          </div>
        </Section>
      ))}
    </div>
  );
}
