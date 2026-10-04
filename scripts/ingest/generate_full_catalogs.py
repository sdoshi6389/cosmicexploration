#!/usr/bin/env python3
"""Build large, labeled catalogs for every Spacetime science table."""
from __future__ import annotations

import json
import math
import random
from pathlib import Path

from _common import DATA_NORMALIZED, write_json
from gaia_curated import CURATED_STARS
from starcolor import color_from_bp_rp


def luminosity_from_g(g_mag: float | None, dist_pc: float) -> float | None:
    if g_mag is None or dist_pc <= 0:
        return None
    abs_g = g_mag - 5 * math.log10(max(dist_pc, 0.1) / 10.0)
    return LSUN * 10 ** (-0.4 * (abs_g - 4.83))

PC = 3.085677581e16
LY = 9.4607304725808e15
LSUN = 3.828e26
AU = 1.495978707e11


def rng(seed: int = 4242) -> random.Random:
    return random.Random(seed)


def named_stars() -> list[dict]:
    rows = []
    for s in CURATED_STARS:
        plx = float(s["parallax_mas"])
        dist_pc = 1000.0 / plx if plx > 0 else 0.0
        dist_m = dist_pc * PC
        ra = math.radians(s["ra_deg"])
        dec = math.radians(s["dec_deg"])
        x = dist_m * math.cos(dec) * math.cos(ra)
        y = dist_m * math.cos(dec) * math.sin(ra)
        z = dist_m * math.sin(dec)
        name = s["name"]
        if name == "Sol":
            x = y = z = dist_m = 0.0
            lum = LSUN
        else:
            lum = luminosity_from_g(s.get("g_mag"), dist_pc) or 0.2 * LSUN
        rows.append(
            {
                "id": s["id"],
                "name": name,
                "raDeg": s["ra_deg"],
                "decDeg": s["dec_deg"],
                "distanceM": dist_m,
                "parallaxMas": plx,
                "x": x,
                "y": y,
                "z": z,
                "luminosityW": lum,
                "teffK": float(s.get("teff_k") or 0),
                "colorHex": color_from_bp_rp(s.get("bp_rp")),
                "evidenceKind": "observed",
                "sourceId": "named-bright-stars",
            }
        )
    return rows


def neighborhood_stars(n: int = 2200, seed: int = 4242) -> list[dict]:
    """Assumed nearby-star sample: ~0.1 pc⁻³ disk within 80 ly."""
    r = rng(seed)
    rows = []
    r_max_pc = 80 * LY / PC  # ~24.5 pc
    for i in range(n):
        # Uniform in volume, slightly flattened.
        u = r.random() ** (1 / 3)
        rad = u * r_max_pc
        costh = r.uniform(-1, 1)
        phi = r.uniform(0, 2 * math.pi)
        sinth = math.sqrt(max(0.0, 1 - costh * costh))
        x_pc = rad * sinth * math.cos(phi)
        y_pc = rad * sinth * math.sin(phi)
        z_pc = rad * costh * 0.35
        dist_pc = math.sqrt(x_pc * x_pc + y_pc * y_pc + z_pc * z_pc)
        # K-dwarf heavy luminosity draw
        mag = r.gauss(6.5, 2.2)
        lum = LSUN * 10 ** (-0.4 * (mag - 4.83))
        teff = max(2800.0, min(12000.0, r.gauss(4800, 900)))
        bp = max(-0.3, min(3.5, (5800 - teff) / 1400))
        rows.append(
            {
                "id": f"star.local_{i:04d}",
                "name": "",
                "raDeg": (math.degrees(phi) + 360) % 360,
                "decDeg": math.degrees(math.asin(max(-1, min(1, z_pc / max(dist_pc, 1e-6))))),
                "distanceM": dist_pc * PC,
                "parallaxMas": 1000.0 / max(dist_pc, 0.05),
                "x": x_pc * PC,
                "y": y_pc * PC,
                "z": z_pc * PC,
                "luminosityW": lum,
                "teffK": teff,
                "colorHex": color_from_bp_rp(bp),
                "evidenceKind": "assumed",
                "sourceId": "nearby-disk-sample",
            }
        )
    return rows


