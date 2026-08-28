"""Does the simulator put the players where the app puts them?

tools/playfield.py is a port of the transform in js/play.js, and a port that is
never checked against its original is a fork. This drives the real app, asks it
where things are, and compares - because the failure mode here is silent. Get
the rotation, a flip or a surface dimension subtly wrong and the simulator still
emits twenty-three convincing tracks moving convincingly about a field; they are
just not the field, and nothing anywhere says so. It would surface as a Velocity
geofence that never triggers, three steps and one org away from the cause.

Everything is asked through the app's own public surface - `toLonLat`,
`ballEN()`, `acrossAxis()`, `halfWidth`, `depth` - so nothing had to be exposed
for the sake of being tested, and the constants in playfield.py are checked
rather than trusted:

    toLonLat(0, 0)          the field origin
    toLonLat(1000, 1000)    the metres-per-degree constants
    halfWidth, depth        the marked surface, not the painted slab
    acrossAxis()            the rotation, and the across-field flip
    ballEN() per frame      all of it at once, end to end

Both sports, because they exercise different halves: the gridiron play declares
its space in yards on a 109.7 m field, the football one in metres on a 105 m
pitch, and the transform divides the units out. A port that only ever saw one of
them could have the normalisation backwards and pass.

Run tools/serve.py first, then: python tools/simcheck.py
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402
import playfield  # noqa: E402
from playfield import Field, load, tracks  # noqa: E402
from simulate_play import observations  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []

# A centimetre would be luck; a metre would hide a real mistake. Five is the
# width of a stripe on the field and about a third of a player.
TOL_M = 0.05
# Degrees. At this latitude a millionth of a degree is about a tenth of a metre.
TOL_DEG = 2e-6


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


def check(c, key, label):
    """One play: the constants, then the whole transform against the app."""
    print("")
    print("-- %s --" % label)
    data = load(key)
    field = Field(data)
    hz = float(data["meta"]["hz"])
    n = int(data["meta"]["frames"])

    live = json.loads(c.js("""JSON.stringify({
      surface: window.__play.surfaceKey,
      origin: window.__play.toLonLat(0, 0),
      far: window.__play.toLonLat(1000, 1000),
      halfWidth: window.__play.halfWidth,
      depth: window.__play.depth,
      across: window.__play.acrossAxis(),
      frames: window.__play.data.meta.frames,
      hz: window.__play.data.meta.hz
    })"""))

    ok("the app is showing the play under test",
       live["surface"] == field.key and live["frames"] == n,
       "%s %s frames" % (live["surface"], live["frames"]))

    # --- the constants ------------------------------------------------------
    olon, olat = live["origin"]
    ok("the field origin matches",
       abs(olon - playfield.FIELD_LON) < 1e-9
       and abs(olat - playfield.FIELD_LAT) < 1e-9,
       "app %.8f,%.8f" % (olat, olon))

    want = Field.to_lonlat(1000.0, 1000.0)
    ok("and the metres-per-degree constants",
       abs(live["far"][0] - want[0]) < 1e-9 and abs(live["far"][1] - want[1]) < 1e-9,
       "app %.7f,%.7f  port %.7f,%.7f"
       % (live["far"][1], live["far"][0], want[1], want[0]))

    ok("the marked surface is the one being mapped onto",
       abs(live["halfWidth"] * 2 - field.across) < 1e-6
       and abs(live["depth"] - field.depth) < 1e-6,
       "app %.3f x %.3f  port %.3f x %.3f"
       % (live["depth"], live["halfWidth"] * 2, field.depth, field.across))

    # The across-field unit vector carries the rotation and the across flip, and
    # is the one place a sign error shows up as a number rather than as a shrug.
    a = field.to_en(field.length / 2, 0)
    cc = field.to_en(field.length / 2, field.width)
    dx, dy = cc[0] - a[0], cc[1] - a[1]
    L = math.hypot(dx, dy) or 1
    mine = (dx / L, dy / L)
    ok("the field's rotation matches",
       abs(live["across"][0] - mine[0]) < 1e-9
       and abs(live["across"][1] - mine[1]) < 1e-9,
       "app %.6f,%.6f  port %.6f,%.6f"
       % (live["across"][0], live["across"][1], mine[0], mine[1]))

    # --- and the whole thing, frame by frame --------------------------------
    # The ball goes through exactly the same toEN as the players do, so this
    # tests the transform rather than the ball. Sampled across the passage
    # rather than at the start, where everybody is still standing on their marks
    # and a rotation error is at its smallest.
    at = [int(n * k / 12.0) for k in range(1, 12)]
    c.js("window.__play.pause()")
    gaps = []
    for f in at:
        c.js("window.__play.seek(%.6f)" % (f / hz))
        time.sleep(0.12)
        got = json.loads(c.js("JSON.stringify(window.__play.ballEN())"))
        mine = field.to_en(data["ball"]["x"][f], data["ball"]["y"][f])
        gaps.append((math.hypot(got[0] - mine[0], got[1] - mine[1]), f))
    # Asserted rather than assumed: a loop that never ran would report a
    # flawless agreement it had not measured, which is the one result this
    # check must never be able to produce.
    ok("the ball was actually compared, at points across the passage",
       len(gaps) == len(at) and len(at) >= 8, "%d samples" % len(gaps))
    worst, worst_f = max(gaps) if gaps else (float("inf"), -1)
    ok("the ball lands where the app puts it, all through the passage",
       bool(gaps) and worst < TOL_M,
       "worst %.4f m at frame %d of %d%s"
       % (worst, worst_f, n, " — exact" if worst == 0 else ""))

    # --- and the events the simulator would send ----------------------------
    frames = list(observations(data, key))
    ok("one observation per track per frame",
       len(frames) == n and all(len(fr) == len(data["players"]) + 1
                                for _f, _t, fr in frames),
       "%d frames of %d" % (len(frames), len(frames[0][2]) if frames else 0))

    ids = [ob["track"] for ob in frames[0][2]]
    ok("every track has its own name", len(set(ids)) == len(ids),
       "%d of %d unique" % (len(set(ids)), len(ids)))
    ok("and the ball is one of them", "ball" in ids)

    ts = [t for _f, t, _fr in frames]
    ok("time runs forward, once per frame",
       all(b > a for a, b in zip(ts, ts[1:]))
       and abs(ts[-1] - (n - 1) / hz) < 1e-6,
       "%.1f s over %d frames" % (ts[-1], n))

    # Nothing should land outside the surface it is played on - a stray sign
    # puts a player in the car park, and this is the cheapest place to notice.
    half_d, half_w = field.depth / 2 + 12, field.across / 2 + 12
    out = []
    for _f, _t, fr in frames:
        for ob in fr:
            e = (ob["lon"] - playfield.FIELD_LON) * playfield.M_PER_LON
            nn = (ob["lat"] - playfield.FIELD_LAT) * playfield.M_PER_LAT
            if math.hypot(e, nn) > math.hypot(half_d, half_w):
                out.append(ob["track"])
    ok("nothing ends up off the field", not out,
       "%d observations adrift (%s)" % (len(out), sorted(set(out))[:4]))

    heads = [ob["heading"] for _f, _t, fr in frames for ob in fr
             if "heading" in ob]
    ok("headings are compass degrees",
       bool(heads) and all(-180.0 <= h <= 180.0 for h in heads),
       "%d values, %.0f..%.0f" % (len(heads), min(heads), max(heads)))


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL + "?live")
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(8)

    check(c, "gridiron", "American football — yards on a 109.7 m field")

    # The other half of the normalisation: metres on a 105 m pitch.
    c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true}));")
    for _ in range(60):
        time.sleep(0.5)
        if c.js("window.__play && window.__play.surfaceKey === 'pitch'"):
            break
    time.sleep(3)
    check(c, "football", "Football — metres on a 105 m pitch")

    print("")
    print("  errors:", c.errs or "none")
    if c.errs:
        fails.append("console errors")
finally:
    proc.terminate()

print("")
print("%s  (%d failed)" % ("PASSED" if not fails else "FAILED", len(fails)))
for f in fails:
    print("   - %s" % f)
sys.exit(1 if fails else 0)
