"""Where a tracked player actually is, in the world.

The tracking feeds describe a player as a position on a rectangle - 90.07 along
and 26.9 across - and say nothing about Denver. Turning that into a longitude
and a latitude is the one piece of arithmetic everything downstream depends on,
and it is the one piece that fails silently: get it subtly wrong and the players
are a few metres off the field, still moving convincingly, and nothing complains.

So this is a port of the transform the app already uses - `mapper()` in
js/play.js - rather than a second attempt at it, and tools/simcheck.py asserts
the two still agree by driving the real app and comparing. A port that is never
checked against its original is a fork.

## What the transform does

Three things, in this order:

  * **Normalise.** The play space is whatever the feed used: 120 x 53.333 yards
    for the gridiron, 105 x 68 metres for the pitch. Dividing by the space's own
    length and width cancels the units out, which is why one function handles
    both without knowing which it has.
  * **Scale to the surface.** The result is stretched onto the *marked* field -
    the lines, not the painted slab they sit on. The gridiron slab carries a two
    yard out-of-bounds apron; sizing to it would stand all 22 players two yards
    wide of their own markings.
  * **Rotate.** The stadium is not aligned to north. Half a degree of rotation
    is a metre at the corners.

## Why the constants are copied rather than read

The app's CONFIG is JavaScript, and parsing it from Python to stay in step would
be a worse dependency than the copy: it would break on a comment. These are the
numbers as of writing, and simcheck reads the live ones out of the running app
and fails if they have moved.
"""
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.abspath(os.path.join(HERE, "..", "data"))

DEG = math.pi / 180.0

# Mirrors CONFIG.field in js/app.js. simcheck.py asserts these still match.
FIELD_LAT = 39.74392969
FIELD_LON = -105.02011614
FIELD_ROTATION = -0.59            # degrees about local up

# Mirrors CONFIG.field.surfaces[key].play - the marked field inside the painted
# slab. Everything that measures itself against the surface reads this one.
SURFACES = {
    "gridiron": {"depth": 109.728, "width": 48.768},
    "pitch": {"depth": 105.00, "width": 68.00},
}

# Mirrors CONFIG.play.flipAlong / flipAcross. Both false today; they exist
# because a feed can number its field from the other end, and finding that out
# by looking at 22 people running backwards is a bad afternoon.
FLIP_ALONG = False
FLIP_ACROSS = False

# The app's own flat-earth constants. Good to a few centimetres over a patch
# this size, and using different ones here would put the port out by more than
# the thing it is trying to measure.
M_PER_LAT = 111320.0
M_PER_LON = 111320.0 * math.cos(FIELD_LAT * DEG)

# The plays, by the key CONFIG.play.plays uses.
PLAYS = {
    "gridiron": "play.json",
    "run": "play_run.json",
    "fieldgoal": "play_fieldgoal.json",
    "football": "soccer.json",
    "counter": "soccer_counter.json",
    "header": "soccer_header.json",
}


def load(key):
    """A play by its key, or by a path to one."""
    name = PLAYS.get(key, key)
    path = name if os.path.isabs(name) else os.path.join(DATA, name)
    if not os.path.exists(path):
        raise SystemExit(
            "no play at %s\n"
            "The tracking files are built rather than shipped - see "
            "tools/README.md." % path)
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


class Field(object):
    """The transform, for one play."""

    def __init__(self, data):
        space = data.get("space") or {"length": 120.0, "width": 53.333}
        key = data.get("surface") or "gridiron"
        marked = SURFACES.get(key)
        if not marked:
            raise SystemExit("no surface called %r" % key)
        self.key = key
        self.length = float(space["length"])
        self.width = float(space["width"])
        self.depth = marked["depth"]
        self.across = marked["width"]
        th = FIELD_ROTATION * DEG
        self.ct = math.cos(th)
        self.st = math.sin(th)
        self.sa = -1.0 if FLIP_ALONG else 1.0
        self.sx = -1.0 if FLIP_ACROSS else 1.0

    def to_en(self, x, y):
        """Play space -> [east, north] metres from the middle of the field."""
        along = (x / self.length - 0.5) * self.depth * self.sa
        across = (y / self.width - 0.5) * self.across * self.sx
        return (across * self.ct - along * self.st,
                across * self.st + along * self.ct)

    @staticmethod
    def to_lonlat(e, n):
        return (FIELD_LON + e / M_PER_LON, FIELD_LAT + n / M_PER_LAT)

    def to_world(self, x, y):
        e, n = self.to_en(x, y)
        return self.to_lonlat(e, n)

    def heading(self, direction):
        """
        Feed heading -> compass degrees.

        Both feeds write `dir` as atan2(along, across): zero points across the
        field and the angle turns towards the goal line. So the along component
        is the sine and the across the cosine. Having them the other way round
        is a reflection rather than a rotation - it looks almost right, and
        leaves every player facing sixty to a hundred and sixty degrees off the
        way he is running.
        """
        a = float(direction) * DEG
        along = math.sin(a) * self.sa
        across = math.cos(a) * self.sx
        e = across * self.ct - along * self.st
        n = across * self.st + along * self.ct
        return math.degrees(math.atan2(-e, n))


def tracks(data):
    """
    A stable identifier per tracked thing, which the feed does not provide.

    Velocity's motion statistics need to know which observations belong to the
    same object, and `pos` will not do it: this play has two tackles, two
    guards, three receivers, two free safeties, two tackles on the line and
    three corners. Position plus a number within it is stable across frames,
    survives the file being regenerated, and still says something to a person
    reading a chart - which an array index does not.
    """
    seen = {}
    out = []
    for i, p in enumerate(data["players"]):
        side, pos = p.get("side", "?"), p.get("pos", "?")
        seen[(side, pos)] = seen.get((side, pos), 0) + 1
        out.append({
            "index": i,
            "track": "%s-%s-%d" % (side, pos, seen[(side, pos)]),
            "side": side,
            "pos": pos,
            "x": p["x"],
            "y": p["y"],
            "dir": p.get("dir"),
        })
    return out


def phases(data):
    """Frame -> the play event at or before it, so each observation knows it."""
    ev = sorted((f, name) for name, f in (data.get("events") or {}).items())
    n = data["meta"]["frames"]
    out, at = [None] * n, None
    k = 0
    for f in range(n):
        while k < len(ev) and ev[k][0] <= f:
            at = ev[k][1]
            k += 1
        out[f] = at
    return out