def field_stars(n: int = 1800, seed: int = 77) -> list[dict]:
    """Assumed spiral-arm field, 200–2500 ly, for galactic context."""
    r = rng(seed)
    rows = []
    for i in range(n):
        dist_ly = r.uniform(200, 2500)
        dist_m = dist_ly * LY
        phi = r.uniform(0, 2 * math.pi)
        # Flattened disk + 2-arm hint
        arm = math.sin(2 * phi + dist_ly / 400) * 0.35
        inc = r.gauss(0, 0.12 + arm * 0.05)
        x = dist_m * math.cos(phi) * math.cos(inc)
        y = dist_m * math.sin(phi) * math.cos(inc)
        z = dist_m * math.sin(inc) * 0.22
        lum = LSUN * 10 ** r.uniform(-2.2, 1.8)
        teff = max(3000.0, min(15000.0, r.gauss(5600, 1400)))
        rows.append(
            {
                "id": f"star.field_{i:04d}",
                "name": "",
                "raDeg": (math.degrees(phi) + 360) % 360,
                "decDeg": math.degrees(inc),
                "distanceM": dist_m,
                "parallaxMas": 1000.0 / (dist_m / PC),
                "x": x,
                "y": y,
                "z": z,
                "luminosityW": lum,
                "teffK": teff,
                "colorHex": color_from_bp_rp((5800 - teff) / 1400),
                "evidenceKind": "assumed",
                "sourceId": "milky-way-field-sample",
            }
        )
    return rows


