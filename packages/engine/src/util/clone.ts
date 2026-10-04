/** JSON deep clone (engine values are plain data; works in every JS runtime incl. SpacetimeDB). */
export function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
