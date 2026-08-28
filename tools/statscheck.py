"""Do the play's numbers describe the play — and does the app say where they came from?

Two things are checked here and the second matters as much as the first.

**Are they right.** The readout claims a carrier, a speed, a nearest defender
and whether the gap is closing. Those are checkable against the passage they
come from, because the passage is a real recorded touchdown and it has a shape:
the ball starts with the centre and nobody is moving; the quarterback takes it
and drops back with a lineman closing; the ball goes up and belongs to nobody
for a second and a half; a receiver catches it and runs at better than twenty
miles an hour; the safety loses ground. A readout that cannot reproduce that
story is wrong however plausible its numbers look in isolation.

**Does the app admit what they are.** These are computed in the browser from a
recording. They are not sensor readings and the app must never let anybody think
they are - so the label is asserted, the words behind it are asserted, and the
route from one to the other is asserted. A caveat that is present but
unreachable is not a caveat.

Both sports, because the pitch play normalises different units and a separation
in yards reported as metres would be wrong by ten per cent and look fine.

Run tools/serve.py first, then: python tools/statscheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
fails = []


def plain(v):
    """The arrows are the readout's own; a Windows console cannot print them."""
    return (str(v).replace("▼", "(closing)").replace("▲", "(opening)")
            .replace("—", "-"))


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + plain(detail) if detail else ""))
    if not cond:
        fails.append(name)


READ = """(function(){
  var g = function(id){ return document.getElementById(id); };
  return JSON.stringify({
    shown: !g('playStats').hidden,
    carrier: g('statCarrier').textContent.trim(),
    dim: g('statCarrier').classList.contains('dim'),
    speed: g('statCarrierSpeed').textContent.trim(),
    chaser: g('statChaser').textContent.trim(),
    sep: g('statSep').textContent.trim(),
    closing: g('statSep').classList.contains('closing'),
    opening: g('statSep').classList.contains('opening'),
    top: g('statTop').textContent.trim(),
    src: g('statSource').textContent.trim(),
    srcTip: g('statSource').getAttribute('title') || ''
  });})()"""


def num(s, default=None):
    """
    The leading number out of '17.9 mph' or '8.8 yd v'.

    `default` rather than the caller writing `num(x) or 0`, which is the same
    idea and wrong: a genuine zero is falsy, so a stationary player reading
    0.0 mph would silently become whatever the fallback was. That is exactly
    the pre-snap case this file opens with, and it failed the first time round.
    """
    out = ""
    for ch in (s or ""):
        if ch.isdigit() or ch == ".":
            out += ch
        elif out:
            break
    return float(out) if out else default


def at(c, t):
    c.js("window.__play.seek(%f)" % t)
    time.sleep(0.3)
    return json.loads(c.js(READ))


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
    c.js("window.__play.pause()")

    # ---------------------------------------------------- the story of a play
    print("")
    print("-- the 75-yard touchdown, read off the passage --")
    s = at(c, 1.0)
    ok("the readout is up with the replay", s["shown"] is True)
    ok("before the snap the ball is with the centre and nothing is moving",
       s["carrier"] == "C" and num(s["speed"], 9) < 1.0,
       "%s at %s" % (s["carrier"], s["speed"]))

    s = at(c, 3.0)
    ok("the quarterback has it as he drops back",
       s["carrier"] == "QB", "%s at %s" % (s["carrier"], s["speed"]))
    ok("and a lineman is closing on him",
       s["closing"] is True and s["chaser"].startswith("D"),
       "%s %s" % (s["chaser"], s["sep"]))

    s = at(c, 5.0)
    ok("with the ball in the air nobody is carrying it",
       s["carrier"] == "In flight" and s["dim"] is True, s["carrier"])
    ok("and the throw is a throw, not a jog",
       40 <= num(s["speed"], 0) <= 70, s["speed"])

    s = at(c, 8.0)
    ok("the receiver has it after the catch",
       s["carrier"].startswith("WR"), "%s at %s" % (s["carrier"], s["speed"]))
    ok("running at a speed a person can actually run",
       15 <= num(s["speed"], 0) <= 25, s["speed"])
    ok("with the safety closing", s["closing"] is True,
       "%s %s" % (s["chaser"], s["sep"]))

    s = at(c, 11.0)
    ok("and three seconds later he has pulled away", s["opening"] is True,
       "%s %s" % (s["chaser"], s["sep"]))

    tops = num(s["top"])
    ok("the passage's top speed is a sprinter's, not a car's",
       tops is not None and 18 <= tops <= 24, s["top"])
    ok("and nothing in it beat the top speed",
       all(num(at(c, t)["speed"], 0) <= tops + 0.2
           for t in (8.0, 9.0, 10.0)),
       "top %s" % s["top"])

    # ------------------------------------------------- and what they are not
    print("")
    print("-- what the app says they are --")
    ok("the numbers carry a label saying where they came from",
       "browser" in s["src"].lower() or "derived" in s["src"].lower(), s["src"])
    tip = s["srcTip"].lower()
    ok("which says the tracking is real and recorded",
       "recorded" in tip or "real" in tip, s["srcTip"][:60])
    ok("and that the figures are not measured by sensors",
       "not measured" in tip or "sensor" in tip, s["srcTip"][:80])

    c.js("document.getElementById('statSource').click()")
    time.sleep(1.5)
    sheet = json.loads(c.js("""JSON.stringify({
      open: !document.getElementById('infoSheet').hidden,
      text: document.getElementById('infoSheet').textContent})"""))
    ok("pressing the label opens the explanation", sheet["open"] is True)
    body = " ".join(sheet["text"].split()).lower()
    def says(phrase):
        """The sentence around a phrase, so a pass shows what it matched."""
        i = body.find(phrase)
        return body[max(0, i - 30):i + len(phrase) + 30] if i >= 0 else "NOT FOUND"

    ok("which says the analysis is done in the browser",
       "in your browser" in body, says("in your browser"))
    ok("and that there is no live feed behind it",
       "no live feed" in body or "not connected to a stadium" in body,
       says("no live feed"))
    ok("and names what a real deployment would use",
       "velocity" in body, says("velocity"))
    c.js("document.getElementById('infoClose').click()")
    time.sleep(1)

    # ------------------------------------------------------- the other sport
    print("")
    print("-- the pitch, which normalises different units --")
    c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true}));")
    for _ in range(60):
        time.sleep(0.5)
        if c.js("window.__play && window.__play.surfaceKey === 'pitch'"):
            break
    time.sleep(3)
    c.js("window.__play.pause()")
    s = at(c, 20.0)
    ok("the readout followed the sport", s["shown"] is True, s["carrier"])
    ok("and separations are in the pitch's own unit, not the gridiron's",
       s["sep"].split()[1] == "m" if len(s["sep"].split()) > 1 else False,
       s["sep"])
    ok("with a top speed a footballer could reach",
       18 <= num(s["top"], 0) <= 24, s["top"])

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