def exoplanets() -> list[dict]:
    raw = [
        ("trappist1b", "TRAPPIST-1 b", "TRAPPIST-1", 346.622, -5.041, 12.43, 1.511, 0.011, 1.12, 1.02, 2566),
        ("trappist1c", "TRAPPIST-1 c", "TRAPPIST-1", 346.622, -5.041, 12.43, 2.422, 0.015, 1.10, 1.16, 2566),
        ("trappist1d", "TRAPPIST-1 d", "TRAPPIST-1", 346.622, -5.041, 12.43, 4.049, 0.022, 0.78, 0.30, 2566),
        ("trappist1e", "TRAPPIST-1 e", "TRAPPIST-1", 346.622, -5.041, 12.43, 6.101, 0.029, 0.92, 0.69, 2566),
        ("trappist1f", "TRAPPIST-1 f", "TRAPPIST-1", 346.622, -5.041, 12.43, 9.207, 0.038, 1.05, 1.04, 2566),
        ("trappist1g", "TRAPPIST-1 g", "TRAPPIST-1", 346.622, -5.041, 12.43, 12.353, 0.047, 1.13, 1.32, 2566),
        ("trappist1h", "TRAPPIST-1 h", "TRAPPIST-1", 346.622, -5.041, 12.43, 18.767, 0.062, 0.76, 0.33, 2566),
        ("proximab", "Proxima Centauri b", "Proxima Centauri", 217.429, -62.679, 1.30, 11.186, 0.049, 1.07, 1.07, 3042),
        ("proximad", "Proxima Centauri d", "Proxima Centauri", 217.429, -62.679, 1.30, 5.122, 0.029, 0.81, 0.26, 3042),
        ("kepler452b", "Kepler-452 b", "Kepler-452", 296.004, 44.278, 430, 384.8, 1.05, 1.5, 5.0, 5757),
        ("kepler22b", "Kepler-22 b", "Kepler-22", 289.218, 47.884, 190, 289.9, 0.81, 2.4, 9.1, 5518),
        ("kepler186f", "Kepler-186 f", "Kepler-186", 298.652, 43.955, 178, 129.9, 0.36, 1.17, 1.4, 3755),
        ("kepler62f", "Kepler-62 f", "Kepler-62", 283.213, 45.349, 300, 267.3, 0.72, 1.41, 2.8, 4925),
        ("kepler62e", "Kepler-62 e", "Kepler-62", 283.213, 45.349, 300, 122.4, 0.43, 1.61, 4.5, 4925),
        ("kepler442b", "Kepler-442 b", "Kepler-442", 285.365, 39.280, 370, 112.3, 0.41, 1.34, 2.3, 4402),
        ("kepler1649c", "Kepler-1649 c", "Kepler-1649", 292.505, 41.840, 92, 19.5, 0.08, 1.06, 1.2, 3240),
        ("k2-18b", "K2-18 b", "K2-18", 172.560, 7.589, 38, 32.9, 0.14, 2.61, 8.6, 3457),
        ("lhs1140b", "LHS 1140 b", "LHS 1140", 11.248, -15.274, 15, 24.7, 0.09, 1.64, 5.6, 3216),
        ("toi700d", "TOI-700 d", "TOI-700", 101.297, -65.576, 31, 37.4, 0.16, 1.14, 1.7, 3480),
        ("toi700e", "TOI-700 e", "TOI-700", 101.297, -65.576, 31, 27.8, 0.13, 0.95, 0.8, 3480),
        ("teegardenb", "Teegarden's Star b", "Teegarden's Star", 43.253, 16.881, 3.83, 4.91, 0.025, 1.02, 1.05, 2904),
        ("teegardenc", "Teegarden's Star c", "Teegarden's Star", 43.253, 16.881, 3.83, 11.4, 0.044, 1.04, 1.11, 2904),
        ("ross128b", "Ross 128 b", "Ross 128", 176.935, 0.805, 3.37, 9.87, 0.049, 1.0, 1.4, 3192),
        ("gj667cc", "GJ 667 C c", "GJ 667 C", 259.745, -34.997, 7.2, 28.1, 0.125, 1.5, 3.8, 3350),
        ("gj581g", "GJ 581 g", "GJ 581", 229.932, -7.722, 6.3, 36.6, 0.15, 1.5, 3.1, 3498),
        ("gj581d", "GJ 581 d", "GJ 581", 229.932, -7.722, 6.3, 66.6, 0.22, 2.2, 6.0, 3498),
        ("gj1214b", "GJ 1214 b", "GJ 1214", 258.845, 4.980, 14.6, 1.58, 0.014, 2.74, 8.2, 3026),
        ("gj436b", "GJ 436 b", "GJ 436", 175.546, 26.707, 9.8, 2.64, 0.028, 4.17, 22.2, 3479),
        ("55cnce", "55 Cancri e", "55 Cancri", 133.149, 28.330, 12.6, 0.74, 0.015, 1.88, 7.99, 5196),
        ("51pegb", "51 Pegasi b", "51 Pegasi", 344.367, 20.769, 15.5, 4.23, 0.052, 13.0, 150, 5793),
        ("hd209458b", "HD 209458 b", "HD 209458", 330.795, 18.812, 48, 3.52, 0.047, 15.1, 220, 6091),
        ("hd189733b", "HD 189733 b", "HD 189733", 300.182, 22.710, 19.8, 2.22, 0.031, 12.5, 365, 4875),
        ("wasp12b", "WASP-12 b", "WASP-12", 97.637, 29.672, 427, 1.09, 0.023, 19.0, 450, 6300),
        ("wasp121b", "WASP-121 b", "WASP-121", 107.607, -39.097, 260, 1.27, 0.025, 19.4, 375, 6460),
        ("kelt9b", "KELT-9 b", "KELT-9", 307.859, 39.797, 204, 1.48, 0.035, 21.2, 890, 10170),
        ("hatp7b", "HAT-P-7 b", "HAT-P-7", 292.247, 47.970, 320, 2.20, 0.038, 16.9, 572, 6350),
        ("kepler10b", "Kepler-10 b", "Kepler-10", 285.679, 50.241, 173, 0.84, 0.017, 1.47, 3.3, 5627),
        ("kepler11b", "Kepler-11 b", "Kepler-11", 287.997, 41.879, 613, 10.3, 0.091, 1.80, 1.9, 5663),
        ("kepler11c", "Kepler-11 c", "Kepler-11", 287.997, 41.879, 613, 13.0, 0.107, 2.87, 2.9, 5663),
        ("kepler11d", "Kepler-11 d", "Kepler-11", 287.997, 41.879, 613, 22.7, 0.155, 3.12, 7.3, 5663),
        ("kepler11e", "Kepler-11 e", "Kepler-11", 287.997, 41.879, 613, 32.0, 0.195, 4.19, 8.0, 5663),
        ("kepler11f", "Kepler-11 f", "Kepler-11", 287.997, 41.879, 613, 46.7, 0.250, 2.49, 2.0, 5663),
        ("kepler16b", "Kepler-16 b", "Kepler-16", 289.174, 51.758, 61, 228.8, 0.70, 8.45, 106, 4450),
        ("kepler90i", "Kepler-90 i", "Kepler-90", 281.288, 49.315, 780, 14.4, 0.12, 1.32, 2.0, 6080),
        ("kepler90h", "Kepler-90 h", "Kepler-90", 281.288, 49.315, 780, 331.6, 1.01, 11.3, 203, 6080),
        ("hd40307g", "HD 40307 g", "HD 40307", 88.518, -60.024, 13, 197.8, 0.60, 2.0, 7.1, 4977),
        ("tauketie", "tau Ceti e", "tau Ceti", 26.017, -15.937, 3.65, 162, 0.54, 1.8, 4.3, 5344),
        ("tauketif", "tau Ceti f", "tau Ceti", 26.017, -15.937, 3.65, 636, 1.35, 1.8, 6.6, 5344),
        ("epsindb", "Epsilon Indi Ab", "Epsilon Indi A", 330.840, -56.786, 3.64, 16510, 28.4, 16, 1000, 4686),
        ("fomalhautb", "Fomalhaut b", "Fomalhaut", 344.413, -29.622, 7.7, 320000, 115, 10, 2, 8590),
        ("betpicb", "beta Pictoris b", "beta Pictoris", 86.821, -51.066, 19.4, 7890, 10, 15.6, 4000, 8052),
        ("hr8799b", "HR 8799 b", "HR 8799", 346.870, 21.134, 40.8, 170000, 68, 13, 2000, 7430),
        ("hr8799c", "HR 8799 c", "HR 8799", 346.870, 21.134, 40.8, 69000, 38, 13, 2300, 7430),
        ("hr8799d", "HR 8799 d", "HR 8799", 346.870, 21.134, 40.8, 37000, 24, 12, 2200, 7430),
        ("hr8799e", "HR 8799 e", "HR 8799", 346.870, 21.134, 40.8, 18000, 15, 12, 2000, 7430),
        ("51erib", "51 Eridani b", "51 Eridani", 69.400, -2.473, 29.4, 11900, 13, 13, 2, 7370),
        ("psoj318", "PSO J318.5-22", "field", 318.534, -22.856, 24.6, 0, 0, 16, 2000, 800),
        ("wasp39b", "WASP-39 b", "WASP-39", 217.326, -3.444, 215, 4.06, 0.049, 14.3, 90, 5400),
        ("wasp17b", "WASP-17 b", "WASP-17", 239.058, -28.121, 410, 3.74, 0.051, 22.0, 155, 6550),
        ("wasp19b", "WASP-19 b", "WASP-19", 148.281, -45.659, 250, 0.79, 0.016, 16.0, 350, 5500),
        ("hatp11b", "HAT-P-11 b", "HAT-P-11", 297.318, 48.080, 38, 4.89, 0.053, 4.7, 26, 4780),
        ("corot7b", "CoRoT-7 b", "CoRoT-7", 100.956, -1.063, 150, 0.85, 0.017, 1.58, 5.7, 5275),
        ("kepler78b", "Kepler-78 b", "Kepler-78", 292.740, 44.450, 125, 0.36, 0.01, 1.20, 1.7, 5089),
        ("gj876b", "GJ 876 b", "GJ 876", 343.337, -14.264, 4.7, 61.0, 0.21, 12, 720, 3350),
        ("gj876c", "GJ 876 c", "GJ 876", 343.337, -14.264, 4.7, 30.1, 0.13, 7, 227, 3350),
        ("gj876d", "GJ 876 d", "GJ 876", 343.337, -14.264, 4.7, 1.94, 0.021, 2, 6.8, 3350),
        ("gj876e", "GJ 876 e", "GJ 876", 343.337, -14.264, 4.7, 124.3, 0.33, 5, 14.6, 3350),
        ("hd40307b", "HD 40307 b", "HD 40307", 88.518, -60.024, 13, 4.3, 0.047, 2, 4.2, 4977),
        ("hd40307c", "HD 40307 c", "HD 40307", 88.518, -60.024, 13, 9.6, 0.081, 2, 6.8, 4977),
        ("hd40307d", "HD 40307 d", "HD 40307", 88.518, -60.024, 13, 20.4, 0.134, 2, 9.2, 4977),
        ("wolf1061c", "Wolf 1061 c", "Wolf 1061", 247.575, -12.663, 4.3, 17.9, 0.089, 1.6, 3.4, 3342),
        ("kapteynb", "Kapteyn b", "Kapteyn's Star", 77.682, -45.017, 3.9, 48.6, 0.17, 1.6, 4.8, 3570),
        ("barnardb", "Barnard's Star b", "Barnard's Star", 269.452, 4.693, 1.83, 3.15, 0.019, 0.8, 0.37, 3134),
        ("luytenb", "Luyten b", "Luyten's Star", 111.852, 5.226, 3.79, 18.6, 0.091, 1.07, 2.89, 3150),
        ("yzcetib", "YZ Ceti b", "YZ Ceti", 18.127, -16.999, 3.7, 2.02, 0.016, 0.9, 0.7, 3056),
        ("yzcetic", "YZ Ceti c", "YZ Ceti", 18.127, -16.999, 3.7, 3.06, 0.021, 1.0, 1.1, 3056),
        ("yzcetid", "YZ Ceti d", "YZ Ceti", 18.127, -16.999, 3.7, 4.66, 0.028, 1.1, 1.1, 3056),
    ]
    rows = []
    for rec in raw:
        i, name, host, ra, dec, d, p, a, re, me, teff = rec
        rows.append(
            {
                "id": f"exo.{i}",
                "name": name,
                "hostname": host,
                "raDeg": ra,
                "decDeg": dec,
                "distancePc": d,
                "orbitalPeriodDays": p,
                "semiMajorAxisAu": a,
                "radiusEarth": re,
                "massEarth": me,
                "starTeffK": teff,
                "evidenceKind": "observed",
                "sourceId": "nasa-exoplanet-archive",
            }
        )
    return rows


