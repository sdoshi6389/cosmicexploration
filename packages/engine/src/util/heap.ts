/** Binary min-heap keyed by a numeric priority (used by Dijkstra in K3). */
export class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, val: number): void {
    const { keys, vals } = this;
    let i = keys.length;
    keys.push(key);
    vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p]! <= key) break;
      keys[i] = keys[p]!;
      vals[i] = vals[p]!;
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Pop the minimum; returns [key, val]. */
  pop(): [number, number] {
    const { keys, vals } = this;
    const topK = keys[0]!;
    const topV = vals[0]!;
    const lastK = keys.pop()!;
    const lastV = vals.pop()!;
    const n = keys.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r]! < keys[l]! ? r : l;
        if (keys[c]! >= lastK) break;
        keys[i] = keys[c]!;
        vals[i] = vals[c]!;
        i = c;
      }
      keys[i] = lastK;
      vals[i] = lastV;
    }
    return [topK, topV];
  }
}
