import { SCIENCE_TABLE_NAMES, type ScienceTableName, type ScienceTables } from '@cosmos/engine';
import { DbConnection } from '../module_bindings';

const HOST = (import.meta.env.VITE_SPACETIME_HOST as string | undefined) ?? 'https://maincloud.spacetimedb.com';
export const STDB_URI = HOST.replace(/^http/, 'ws');
export const STDB_DB = (import.meta.env.VITE_SPACETIME_DB as string | undefined) ?? 'cosmicexploration-dejjt';
const TOKEN_KEY = `cosmos.stdb.token.${STDB_DB}`;

function safeGet(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode: identity is per-session */
  }
}

function camel(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export interface SpacetimeHandlers {
  onConnect: (conn: DbConnection, identityHex: string) => void;
  onDisconnect: (error?: Error) => void;
  onError: (error: Error) => void;
}

/** Open the realtime connection; the identity token persists per browser so branches stay yours. */
export function connectSpacetime(h: SpacetimeHandlers): DbConnection {
  return DbConnection.builder()
    .withUri(STDB_URI)
    .withDatabaseName(STDB_DB)
    .withToken(safeGet(TOKEN_KEY))
    .withCompression('gzip')
    .onConnect((conn, identity, token) => {
      safeSet(TOKEN_KEY, token);
      h.onConnect(conn, identity.toHexString());
    })
    .onConnectError((_ctx, err) => h.onError(err))
    .onDisconnect((_ctx, err) => h.onDisconnect(err))
    .build();
}

/** SpacetimeDB options arrive as `undefined`; the engine contract uses `null` for missing values. */
function normalize(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v === undefined ? null : v;
  return out;
}

/* ---------------------------------------------------- browser cache of the baseline
 * The science baseline is immutable per dataset release, so after the first visit
 * we keep it in IndexedDB keyed by the manifest fingerprint. Boot subscribes only
 * to `dataset_manifest`; if the fingerprint matches, the ~120k-row subscription is
 * skipped. Any re-ingest changes the fingerprint and refreshes the cache.
 */
const IDB_NAME = 'cosmos-science';
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('baseline');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = db.transaction('baseline', 'readonly').objectStore('baseline').get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}
async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('baseline', 'readwrite');
    tx.objectStore('baseline').clear();
    tx.objectStore('baseline').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function subscribeOnce(conn: DbConnection, queries: string[], timeoutMs: number): Promise<{ unsubscribe: () => void }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SpacetimeDB subscription timed out')), timeoutMs);
    const h = conn.subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        resolve({ unsubscribe: () => { try { h.unsubscribe(); } catch { /* ended */ } } });
      })
      .onError((ctx) => {
        clearTimeout(timer);
        const ev = (ctx as { event?: unknown }).event;
        reject(ev instanceof Error ? ev : new Error('SpacetimeDB subscription failed'));
      })
      .subscribe(queries);
  });
}

/** Load the science baseline: browser cache when the manifest matches, else SpacetimeDB. */
export async function loadScience(conn: DbConnection, onStatus?: (s: string) => void): Promise<{ tables: Partial<ScienceTables>; fromBrowserCache: boolean }> {
  const manifestSub = await subscribeOnce(conn, ['SELECT * FROM dataset_manifest'], 20_000);
  const manifest = [...(conn.db as unknown as Record<string, { iter: () => Iterable<Record<string, unknown>> }>).datasetManifest!.iter()];
  manifestSub.unsubscribe();
  const fingerprint = manifest.map((m) => `${m.id}:${m.retrievedAt}:${m.rowCount}`).sort().join('|');
  try {
    const cached = await idbGet<{ fingerprint: string; tables: Partial<ScienceTables> }>('baseline');
    if (cached && cached.fingerprint === fingerprint && fingerprint) {
      onStatus?.('Baseline unchanged — loaded from browser cache');
      return { tables: cached.tables, fromBrowserCache: true };
    }
  } catch {
    /* IndexedDB unavailable (private mode): fall through */
  }
  onStatus?.('Replicating science tables from SpacetimeDB');
  const tables = await loadScienceFromSpacetime(conn);
  void idbPut('baseline', { fingerprint, tables }).catch(() => undefined);
  return { tables, fromBrowserCache: false };
}