def cities() -> list[dict]:
    extra = [
        ("seoul", "Seoul", 37.57, 126.98, 0.95),
        ("osaka", "Osaka", 34.69, 135.50, 0.7),
        ("manila", "Manila", 14.60, 120.98, 0.75),
        ("bangkok", "Bangkok", 13.76, 100.50, 0.7),
        ("ho_chi_minh", "Ho Chi Minh City", 10.82, 106.63, 0.65),
        ("chennai", "Chennai", 13.08, 80.27, 0.7),
        ("kolkata", "Kolkata", 22.57, 88.36, 0.75),
        ("bangalore", "Bengaluru", 12.97, 77.59, 0.75),
        ("tehran", "Tehran", 35.69, 51.39, 0.7),
        ("baghdad", "Baghdad", 33.32, 44.37, 0.55),
        ("nairobi", "Nairobi", -1.29, 36.82, 0.5),
        ("addis", "Addis Ababa", 9.03, 38.74, 0.45),
        ("casablanca", "Casablanca", 33.57, -7.59, 0.5),
        ("algiers", "Algiers", 36.75, 3.06, 0.45),
        ("cape_town", "Cape Town", -33.92, 18.42, 0.5),
        ("kinshasa", "Kinshasa", -4.32, 15.31, 0.55),
        ("luanda", "Luanda", -8.84, 13.23, 0.4),
        ("santiago", "Santiago", -33.45, -70.67, 0.55),
        ("buenos_aires", "Buenos Aires", -34.60, -58.38, 0.7),
        ("rio", "Rio de Janeiro", -22.91, -43.17, 0.7),
        ("brasilia", "Brasília", -15.79, -47.88, 0.45),
        ("caracas", "Caracas", 10.48, -66.90, 0.4),
        ("chicago", "Chicago", 41.88, -87.63, 0.7),
        ("houston", "Houston", 29.76, -95.37, 0.6),
        ("dallas", "Dallas", 32.78, -96.80, 0.55),
        ("miami", "Miami", 25.76, -80.19, 0.5),
        ("seattle", "Seattle", 47.61, -122.33, 0.5),
        ("vancouver", "Vancouver", 49.28, -123.12, 0.5),
        ("montreal", "Montreal", 45.50, -73.57, 0.5),
        ("berlin", "Berlin", 52.52, 13.41, 0.6),
        ("madrid", "Madrid", 40.42, -3.70, 0.6),
        ("rome", "Rome", 41.90, 12.50, 0.55),
        ("milan", "Milan", 45.46, 9.19, 0.5),
        ("amsterdam", "Amsterdam", 52.37, 4.90, 0.45),
        ("warsaw", "Warsaw", 52.23, 21.01, 0.5),
        ("kyiv", "Kyiv", 50.45, 30.52, 0.5),
        ("athens", "Athens", 37.98, 23.73, 0.4),
        ("lisbon", "Lisbon", 38.72, -9.14, 0.4),
        ("dublin", "Dublin", 53.35, -6.26, 0.4),
        ("stockholm", "Stockholm", 59.33, 18.07, 0.4),
        ("helsinki", "Helsinki", 60.17, 24.94, 0.35),
        ("oslo", "Oslo", 59.91, 10.75, 0.35),
        ("vienna", "Vienna", 48.21, 16.37, 0.45),
        ("prague", "Prague", 50.08, 14.44, 0.4),
        ("budapest", "Budapest", 47.50, 19.04, 0.4),
        ("bucharest", "Bucharest", 44.43, 26.10, 0.4),
        ("ankara", "Ankara", 39.93, 32.86, 0.5),
        ("dubai", "Dubai", 25.20, 55.27, 0.55),
        ("doha", "Doha", 25.29, 51.53, 0.4),
        ("kuwait", "Kuwait City", 29.38, 47.98, 0.4),
        ("tashkent", "Tashkent", 41.30, 69.24, 0.4),
        ("almaty", "Almaty", 43.24, 76.95, 0.35),
        ("ulaanbaatar", "Ulaanbaatar", 47.91, 106.91, 0.3),
        ("hanoi", "Hanoi", 21.03, 105.85, 0.55),
        ("phnom_penh", "Phnom Penh", 11.56, 104.93, 0.35),
        ("yangon", "Yangon", 16.87, 96.20, 0.4),
        ("kathmandu", "Kathmandu", 27.72, 85.32, 0.35),
        ("colombo", "Colombo", 6.93, 79.85, 0.35),
        ("auckland", "Auckland", -36.85, 174.76, 0.4),
        ("melbourne", "Melbourne", -37.81, 144.96, 0.5),
        ("perth", "Perth", -31.95, 115.86, 0.4),
        ("honolulu", "Honolulu", 21.31, -157.86, 0.3),
        ("anchorage", "Anchorage", 61.22, -149.90, 0.25),
        ("reykjavik", "Reykjavík", 64.15, -21.94, 0.2),
    ]
    return [{"id": i, "name": n, "latDeg": la, "lonDeg": lo, "weight": w} for i, n, la, lo, w in extra]


