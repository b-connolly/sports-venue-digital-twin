"""Is the light switch always there, and does it stay switched?

The floodlights used to be offered only when the sun was below six degrees.
That is the wrong call: a stadium bowl is its own shade, and a low morning sun
leaves the ground dim while the sky says broad daylight. The switch is now
offered at every hour and the sun only decides what it defaults to.

Which makes two things worth holding onto, and they pull against each other.
The lights have to come on by themselves after dark - nobody should have to ask
for them at a night game - and they have to stay wherever a person last put
them. The obvious way to get the first is to assert the state on every tick,
and that quietly destroys the second: switch them off and a second later they
are back on. So both directions are edges, and this checks that switching by
hand outlives the ticks that follow it.

Not covered: the dawn hand-off, where lights left on are taken back by the sun.
Driving the scene clock backwards from a test turned out to need more scaffolding
than the branch is worth - the displayed clock only moves once the weather fetch
has supplied a timezone, so polling it can wait forever on a slow network - and a
test that cannot tell "not yet" from "never" is the kind that gets misread later.
It is the one branch here still resting on reading the code.

Run tools/serve.py first, then: python tools/lightscheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


STATE = """(function(){
  var b = document.getElementById('lightsBtn');
  return JSON.stringify({
    offered: b ? !b.hidden : null,
    on: b ? b.classList.contains('on') : null,
    clock: (document.getElementById('wxTime')||{}).textContent,
    panel: !document.getElementById('playPanel').hidden});})()"""


DENVER_OFFSET = 6          # MDT; headless Chrome runs in UTC


def set_clock(c, hour, why=""):
    """Put the scene's sun at a given *Denver* hour, and wait for it to land.

    Two things this has to get right, and an earlier version got neither.

    setHours would be the browser's zone, which headless Chrome runs as UTC -
    six hours out, enough to turn an evening into an afternoon and invert every
    assertion below.

    And the change is not instant: assigning the scene's lighting date takes a
    moment to come back round through the app's own tick, so a fixed sleep read
    the previous hour and blamed the app for it. This polls the clock the app
    displays and only returns once it says what was asked for, which also makes
    a wrong timezone fail loudly rather than quietly testing the wrong hour.
    """
    c.js("""(function(h){
      // With the floodlights on the scene runs VirtualLighting, which has no
      // date at all - reading one back gives undefined and an Invalid Date -
      // so the app's own clock is the thing to build on, whichever is driving.
      var s = window.__sky;
      var d = new Date((s && s.date) || window.__view.environment.lighting.date
                       || Date.now());
      d.setUTCHours(h, 0, 0, 0);
      if (window.__sky) { window.__sky.manual = true; window.__sky.date = d; }
      // Only meaningful when the sun is driving; harmless when it is not.
      try { window.__view.environment.lighting.date = d; } catch (e) {}
    })(%d)""" % ((hour + DENVER_OFFSET) % 24))

    want = "%d:00 %s" % (hour % 12 or 12, "AM" if hour < 12 else "PM")
    for _ in range(40):
        time.sleep(0.5)
        shown = (json.loads(c.js(STATE)).get("clock") or "").strip()
        if shown == want:
            time.sleep(2)          # let a tick or two run at the new hour
            return shown
    raise SystemExit(
        "the clock never reached %s (last saw %r)%s" % (want, shown, why))


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL + "?live")
    for _ in range(400):
        if c.js("!!window.__play"):
            break
        time.sleep(0.5)
    time.sleep(9)

    st = json.loads(c.js(STATE))
    ok("the replay panel is open to test against", st["panel"], st)

    # --- daylight: no switch ------------------------------------------------
    set_clock(c, 13)
    st = json.loads(c.js(STATE))
    ok("at one in the afternoon the switch is still offered",
       st["offered"] is True, st)
    ok("but the lights are not on by themselves in daylight",
       st["on"] is False, st)

    # The morning case: a bowl is its own shade, so this has to be possible.
    c.js("document.getElementById('lightsBtn').click()")
    time.sleep(3)
    st = json.loads(c.js(STATE))
    ok("they can be switched on in daylight", st["on"] is True, st)
    time.sleep(5)
    st = json.loads(c.js(STATE))
    ok("and the clock does not switch them back off", st["on"] is True, st)

    # Whatever the hour, it is still a switch: off has to survive the ticks.
    c.js("document.getElementById('lightsBtn').click()")
    time.sleep(3)
    st = json.loads(c.js(STATE))
    ok("and switching them off again works", st["on"] is False, st)
    time.sleep(6)
    st = json.loads(c.js(STATE))
    ok("off stays off, rather than the next tick undoing it",
       st["on"] is False, st)
    ok("and the switch is still offered either way",
       st["offered"] is True, st)

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