/** Subscribe to every science table and resolve with the replicated rows. */
export function loadScienceFromSpacetime(conn: DbConnection, timeoutMs = 45_000): Promise<Partial<ScienceTables>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SpacetimeDB subscription timed out')), timeoutMs);
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        const db = conn.db as unknown as Record<string, { iter: () => Iterable<Record<string, unknown>> }>;
        const tables: Partial<Record<ScienceTableName, unknown[]>> = {};
        for (const t of SCIENCE_TABLE_NAMES) {
          const handle = db[camel(t)];
          tables[t] = handle ? Array.from(handle.iter(), normalize) : [];
        }
        resolve(tables as Partial<ScienceTables>);
      })
      .onError((ctx) => {
        clearTimeout(timer);
        const ev = (ctx as { event?: unknown }).event;
        reject(ev instanceof Error ? ev : new Error('SpacetimeDB subscription failed'));
      })
      .subscribe(SCIENCE_TABLE_NAMES.map((t) => `SELECT * FROM ${t}`));
  });
}

/** Offline fallback: the ingest pipeline mirrors every table to /data/tables/<name>.json. */
export async function loadScienceFromCache(onTable?: (t: string, n: number) => void): Promise<Partial<ScienceTables>> {
  const out: Partial<Record<ScienceTableName, unknown[]>> = {};
  await Promise.all(
    SCIENCE_TABLE_NAMES.map(async (t) => {
      try {
        const res = await fetch(`/data/tables/${t}.json`);
        if (!res.ok) throw new Error(String(res.status));
        const rows = (await res.json()) as unknown[];
        out[t] = rows;
        onTable?.(t, rows.length);
      } catch {
        out[t] = [];
      }
    }),
  );
  return out as Partial<ScienceTables>;
}

export interface SubscriptionHandle {
  unsubscribe: () => void;
}

function subscribe(conn: DbConnection, queries: string[], timeoutMs = 20_000): Promise<SubscriptionHandle> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SpacetimeDB subscription timed out')), timeoutMs);
    const handle = conn
      .subscriptionBuilder()
      .onApplied(() => {
        clearTimeout(timer);
        resolve({ unsubscribe: () => { try { handle.unsubscribe(); } catch { /* already ended */ } } });
      })
      .onError((ctx) => {
        clearTimeout(timer);
        const ev = (ctx as { event?: unknown }).event;
        reject(ev instanceof Error ? ev : new Error('SpacetimeDB subscription failed'));
      })
      .subscribe(queries);
  });
}

/** Phase 1: my memberships. Row-level security limits these tables to sessions I belong to. */
export function subscribeMembership(conn: DbConnection): Promise<SubscriptionHandle> {
  return subscribe(conn, ['SELECT * FROM session_member', 'SELECT * FROM world_session', 'SELECT * FROM session_invite']);
}

const SESSION_TABLES = [
  'presence', 'presence_pose', 'world_branch', 'world_event', 'command_receipt', 'intervention', 'simulation_parameter',
  'model_output', 'dependency_edge', 'simulation_clock', 'calculation_job', 'generated_asset',
];

/** Phase 2: everything for one session (all branches, so compare works), scoped server-side and by query. */
export function subscribeSession(conn: DbConnection, sessionId: string): Promise<SubscriptionHandle> {
  if (!/^[A-Za-z0-9_.:-]+$/.test(sessionId)) return Promise.reject(new Error('bad session id'));
  return subscribe(conn, SESSION_TABLES.map((t) => `SELECT * FROM ${t} WHERE session_id = '${sessionId}'`));
}

/** Reconnect with the stored token (same identity, so memberships and roles persist). */
export function reconnectSpacetime(h: SpacetimeHandlers): DbConnection {
  return connectSpacetime(h);
}