def particles() -> list[dict]:
    data = [
        ("e-", "electron", "e⁻", 11, 0.51099895, -1, 0.5),
        ("e+", "positron", "e⁺", -11, 0.51099895, 1, 0.5),
        ("mu-", "muon", "μ⁻", 13, 105.6583755, -1, 0.5),
        ("mu+", "antimuon", "μ⁺", -13, 105.6583755, 1, 0.5),
        ("tau-", "tau", "τ⁻", 15, 1776.86, -1, 0.5),
        ("nu_e", "electron neutrino", "ν_e", 12, 0.0, 0, 0.5),
        ("nu_mu", "muon neutrino", "ν_μ", 14, 0.0, 0, 0.5),
        ("nu_tau", "tau neutrino", "ν_τ", 16, 0.0, 0, 0.5),
        ("gamma", "photon", "γ", 22, 0.0, 0, 1.0),
        ("g", "gluon", "g", 21, 0.0, 0, 1.0),
        ("W+", "W boson", "W⁺", 24, 80369.0, 1, 1.0),
        ("W-", "W boson", "W⁻", -24, 80369.0, -1, 1.0),
        ("Z0", "Z boson", "Z⁰", 23, 91187.6, 0, 1.0),
        ("H", "Higgs boson", "H", 25, 125250.0, 0, 0.0),
        ("u", "up quark", "u", 2, 2.16, 0.666, 0.5),
        ("d", "down quark", "d", 1, 4.67, -0.333, 0.5),
        ("s", "strange quark", "s", 3, 93.4, -0.333, 0.5),
        ("c", "charm quark", "c", 4, 1270.0, 0.666, 0.5),
        ("b", "bottom quark", "b", 5, 4180.0, -0.333, 0.5),
        ("t", "top quark", "t", 6, 172690.0, 0.666, 0.5),
        ("p", "proton", "p", 2212, 938.272, 1, 0.5),
        ("n", "neutron", "n", 2112, 939.565, 0, 0.5),
        ("pi+", "pion", "π⁺", 211, 139.570, 1, 0.0),
        ("pi0", "pion", "π⁰", 111, 134.977, 0, 0.0),
        ("k+", "kaon", "K⁺", 321, 493.677, 1, 0.0),
        ("k0", "kaon", "K⁰", 311, 497.611, 0, 0.0),
        ("eta", "eta", "η", 221, 547.862, 0, 0.0),
        ("lambda", "lambda", "Λ", 3122, 1115.683, 0, 0.5),
        ("sigma+", "sigma", "Σ⁺", 3222, 1189.37, 1, 0.5),
        ("xi0", "xi", "Ξ⁰", 3322, 1314.86, 0, 0.5),
        ("omega-", "omega", "Ω⁻", 3334, 1672.45, -1, 1.5),
    ]
    return [
        {
            "id": f"particle.{i}",
            "name": n,
            "symbol": sy,
            "pdgId": pdg,
            "massMev": m,
            "charge": q,
            "spinJ": j,
            "evidenceKind": "observed",
            "sourceId": "pdg-2024",
        }
        for i, n, sy, pdg, m, q, j in data
    ]


