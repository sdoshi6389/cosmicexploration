import {
  buildScienceBundle,
  SCIENCE_TABLE_NAMES,
  type ScienceBundle,
  type ScienceTableName,
  type ScienceTables,
} from '@cosmos/engine';
import { create } from 'zustand';
import { connectSpacetime, loadScience, loadScienceFromCache, STDB_DB } from '../data/spacetime';
import type { DbConnection } from '../module_bindings';
import { handleDisconnect, startConnectionWatchdog, useWorld } from './world';

export type BootPhase = 'boot' | 'connecting' | 'loading' | 'building' | 'ready' | 'error';

interface ScienceState {
  phase: BootPhase;
  origin: 'spacetimedb' | 'local-cache' | 'mixed' | null;
  tables: Partial<ScienceTables>;
  bundle: ScienceBundle | null;
  conn: DbConnection | null;
  identityHex: string | null;
  connected: boolean;
  error: string | null;
  log: { text: string; ok: boolean | null }[];
  fromCache: ScienceTableName[];
  boot: () => Promise<void>;
}

function connect(timeoutMs: number): Promise<{ conn: DbConnection; identityHex: string } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { conn: DbConnection; identityHex: string } | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      connectSpacetime({
        onConnect: (conn, identityHex) => {
          clearTimeout(timer);
          useScience.setState({ connected: true });
          finish({ conn, identityHex });
        },
        onDisconnect: () => {
          useScience.setState({ connected: false });
          handleDisconnect();
        },
        onError: () => {
          clearTimeout(timer);
          finish(null);
        },
      });
    } catch {
      finish(null);
    }
  });
}

export const useScience = create<ScienceState>((set, get) => ({
  phase: 'boot',
  origin: null,
  tables: {},
  bundle: null,
  conn: null,
  identityHex: null,
  connected: false,
  error: null,
  log: [],
  fromCache: [],

  boot: async () => {
    if (get().phase !== 'boot') return;
    const log = (text: string, ok: boolean | null = null) => set((s) => ({ log: [...s.log, { text, ok }] }));
    set({ phase: 'connecting' });
    log(`Connecting to SpacetimeDB · ${STDB_DB}`);
    const link = await connect(12_000);
    let tables: Partial<ScienceTables> = {};
    let origin: ScienceState['origin'] = null;
    const fromCache: ScienceTableName[] = [];
    set({ phase: 'loading' });
    if (link) {
      set({ conn: link.conn, identityHex: link.identityHex });
      log(`Identity ${link.identityHex.slice(0, 12)}…`, true);
      try {
        const loaded = await loadScience(link.conn, (m) => log(m));
        tables = loaded.tables;
        origin = 'spacetimedb';
        const total = SCIENCE_TABLE_NAMES.reduce((s, t) => s + (tables[t]?.length ?? 0), 0);
        log(`${total.toLocaleString()} rows across ${SCIENCE_TABLE_NAMES.length} tables`, true);
      } catch (e) {
        log(`Subscription failed: ${e instanceof Error ? e.message : String(e)}`, false);
      }
    } else {
      log('SpacetimeDB unreachable — using the offline cache', false);
    }
    const empty = SCIENCE_TABLE_NAMES.filter((t) => !tables[t] || tables[t]!.length === 0);
    if (empty.length) {
      const cache = await loadScienceFromCache();
      for (const t of empty) {
        if (cache[t]?.length) {
          (tables as Record<string, unknown[]>)[t] = cache[t]!;
          fromCache.push(t);
        }
      }
      origin = origin === 'spacetimedb' ? (fromCache.length ? 'mixed' : 'spacetimedb') : 'local-cache';
      if (fromCache.length && link) log(`Filled from offline cache: ${fromCache.join(', ')}`, null);
    }
    set({ phase: 'building', tables, origin, fromCache });
    log('Assembling immutable baseline');
    try {
      const bundle = buildScienceBundle(tables);
      log(`Baseline ${bundle.baselineId} · ${bundle.stars.length.toLocaleString()} stars · ${bundle.bodies.length} bodies`, true);
      set({ bundle });
      await useWorld.getState().init(bundle, link?.conn ?? null, link?.identityHex ?? null);
      if (link) startConnectionWatchdog();
      log('Worlds synchronised', true);
      set({ phase: 'ready' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(msg, false);
      set({ phase: 'error', error: msg });
    }
  },
}));
