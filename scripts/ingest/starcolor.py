"""Stellar colour ramps shared by the star and solar-system adapters.

Colours are for rendering only. They are a smooth interpolation through
well-known approximate sRGB renderings of blackbody / Gaia BP-RP colour, not a
measured photometric quantity, so records that use them are never labelled
`observed` on the strength of the colour alone.
"""
from __future__ import annotations

# bp_rp -> sRGB. Anchors from the spec: blue through white, yellow, orange, red.
BP_RP_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (-0.40, (0x9B, 0xB0, 0xFF)),
    (-0.30, (0x9B, 0xB0, 0xFF)),
    (0.00, (0xFF, 0xF4, 0xE8)),
    (0.80, (0xFF, 0xD2, 0xA1)),
    (1.50, (0xFF, 0xB5, 0x6C)),
    (2.50, (0xFF, 0x9A, 0x5C)),
    (4.00, (0xFF, 0x8A, 0x4A)),
]

# Effective temperature (K) -> sRGB, same visual family as the BP-RP ramp.
TEFF_RAMP: list[tuple[float, tuple[int, int, int]]] = [
    (2400.0, (0xFF, 0x8A, 0x4A)),
    (3000.0, (0xFF, 0x9A, 0x5C)),
    (3700.0, (0xFF, 0xB5, 0x6C)),
    (4500.0, (0xFF, 0xD2, 0xA1)),
    (5300.0, (0xFF, 0xE4, 0xC4)),
    (5800.0, (0xFF, 0xF4, 0xE8)),
    (6600.0, (0xF8, 0xF7, 0xFF)),
    (8000.0, (0xDC, 0xE4, 0xFF)),
    (12000.0, (0xB4, 0xC6, 0xFF)),
    (30000.0, (0x9B, 0xB0, 0xFF)),
]


def _interp(ramp: list[tuple[float, tuple[int, int, int]]], x: float) -> str:
    if x <= ramp[0][0]:
        r, g, b = ramp[0][1]
        return f"#{r:02x}{g:02x}{b:02x}"
    if x >= ramp[-1][0]:
        r, g, b = ramp[-1][1]
        return f"#{r:02x}{g:02x}{b:02x}"
    for (x0, c0), (x1, c1) in zip(ramp, ramp[1:]):
        if x0 <= x <= x1:
            t = 0.0 if x1 == x0 else (x - x0) / (x1 - x0)
            r = round(c0[0] + t * (c1[0] - c0[0]))
            g = round(c0[1] + t * (c1[1] - c0[1]))
            b = round(c0[2] + t * (c1[2] - c0[2]))
            return f"#{r:02x}{g:02x}{b:02x}"
    r, g, b = ramp[-1][1]
    return f"#{r:02x}{g:02x}{b:02x}"


def color_from_teff(teff_k: float) -> str:
    return _interp(TEFF_RAMP, teff_k)


def color_from_bp_rp(bp_rp: float) -> str:
    return _interp(BP_RP_RAMP, bp_rp)


def star_color_hex(teff_k: float | None, bp_rp: float | None) -> str:
    """Prefer an astrophysical temperature when Gaia GSP-Phot supplied one."""
    if teff_k is not None and 1000.0 < teff_k < 60000.0:
        return color_from_teff(teff_k)
    if bp_rp is not None and -1.0 < bp_rp < 6.0:
        return color_from_bp_rp(bp_rp)
    return "#fff4e8"