def atomic_levels() -> list[dict]:
    rows = []
    # Hydrogen n=1..8
    for n in range(1, 9):
        for l in range(0, n):
            e = -13.605693122994 / (n * n)
            rows.append(
                {
                    "id": f"H-n{n}-l{l}",
                    "species": "H",
                    "n": n,
                    "l": l,
                    "energyEv": e,
                    "term": f"{n}{'spdfghik'[l]}",
                    "evidenceKind": "derived",
                    "sourceId": "nist-rydberg",
                }
            )
    extras = [
        ("He-I-1s2", "He", 1, 0, -24.587, "1s² ¹S"),
        ("He-I-1s2p", "He", 2, 1, -3.623, "1s2p ¹P"),
        ("C-I-gs", "C", 2, 1, 0.0, "2s²2p² ³P"),
        ("N-I-gs", "N", 2, 1, 0.0, "2s²2p³ ⁴S"),
        ("O-I-gs", "O", 2, 1, 0.0, "2s²2p⁴ ³P"),
        ("Fe-I-gs", "Fe", 4, 2, 0.0, "a ⁵D"),
        ("Na-I-3s", "Na", 3, 0, -5.139, "3s ²S"),
        ("Na-I-3p", "Na", 3, 1, -3.037, "3p ²P"),
    ]
    for i, sp, n, l, e, term in extras:
        rows.append(
            {
                "id": i,
                "species": sp,
                "n": n,
                "l": l,
                "energyEv": e,
                "term": term,
                "evidenceKind": "observed",
                "sourceId": "nist-asd",
            }
        )
    return rows


