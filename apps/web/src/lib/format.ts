const SUP: Record<string, string> = {
  '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

export function sup(n: number | string): string {
  return String(n).split('').map((c) => SUP[c] ?? c).join('');
}

/** 3.83×10²⁶ style. */
export function sci(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 4) return v.toLocaleString('en-US', { maximumFractionDigits: Math.max(0, digits - e) });
  const m = v / 10 ** e;
  return `${m.toFixed(digits)}×10${sup(e)}`;
}

const SI: [number, string][] = [
  [1e24, 'Y'], [1e21, 'Z'], [1e18, 'E'], [1e15, 'P'], [1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'],
];

/** 21.3 TW style; falls back to scientific notation beyond yotta. */
export function si(v: number | null | undefined, unit: string, digits = 3): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e27) return `${sci(v, 2)} ${unit}`;
  for (const [f, p] of SI) {
    if (a >= f) return `${(v / f).toPrecision(digits)} ${p}${unit}`;
  }
  return `${v.toPrecision(digits)} ${unit}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

export function fixed(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

export function int(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return Math.round(v).toLocaleString('en-US');
}

export function years(v: number): string {
  if (!Number.isFinite(v)) return '∞';
  if (v >= 1e9) return `${(v / 1e9).toPrecision(3)} Gyr`;
  if (v >= 1e6) return `${(v / 1e6).toPrecision(3)} Myr`;
  if (v >= 1e4) return `${(v / 1e3).toPrecision(3)} kyr`;
  return `${Math.round(v).toLocaleString('en-US')} yr`;
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const a = Math.abs(seconds);
  if (a < 1e-9) return `${(seconds * 1e12).toPrecision(3)} ps`;
  if (a < 1e-6) return `${(seconds * 1e9).toPrecision(3)} ns`;
  if (a < 1e-3) return `${(seconds * 1e6).toPrecision(3)} µs`;
  if (a < 1) return `${(seconds * 1e3).toPrecision(3)} ms`;
  if (a < 3600) return `${seconds.toPrecision(3)} s`;
  if (a < 86400 * 2) return `${(seconds / 3600).toPrecision(3)} h`;
  if (a < 86400 * 730) return `${(seconds / 86400).toPrecision(3)} d`;
  return years(seconds / (365.25 * 86400));
}

export function wavelength(nm: number | null | undefined): string {
  if (nm == null || !Number.isFinite(nm)) return '—';
  if (nm < 1e-3) return `${(nm * 1000).toPrecision(3)} pm`;
  if (nm < 1000) return `${nm.toPrecision(4)} nm`;
  if (nm < 1e6) return `${(nm / 1000).toPrecision(4)} µm`;
  if (nm < 1e9) return `${(nm / 1e6).toPrecision(4)} mm`;
  return `${(nm / 1e9).toPrecision(3)} m`;
}

export function energyMeV(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e3) return `${(v / 1e3).toPrecision(4)} GeV`;
  if (a >= 1) return `${v.toPrecision(5)} MeV`;
  if (a >= 1e-3) return `${(v * 1e3).toPrecision(4)} keV`;
  return `${(v * 1e6).toPrecision(4)} eV`;
}

export function kLabel(k: number | null | undefined): string {
  if (k == null || !Number.isFinite(k)) return '—';
  return `K ${k.toFixed(3)}`;
}

export function scaleLabel(exp: number): string {
  return `10${sup(exp)} m`;
}

export function roman(n: number): string {
  return ['0', 'I', 'II', 'III', 'IV', 'V', 'VI'][n] ?? String(n);
}
