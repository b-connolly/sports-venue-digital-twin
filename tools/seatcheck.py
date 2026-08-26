"""Are the seating sections where the printed chart says they are?

Bearings in js/seats.js are measured off tools/seating_chart.png rather than
derived, so this checks the app against the chart the table came from - and
against the compass, which is the part that matters.

Radial alignment alone is not enough. An earlier version of this file checked
only which sections shared a spoke, and passed while the whole bowl was rotated
forty degrees: every relative claim was true and every seat was on the wrong
side of the ground. So the first block below pins sections to compass points
that can be read off the chart without trusting any anchor - 114 on the north
end, 132 on the south, 105 and 123 level with the 50 on either touchline.

Run tools/serve.py first, then: python tools/seatcheck.py
"""
import json, os, sys, time
sys.path.insert(0, r"c:\Image_Mgmt_Workflows\Apps\MileHigh3D\tools")
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/") + "?live"
fails = []

def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)

proc, c = chrome()

# smoke's js() does not await, and the seats module has to be imported.
def jsa(expr):
    r = c.send("Runtime.evaluate", expression=expr,
               returnByValue=True, awaitPromise=True)
    return r.get("result", {}).get("value")

try:
    c.send("Page.enable"); c.send("Runtime.enable"); c.send("Input.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(8)

    # Every section the selector offers must be placeable.
    n = c.js("""(function(){
      var s = document.getElementById('seatSelect');
      return s ? s.options.length : -1;})()""")
    ok("the selector lists every section", int(n) == 135, n)

    # A section's bearing, read back out of the camera the app would fly to.
    # heading is bearing+180 by construction, so this needs no field centre and
    # no second copy of the arithmetic.
    BEAR = """(function(){
      var out = {};
      [%s].forEach(function(sec){
        var cam = window.__seats.camera(sec);
        out[sec] = cam ? +(((cam.heading + 180) %% 360)).toFixed(1) : null;
      });
      return JSON.stringify(out);})()"""

    raw = c.js(BEAR % ("114,323,521,131,231,133,233,100,501,236,118,329,"
                       "129,228,132,105,123,232,542,346,300,110,317,309,135,"
                       "128,309"))
    if not isinstance(raw, str):
        print("  raw:", raw)
        raise SystemExit("__seats not exposed")
    got = json.loads(raw)
    # Rings hold different numbers of sections - 36 in the bowl, 47 in the 300s -
    # so a spoke can only line up to within half a section. The 300s sit 6.1
    # degrees apart, so inside about 3 is the closest match that exists, and
    # outside it means a section out.
    def same(a, b, tol=3.2):
        return abs(((got[str(a)] - got[str(b)] + 180) % 360) - 180) < tol

    # --- against the compass, which no anchor can fake -------------------
    rot = float(c.js("String(window.__cfg ? window.__cfg.field.rotation : -0.59)"))
    def faces(sec, deg, tol=3.0):
        return abs(((got[str(sec)] - deg - rot + 180) % 360) - 180) < tol

    for sec, deg, why in [(114, 0, "the north end zone"),
                          (132, 180, "the south stand"),
                          (105, 270, "west, level with the 50"),
                          (123, 90, "east, level with the 50"),
                          (232, 180, "the middle of the club"),
                          (323, 0, "the north end, third ring"),
                          (521, 0, "the north end, top ring")]:
        ok("%d faces %s" % (sec, why), faces(sec, deg),
           "%.1f deg, wanted %d" % (got[str(sec)], deg))

    # 100 is the corner section, and the one my first two attempts misplaced.
    ok("100 is on the south-west corner, not due south",
       faces(100, 217.5, 4), got["100"])

    # --- and the spokes, which is how the error was first spotted ----------
    ok("114, 323 and 521 share a spoke", same(114, 323) and same(114, 521),
       "%s / %s / %s" % (got["114"], got["323"], got["521"]))
    ok("131 sits under 231", same(131, 231), "%s / %s" % (got["131"], got["231"]))
    ok("133 sits under 233", same(133, 233), "%s / %s" % (got["133"], got["233"]))
    ok("100 sits under 501", same(100, 501), "%s / %s" % (got["100"], got["501"]))
    # These four are the ones I originally read off the chart by eye and got
    # wrong by seven to ten degrees each - a whole section - which is what put
    # the measured table in seats.js in the first place.
    ok("118 sits under 329", same(118, 329), "%s / %s" % (got["118"], got["329"]))
    ok("110 sits under 317", same(110, 317), "%s / %s" % (got["110"], got["317"]))
    ok("105 sits under 309", same(105, 309), "%s / %s" % (got["105"], got["309"]))
    ok("135 sits under 236", same(135, 236), "%s / %s" % (got["135"], got["236"]))

    # The two arcs stop either side of the club rather than meeting.
    # The two upper arcs stop either side of the club rather than meeting it.
    ok("the 300 arc stops where the club begins",
       same(346, 128, 4.5) and same(300, 100, 4.5),
       "346=%s vs 128=%s | 300=%s vs 100=%s"
       % (got["346"], got["128"], got["300"], got["100"]))
    ok("129 sits under 228, where the club starts", same(129, 228),
       "%s / %s" % (got["129"], got["228"]))

    # The plan map is drawn from the same table, so it must have moved too.
    blocks = c.js("""(function(){
      var g = document.getElementById('seatMap');
      return g ? g.querySelectorAll('[data-section]').length : -1;})()""")
    ok("the plan map draws every block", int(blocks) == 135, blocks)

    # And a seat must still be reachable and land where it says.
    c.js("(function(){var p=window.__play;p.pause();p.seek(0);})()")
    c.js("""(function(){document.querySelectorAll('#playCams .camseg__b')
      .forEach(function(b){ if (b.dataset.cam === 'fan') b.click(); });})()""")
    time.sleep(3)
    c.js("""(function(){var s=document.getElementById('seatSelect');
      s.value='323'; s.dispatchEvent(new Event('change'));})()""")
    time.sleep(3)
    c.js("document.getElementById('seatTake').click()")
    time.sleep(5)
    cam = json.loads(c.js("""(function(){var c=window.__view.camera;
      return JSON.stringify({z:+c.position.z.toFixed(1), fov:+c.fov.toFixed(0),
        t:+c.tilt.toFixed(0)});})()"""))
    ok("323 is reachable and up in the third ring", cam["z"] > 1600, cam)
    ok("it still sees wide", cam["fov"] == 75, cam["fov"])

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
