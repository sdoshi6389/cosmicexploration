"""Curated Solar System body list shared by the Horizons, SPICE and PDS adapters."""

# (cosmos id, display name, NAIF id, Horizons COMMAND, kind, parent cosmos id, render colour)
BODIES = [
    ("body.sun", "Sun", 10, "10", "star", "", "#ffd27e"),
    ("body.mercury", "Mercury", 199, "199", "planet", "body.sun", "#a9a39b"),
    ("body.venus", "Venus", 299, "299", "planet", "body.sun", "#e6c58a"),
    ("body.earth", "Earth", 399, "399", "planet", "body.sun", "#4f8fd8"),
    ("body.moon", "Moon", 301, "301", "moon", "body.earth", "#c9c6bf"),
    ("body.mars", "Mars", 499, "499", "planet", "body.sun", "#c1603a"),
    ("body.phobos", "Phobos", 401, "401", "moon", "body.mars", "#8a7d70"),
    ("body.deimos", "Deimos", 402, "402", "moon", "body.mars", "#9a8f84"),
    ("body.ceres", "Ceres", 2000001, "1;", "dwarf", "body.sun", "#8f8a84"),
    ("body.vesta", "Vesta", 2000004, "4;", "asteroid", "body.sun", "#a29a8e"),
    ("body.jupiter", "Jupiter", 599, "599", "planet", "body.sun", "#d8b48a"),
    ("body.io", "Io", 501, "501", "moon", "body.jupiter", "#e6d36a"),
    ("body.europa", "Europa", 502, "502", "moon", "body.jupiter", "#d9cbb0"),
    ("body.ganymede", "Ganymede", 503, "503", "moon", "body.jupiter", "#a89f93"),
    ("body.callisto", "Callisto", 504, "504", "moon", "body.jupiter", "#7d7368"),
    ("body.saturn", "Saturn", 699, "699", "planet", "body.sun", "#e3cf9c"),
    ("body.enceladus", "Enceladus", 602, "602", "moon", "body.saturn", "#f2f4f5"),
    ("body.rhea", "Rhea", 605, "605", "moon", "body.saturn", "#c8c4bd"),
    ("body.titan", "Titan", 606, "606", "moon", "body.saturn", "#d9a656"),
    ("body.uranus", "Uranus", 799, "799", "planet", "body.sun", "#9fd8e0"),
    ("body.titania", "Titania", 703, "703", "moon", "body.uranus", "#b9b2a8"),
    ("body.neptune", "Neptune", 899, "899", "planet", "body.sun", "#4f78d8"),
    ("body.triton", "Triton", 801, "801", "moon", "body.neptune", "#d8c9c0"),
    ("body.pluto", "Pluto", 999, "999", "dwarf", "body.sun", "#d4b89a"),
    ("body.charon", "Charon", 901, "901", "moon", "body.pluto", "#a39d97"),
    ("craft.voyager1", "Voyager 1", -31, "-31", "spacecraft", "body.sun", "#e8edf5"),
    ("craft.voyager2", "Voyager 2", -32, "-32", "spacecraft", "body.sun", "#e8edf5"),
    ("craft.new_horizons", "New Horizons", -98, "-98", "spacecraft", "body.sun", "#e8edf5"),
    ("craft.jwst", "James Webb Space Telescope", -170, "-170", "spacecraft", "body.sun", "#ffd27e"),
    ("craft.parker", "Parker Solar Probe", -96, "-96", "spacecraft", "body.sun", "#ff9a3c"),
]

# Parent NAIF ids used as Horizons centres for moon orbit tracks.
PARENT_CENTER = {
    "body.earth": "500@399",
    "body.mars": "500@499",
    "body.jupiter": "500@599",
    "body.saturn": "500@699",
    "body.uranus": "500@799",
    "body.neptune": "500@899",
    "body.pluto": "500@999",
}

EPOCH = "2026-10-03"
EPOCH_STOP = "2026-10-04"