def isotopes() -> list[dict]:
    data = [
        ("h1", "¹H", 1, 1, 0.0),
        ("h2", "²H", 1, 2, 1.112),
        ("he3", "³He", 2, 3, 2.573),
        ("he4", "⁴He", 2, 4, 7.074),
        ("c12", "¹²C", 6, 12, 7.680),
        ("c13", "¹³C", 6, 13, 7.470),
        ("c14", "¹⁴C", 6, 14, 7.520),
        ("n14", "¹⁴N", 7, 14, 7.476),
        ("o16", "¹⁶O", 8, 16, 7.976),
        ("ne20", "²⁰Ne", 10, 20, 8.032),
        ("na23", "²³Na", 11, 23, 8.111),
        ("mg24", "²⁴Mg", 12, 24, 8.261),
        ("al27", "²⁷Al", 13, 27, 8.332),
        ("si28", "²⁸Si", 14, 28, 8.448),
        ("p31", "³¹P", 15, 31, 8.481),
        ("s32", "³²S", 16, 32, 8.493),
        ("fe56", "⁵⁶Fe", 26, 56, 8.790),
        ("ni58", "⁵⁸Ni", 28, 58, 8.732),
        ("cu63", "⁶³Cu", 29, 63, 8.752),
        ("zn64", "⁶⁴Zn", 30, 64, 8.736),
        ("ag107", "¹⁰⁷Ag", 47, 107, 8.554),
        ("i127", "¹²⁷I", 53, 127, 8.445),
        ("au197", "¹⁹⁷Au", 79, 197, 7.916),
        ("pb208", "²⁰⁸Pb", 82, 208, 7.867),
        ("u235", "²³⁵U", 92, 235, 7.591),
        ("u238", "²³⁸U", 92, 238, 7.570),
        ("pu239", "²³⁹Pu", 94, 239, 7.560),
    ]
    return [
        {
            "id": i,
            "symbol": sy,
            "z": z,
            "a": a,
            "bindingEnergyPerNucleonMev": be,
            "evidenceKind": "observed",
            "sourceId": "nndc-nudat",
        }
        for i, sy, z, a, be in data
    ]


def genes() -> list[dict]:
    return [
        {
            "id": "gene.hbb",
            "geneSymbol": "HBB",
            "transcriptId": "NM_000518.5",
            "cdsSequence": "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCC",
            "variantLabel": "HbS / sickle cell",
            "rsId": "rs334",
            "structureId": "4HHB",
            "evidenceKind": "observed",
            "sourceId": "ncbi-clinvar",
        },
        {
            "id": "gene.hba1",
            "geneSymbol": "HBA1",
            "transcriptId": "NM_000558.5",
            "cdsSequence": "ATGGTGCTGTCTCCTGCCGACAAGACCAACGTCAAGGCCGCC",
            "variantLabel": "wild-type alpha globin",
            "rsId": "",
            "structureId": "4HHB",
            "evidenceKind": "observed",
            "sourceId": "ncbi",
        },
        {
            "id": "gene.cftr",
            "geneSymbol": "CFTR",
            "transcriptId": "NM_000492.4",
            "cdsSequence": "ATGCAGAGGTCGCCTCTGGAAAAGGCCAGCGTTGTCTCCAAA",
            "variantLabel": "ΔF508 context",
            "rsId": "rs113993960",
            "structureId": "5UAK",
            "evidenceKind": "observed",
            "sourceId": "ncbi-clinvar",
        },
        {
            "id": "gene.brca1",
            "geneSymbol": "BRCA1",
            "transcriptId": "NM_007294.4",
            "cdsSequence": "ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTC",
            "variantLabel": "pathogenic cluster context",
            "rsId": "rs80357906",
            "structureId": "1JM7",
            "evidenceKind": "observed",
            "sourceId": "ncbi-clinvar",
        },
        {
            "id": "gene.tp53",
            "geneSymbol": "TP53",
            "transcriptId": "NM_000546.6",
            "cdsSequence": "ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTG",
            "variantLabel": "R175H context",
            "rsId": "rs28934578",
            "structureId": "2OCJ",
            "evidenceKind": "observed",
            "sourceId": "ncbi-clinvar",
        },
        {
            "id": "gene.cftr2",
            "geneSymbol": "G6PD",
            "transcriptId": "NM_001042351.3",
            "cdsSequence": "ATGGCAGAGCAGGTGGCCCTGAGCCGGACCCAGGTGTGCGGC",
            "variantLabel": "A- variant context",
            "rsId": "rs1050828",
            "structureId": "2BHL",
            "evidenceKind": "observed",
            "sourceId": "ncbi-clinvar",
        },
    ]


