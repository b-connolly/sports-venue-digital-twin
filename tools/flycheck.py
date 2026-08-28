"""Does the walk from Night Sky to the statues stay outside the stadium?

The slideshow's ordinary move between two views interpolates the camera in x, y
and z, which is right for almost every pair in this scene and wrong for one.
Night Sky sits out to the north-west; the statue plaza is due south. The
straight line between them goes through the building - half a second of
concrete interior at speed, and out the other side - and no easing fixes that,
because the problem is the shape of the path rather than its pace.

So that one move is flown instead: a sweep anticlockwise round the west stand,
high, and then down onto the plaza. Three things are checked here and none of
them can be seen in the source.

  * It stays outside. The camera keeps its distance from the middle of the
    ground until it is round to the south and clear of the building, and only
    then closes in. This is the assertion the waypoints exist to satisfy, and
    it is checked against the camera the app actually flies rather than against
    the numbers written down - a Catmull-Rom through those numbers can bulge
    between them, and a path that reads as safe in the config can still cut a
    corner in the air.

  * The sun walks home with it. The view after Night Sky has no clock of its
    own, so live time used to come back in a single frame: a whole night undone
    at once, floodlights out, sky rewritten. It should now rise smoothly across
    the flight and hand back to the live clock at the end.

  * The statue captures start loading at the top of the move rather than on
    arrival. Nineteen seconds of streaming is most of what the flight is for.

Run tools/serve.py first, then: python tools/flycheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []

# The middle of the playing surface - CONFIG.field - which is what every
# distance here is measured from.
LAT, LON = 39.74392969, -105.02011614

# How close the camera may come to the middle of the ground while it is still
# on the way round. The building's outer wall is inside this; the destination,
# on the plaza to the south, is outside it at 143 m and is reached along a
# radial from further out, never across.
KEEP_OUT_M = 185
# Where "on the way round" stops. Past this the camera is south of the ground
# and closing in is the arrival rather than a shortcut through the bowl.
CLEAR_OF_IT_DEG = -150


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


# Records the camera and the clock every frame, so the path can be inspected
# rather than inferred. Installed before the move and read back after it.
RECORD = """(function(){
  window.__fly = [];
  var v = window.__view;
  var lay = function(t){
    var l = v.map.allLayers.find(function(x){return x.title === t;});
    return l ? !!l.visible : null;
  };
  var LATM = 110540, LONM = 111320, LAT = %f, LON = %f;
  var step = function(){
    var c = v.camera; if (!c) { requestAnimationFrame(step); return; }
    var p = c.position;
    var east = (p.longitude - LON) * LONM * Math.cos(LAT*Math.PI/180);
    var north = (p.latitude - LAT) * LATM;
    var d = v.environment.lighting.date;
    window.__fly.push({
      t: performance.now(),
      bearing: Math.atan2(east, north)*180/Math.PI,
      out: Math.hypot(east, north),
      z: p.z, tilt: c.tilt, heading: c.heading,
      date: d ? +d : null,
      handle: (window.__timeSlider && window.__timeSlider.timeExtent
               && window.__timeSlider.timeExtent.start)
        ? +window.__timeSlider.timeExtent.start : null,
      lit: !!v.environment.lighting.type && v.environment.lighting.type === "virtual",
      stampede: lay("Broncos Stampede"),
      splat: lay("Gaussian Splat")
    });
    if (window.__flyRec) requestAnimationFrame(step);
  };
  window.__flyRec = true;
  requestAnimationFrame(step);
})()""" % (LAT, LON)


def unwrap(seq):
    """Bearings as a continuous run, so a pass through +/-180 is not a jump."""
    out = []
    for b in seq:
        if out:
            while b - out[-1] > 180:
                b -= 360
            while b - out[-1] < -180:
                b += 360
        out.append(b)
    return out


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__view && !!window.__view.map"):
            break
        time.sleep(0.5)
    # Through the front door, and this matters more here than anywhere else.
    # Behind the intro the app is warming views by applying them - camera and
    # layer visibility both - and clicking Explore is what stops it. Driving the
    # tour with the curtain still up puts single frames of somebody else's
    # viewpoint through the middle of the flight and rewrites the layers under
    # it, which looks exactly like the flight itself misbehaving. It cost an
    # afternoon once; it is worth the twenty lines.
    for _ in range(180):
        if not c.js("document.getElementById('enter').disabled"):
            break
        time.sleep(0.5)
    c.js("document.getElementById('enter').click()")
    for _ in range(60):
        if c.js("document.getElementById('intro').classList.contains('gone')"):
            break
        time.sleep(0.5)
    time.sleep(8)
    ok("the preload has stood down", not c.js(
        "document.getElementById('intro').classList.contains('gone') === false"))

    # Onto Night Sky by hand. Playing the show to it would mean sitting through
    # both replays and the holds they now take, and the flight does not care how
    # the camera got to the view it starts from.
    titles = json.loads(c.js("""JSON.stringify([].map.call(
      document.getElementById('tourList').children,
      function(b){return b.textContent;}))"""))
    at = next((i for i, t in enumerate(titles) if "Night Sky" in t), None)
    ok("the scene still has a Night Sky view", at is not None, str(titles))
    if at is None:
        raise SystemExit(1)
    c.js("document.getElementById('tourList').children[%d].click()" % at)
    time.sleep(10)

    started = json.loads(c.js(
        "JSON.stringify({idx: document.getElementById('tourIdx').textContent})"))
    ok("it is on Night Sky", started["idx"].startswith("%02d" % (at + 1)),
       str(started))

    # Pressing play moves to the next view, which is the move under test. The
    # flight only runs while the show is running - stepping by hand gets the
    # ordinary flight - so this is also the only way to trigger it.
    c.js(RECORD)
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(24)
    c.js("window.__flyRec = false")
    path = json.loads(c.js("JSON.stringify(window.__fly)"))

    # Tuning a camera move means looking at the numbers it actually flew, not at
    # the ones it was given. FLY_DUMP=path.json writes them out.
    if os.environ.get("FLY_DUMP"):
        with open(os.environ["FLY_DUMP"], "w") as fh:
            json.dump(path, fh)
        print("  wrote %s" % os.environ["FLY_DUMP"])

    ok("the move was recorded", len(path) > 200, "%d samples" % len(path))
    if len(path) < 200:
        raise SystemExit(1)

    # --- it is a flight, not a 2.6 s slide move ---------------------------
    # The recording runs past the landing, because the show carries on to the
    # next view after its dwell and there is no point racing it. Everything
    # below is about the flight, so the samples are cut to it: from the first
    # frame that moves, for the length the flight is written to take.
    FLIGHT_MS = 19000
    span = (path[-1]["t"] - path[0]["t"]) / 1000.0
    moved = [p for p in path if abs(p["out"] - path[0]["out"]) > 1]
    ok("the camera moved at all", bool(moved), "%.1f s watched" % span)
    if not moved:
        raise SystemExit(1)
    t0 = moved[0]["t"]
    path = [p for p in path if t0 <= p["t"] <= t0 + FLIGHT_MS + 800]
    flown = (path[-1]["t"] - path[0]["t"]) / 1000.0
    ok("the camera was flown rather than cut", flown > 12,
       "%.1f s of flight in %.1f s watched" % (flown, span))

    # --- and it stayed outside --------------------------------------------
    bear = unwrap([p["bearing"] for p in path])
    inside = [(round(b, 1), round(p["out"])) for b, p in zip(bear, path)
              if b > CLEAR_OF_IT_DEG and p["out"] < KEEP_OUT_M]
    ok("it never crosses the building on the way round",
       not inside,
       "closest while still round the side: %s"
       % (str(min(inside, key=lambda x: x[1])) if inside else "n/a"))

    ok("and it never dips inside the view it is going to",
       min(p["out"] for p in path) > 138,
       "%.0f m" % min(p["out"] for p in path))

    # A spline through the waypoints can bulge; the arc should be one sweep,
    # not a wander. Every step the same way round, within a frame's noise.
    steps = [b - a for a, b in zip(bear, bear[1:])]
    back = [d for d in steps if d > 0.35]
    ok("the sweep goes one way round", len(back) < 4,
       "%d frames of reversal" % len(back))

    # --- the sun walked, and got home -------------------------------------
    # The walk ends a day ahead of the true instant and the hand-back to the
    # live clock steps that day off in one frame. That is deliberate and it is
    # invisible - the same time of day is the same sun - but it is a real jump
    # in the series, so it is identified and excluded by name rather than by
    # loosening the threshold until everything passes.
    #
    # It lands before the last frame rather than on it. The clock is started
    # when the move is decided and the camera when the flight actually begins,
    # a second or so later once the landing camera has been worked out, so the
    # sun finishes that much ahead of the shot. Both are 19 s; they are just not
    # in phase, and nothing about the transition needs them to be.
    dates = [p["date"] for p in path if p["date"]]
    live_ms = c.js("Date.now()")
    steps = [(i, b - a) for i, (a, b) in enumerate(zip(dates, dates[1:]))]
    handoff = [(i, d) for i, d in steps if d < -12 * 36e5]
    ok("the clock moved during the flight",
       len(dates) > 100 and (max(dates) - min(dates)) > 4 * 36e5,
       "%.1f h" % ((max(dates) - min(dates)) / 36e5 if dates else 0))
    # And moved hours, not months: the whole failure this was written to catch
    # was a sun that crossed a hundred and sixty-five days in nineteen seconds
    # because the clock had picked up the scene's authored date.
    ok("it walked a day at most, not a season",
       (max(dates) - min(dates)) < 30 * 36e5,
       "%.1f h" % ((max(dates) - min(dates)) / 36e5 if dates else 0))
    # Asserted by what it leaves behind rather than by where it lands in the
    # array. How many frames follow it depends on how far the clock's 19 s and
    # the camera's 19 s are out of phase, which is a timing detail; that the
    # clock is live from there on is the actual claim.
    settled = dates[handoff[0][0] + 1:] if len(handoff) == 1 else []
    ok("the hand-back to live is a single step of one day",
       len(handoff) == 1 and abs(abs(handoff[0][1]) - 24 * 36e5) < 2 * 36e5,
       "%s" % str([(i, round(d / 36e5, 1)) for i, d in handoff]))
    ok("and everything after it is the live clock",
       bool(settled) and all(abs(x - live_ms) < 12e4 for x in settled),
       "%d frames, worst %.0f s off"
       % (len(settled),
          max((abs(x - live_ms) / 1000.0 for x in settled), default=-1)))
    rest = [round(d / 60000.0) for i, d in steps if (i, d) not in handoff]
    ok("and otherwise it swept rather than jumped",
       all(d <= 40 for d in rest),
       "biggest single frame: %s min" % (max(rest) if rest else "n/a"))
    ok("it only ever ran forwards",
       all(d >= -1 for d in rest),
       "furthest back: %s min" % (min(rest) if rest else "n/a"))

    live = json.loads(c.js("""JSON.stringify({
      manual: window.__sky ? window.__sky.manual : null,
      date: +window.__view.environment.lighting.date,
      now: Date.now()})"""))
    ok("and handed back to the live clock",
       abs(live["date"] - live["now"]) < 90000,
       "%.1f s off live" % (abs(live["date"] - live["now"]) / 1000.0))

    # --- and the handle went with it --------------------------------------
    # The track is one day long and the walk crosses midnight, so a handle that
    # only ever clamps parks against the edge and stays there while the readout
    # above it goes on counting. What is asserted is agreement, not position:
    # the widget owns where it draws things, and the claim is only that it is
    # drawing the same instant the sun is at.
    both = [(p["date"], p["handle"]) for p in path
            if p["date"] and p["handle"]]
    apart = [abs(d - h) / 60000.0 for d, h in both]
    ok("the slider handle followed the sun", bool(both) and max(apart) < 20,
       "worst disagreement %.0f min over %d frames"
       % (max(apart) if apart else -1, len(both)))

    # --- the statues had the whole flight to load -------------------------
    # Measured in seconds, not in sample index. The recorder runs on rAF and
    # the frame rate is not uniform across a flight - it drops while the scene
    # is streaming hardest, which is exactly the middle - so the index of a
    # sample is not a fraction of the move. Asserted by index this sat on
    # 0.50 of a 0.5 threshold for several runs and eventually landed the wrong
    # side of it, which is a flaky test rather than a finding.
    span = path[-1]["t"] - path[0]["t"]

    def when(pred):
        """How far into the recorded window a condition first holds, 0..1."""
        hit = next((p for p in path if pred(p)), None)
        return None if hit is None or span <= 0 else (hit["t"] - path[0]["t"]) / span

    on = when(lambda p: p["stampede"])
    ok("the statue capture is switched on at the top of the move",
       on is not None and on < 0.25,
       "%.0f%% in" % (on * 100) if on is not None else "never")

    # And the splat is not dropped until the camera has turned away from it.
    off = when(lambda p: p["splat"] is False)
    ok("the splat is not dropped until late in the move",
       off is None or off > 0.5,
       "%.0f%% in" % (off * 100) if off is not None else "never")

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
