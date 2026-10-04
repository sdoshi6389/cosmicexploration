/** Static 3-D k-d tree over a flat Float64Array of xyz triples (for k-nearest-neighbour graphs). */
export class KdTree {
  private readonly idx: Int32Array;

  constructor(private readonly pts: Float64Array) {
    const n = pts.length / 3;
    this.idx = new Int32Array(n);
    for (let i = 0; i < n; i++) this.idx[i] = i;
    this.build(0, n, 0);
  }

  private build(lo: number, hi: number, depth: number): void {
    if (hi - lo <= 1) return;
    const axis = depth % 3;
    const mid = (lo + hi) >> 1;
    this.select(lo, hi - 1, mid, axis);
    this.build(lo, mid, depth + 1);
    this.build(mid + 1, hi, depth + 1);
  }

  /** Quickselect so idx[k] is the median along `axis` within [lo, hi]. */
  private select(lo: number, hi: number, k: number, axis: number): void {
    const { idx, pts } = this;
    while (hi > lo) {
      const pivot = pts[idx[(lo + hi) >> 1]! * 3 + axis]!;
      let i = lo;
      let j = hi;
      while (i <= j) {
        while (pts[idx[i]! * 3 + axis]! < pivot) i++;
        while (pts[idx[j]! * 3 + axis]! > pivot) j--;
        if (i <= j) {
          const t = idx[i]!;
          idx[i] = idx[j]!;
          idx[j] = t;
          i++;
          j--;
        }
      }
      if (k <= j) hi = j;
      else if (k >= i) lo = i;
      else return;
    }
  }

  /** k nearest neighbours of point `q` (excluding index `self`); returns [index, distance²] pairs. */
  knn(q: number, k: number, maxDist2 = Infinity): [number, number][] {
    const { pts } = this;
    const qx = pts[q * 3]!;
    const qy = pts[q * 3 + 1]!;
    const qz = pts[q * 3 + 2]!;
    const best: [number, number][] = [];
    let worst = maxDist2;
    const visit = (lo: number, hi: number, depth: number) => {
      if (hi <= lo) return;
      const mid = (lo + hi) >> 1;
      const p = this.idx[mid]!;
      const dx = pts[p * 3]! - qx;
      const dy = pts[p * 3 + 1]! - qy;
      const dz = pts[p * 3 + 2]! - qz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (p !== q && d2 < worst) {
        best.push([p, d2]);
        best.sort((a, b) => a[1] - b[1]);
        if (best.length > k) best.pop();
        if (best.length === k) worst = best[k - 1]![1];
      }
      const axis = depth % 3;
      const diff = axis === 0 ? dx : axis === 1 ? dy : dz; // point minus query along axis
      const [first, second]: [number, number][] =
        diff > 0 ? [[lo, mid], [mid + 1, hi]] : [[mid + 1, hi], [lo, mid]];
      visit(first[0], first[1], depth + 1);
      if (diff * diff < worst) visit(second[0], second[1], depth + 1);
    };
    visit(0, this.idx.length, 0);
    return best;
  }
}
