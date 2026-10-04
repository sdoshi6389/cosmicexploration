/** Continental regions used by the K1 grid. Boxes are coarse selection/rendering bounds only. */
export interface RegionDef {
  id: string;
  name: string;
  owidEntity: string;
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
  centroid: [number, number];
  /** Declared typical capacity factors (assumptions) by technology. */
  capacityFactor: Record<string, number>;
}

const CF = (solar: number, wind: number) => ({
  solar, wind, fusion: 0.9, fission: 0.9, geothermal: 0.8, orbital_solar: 0.95,
});

export const REGIONS: RegionDef[] = [
  { id: 'north_america', name: 'North America', owidEntity: 'North America', latMin: 10, latMax: 72, lonMin: -168, lonMax: -52, centroid: [42, -100], capacityFactor: CF(0.2, 0.35) },
  { id: 'south_america', name: 'South America', owidEntity: 'South America', latMin: -56, latMax: 12, lonMin: -82, lonMax: -34, centroid: [-15, -60], capacityFactor: CF(0.21, 0.38) },
  { id: 'europe', name: 'Europe', owidEntity: 'Europe', latMin: 35, latMax: 71, lonMin: -25, lonMax: 45, centroid: [52, 12], capacityFactor: CF(0.13, 0.3) },
  { id: 'africa', name: 'Africa', owidEntity: 'Africa', latMin: -35, latMax: 37, lonMin: -18, lonMax: 52, centroid: [5, 20], capacityFactor: CF(0.25, 0.3) },
  { id: 'asia', name: 'Asia', owidEntity: 'Asia', latMin: -10, latMax: 72, lonMin: 45, lonMax: 150, centroid: [35, 95], capacityFactor: CF(0.18, 0.28) },
  { id: 'oceania', name: 'Oceania', owidEntity: 'Oceania', latMin: -48, latMax: 0, lonMin: 110, lonMax: 180, centroid: [-25, 135], capacityFactor: CF(0.22, 0.35) },
];

export function regionOf(lat: number, lon: number): RegionDef | undefined {
  return REGIONS.find((r) => lat >= r.latMin && lat <= r.latMax && lon >= r.lonMin && lon <= r.lonMax);
}

export function regionDistanceKm(a: RegionDef, b: RegionDef): number {
  const r = Math.PI / 180;
  const [la1, lo1] = a.centroid;
  const [la2, lo2] = b.centroid;
  const s = Math.sin(((la2 - la1) * r) / 2) ** 2 + Math.cos(la1 * r) * Math.cos(la2 * r) * Math.sin(((lo2 - lo1) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(s)));
}