def extra_solar() -> list[dict]:
    """Moons and dwarf planets; positions are assumed Keplerian offsets."""
    extras = [
        ("io", "Io", "moon", 1.8216e6, 8.93e22, 5.2, 0.002, 0, "#e8c36a", 1.77),
        ("europa", "Europa", "moon", 1.5608e6, 4.80e22, 5.2, -0.003, 0.001, "#c9d4e0", 3.55),
        ("ganymede", "Ganymede", "moon", 2.6341e6, 1.48e23, 5.2, 0.006, -0.001, "#b7a48a", 7.15),
        ("callisto", "Callisto", "moon", 2.4103e6, 1.08e23, 5.2, -0.008, 0.002, "#6b5a4a", 16.7),
        ("titan", "Titan", "moon", 2.5747e6, 1.35e23, 9.5, 0.008, 0.002, "#d4a574", 15.95),
        ("enceladus", "Enceladus", "moon", 2.52e5, 1.08e20, 9.5, -0.003, 0.001, "#f0f4ff", 1.37),
        ("triton", "Triton", "moon", 1.3534e6, 2.14e22, 30.1, 0.002, -0.001, "#c0c8d4", 5.88),
        ("ceres", "Ceres", "dwarf", 4.73e5, 9.38e20, 2.77, 0.4, 0.1, "#8a8a8a", 1680),
        ("pluto", "Pluto", "dwarf", 1.1883e6, 1.30e22, 39.5, 8.0, 4.0, "#c4a882", 90560),
        ("eris", "Eris", "dwarf", 1.163e6, 1.65e22, 67.7, -12.0, 8.0, "#d0d4dc", 203830),
        ("vesta", "Vesta", "dwarf", 2.62e5, 2.59e20, 2.36, -0.3, 0.05, "#a09080", 1325),
        ("pallas", "Pallas", "dwarf", 2.56e5, 2.04e20, 2.77, 0.5, 0.4, "#9a9a9a", 1686),
        ("haumea", "Haumea", "dwarf", 8.1e5, 4.01e21, 43.1, 10.0, 3.0, "#e8e0d0", 103774),
        ("makemake", "Makemake", "dwarf", 7.15e5, 3.1e21, 45.8, -9.0, 5.0, "#d8c4a0", 112897),
    ]
    rows = []
    for i, name, kind, rad, mass, au, dlon, dlat, color, period in extras:
        th = math.radians(dlon * 40)
        x = au * AU * math.cos(th)
        y = au * AU * math.sin(th)
        z = dlat * AU
        rows.append(
            {
                "id": f"body.{i}",
                "name": name,
                "horizonsId": "",
                "kind": kind,
                "radiusM": rad,
                "massKg": mass,
                "xM": x,
                "yM": y,
                "zM": z,
                "vxMps": 0.0,
                "vyMps": 0.0,
                "vzMps": 0.0,
                "luminosityW": 0.0,
                "orbitPeriodDays": period,
                "colorHex": color,
                "epoch": "2025-01-01T00:00:00Z",
                "frame": "ICRF",
                "evidenceKind": "assumed",
                "sourceId": "iau-mean-elements",
            }
        )
    return rows


def main() -> int:
    stars = named_stars() + neighborhood_stars() + field_stars()
    exo = exoplanets()
    extra_cities = cities()
    parts = particles()
    levels = atomic_levels()
    isos = isotopes()
    gns = genes()
    moons = extra_solar()

    write_json(DATA_NORMALIZED / "catalog_stars.json", stars)
    write_json(DATA_NORMALIZED / "catalog_exoplanets.json", exo)
    write_json(DATA_NORMALIZED / "catalog_cities.json", extra_cities)
    write_json(DATA_NORMALIZED / "catalog_particles.json", parts)
    write_json(DATA_NORMALIZED / "catalog_atomic_levels.json", levels)
    write_json(DATA_NORMALIZED / "catalog_isotopes.json", isos)
    write_json(DATA_NORMALIZED / "catalog_genes.json", gns)
    write_json(DATA_NORMALIZED / "catalog_extra_solar.json", moons)
    print(
        f"stars={len(stars)} exo={len(exo)} cities+={len(extra_cities)} "
        f"particles={len(parts)} levels={len(levels)} isotopes={len(isos)} "
        f"genes={len(gns)} extra_solar={len(moons)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
