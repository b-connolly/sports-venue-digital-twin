"""Can the app show a day that has not happened yet?

Everything else this app shows is the world as it is or as it was. The captures
are a morning that has been and gone, the replays are passages that were
actually played, and the live weather and the real sun are the present. None of
that is a prediction, and a model that can only ever show the present wearing a
different light is a 3D model with a clock on it.

The clock was already scrubbable to any hour and the sun already followed it.
The weather did not - so nine tomorrow morning showed tomorrow's sun under
today's sky, which is the same fault dressed up. It now follows too, off the
hourly forecast the endpoint was already being asked for.

Three things are checked, and the third is the one that matters most:

  * the forecast is actually fetched and kept - a week of hourly, in the same
    shape as the live reading so nothing downstream has to ask which it has
  * stepping the day moves the sky as well as the sun, and stops at the end of
    what is known rather than inventing past it
  * the app says which it is showing. A temperature offered as a measurement and
    one offered as a prediction must not look the same, or the app is quietly
    asserting something it does not know.

Run tools/serve.py first, then: python tools/forecastcheck.py
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
  var s = window.__sky, v = window.__view;
  var tag = document.getElementById('wxTag');
  return JSON.stringify({
    hours: s.hours ? s.hours.length : 0,
    horizon: s.horizon,
    forecast: s.forecast ? {t: s.forecast.t, temp: s.forecast.temp,
                            kind: s.forecast.kind, code: s.forecast.code} : null,
    kind: s.kind,
    liveTemp: s.live ? s.live.temp : null,
    date: +v.environment.lighting.date,
    now: Date.now(),
    readout: document.getElementById('timeReadout').textContent,
    chipTemp: document.getElementById('wxTemp').textContent,
    chipDesc: document.getElementById('wxDesc').textContent,
    tagShown: tag ? !tag.hidden : null,
    tagText: tag ? tag.textContent : null,
    prevOff: document.getElementById('timeDayPrev').disabled,
    nextOff: document.getElementById('timeDayNext').disabled,
    manual: !!s.manual
  });})()"""


def st(c):
    return json.loads(c.js(STATE))


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("!!window.__view && !!window.__sky"):
            break
        time.sleep(0.5)
    for _ in range(180):
        if not c.js("document.getElementById('enter').disabled"):
            break
        time.sleep(0.5)
    c.js("document.getElementById('enter').click()")
    time.sleep(9)

    # --- the forecast is there ----------------------------------------------
    s = st(c)
    ok("a week of hourly forecast is kept", s["hours"] >= 160,
       "%d hours" % s["hours"])
    # Far enough to reach a fixture, which is the point of it - the question a
    # venue is asked is about kickoff, and kickoff is a date on a calendar.
    ok("and it reaches to the end of the week",
       s["horizon"] is not None and s["horizon"] - s["now"] > 5 * 24 * 36e5,
       "+%.0f h" % ((s["horizon"] - s["now"]) / 36e5 if s["horizon"] else -1))
    ok("nothing is being called a forecast yet", s["forecast"] is None, s["readout"])
    ok("and the chip is not claiming one", s["tagShown"] is False)

    # --- stepping the day ----------------------------------------------------
    c.js("document.getElementById('timeOfDay').click()")
    time.sleep(3)
    s = st(c)
    ok("there is no yesterday to step back to", s["prevOff"] is True)
    ok("but there is a tomorrow", s["nextOff"] is False)

    today = st(c)
    c.js("document.getElementById('timeDayNext').click()")
    time.sleep(3)
    s = st(c)
    ok("stepping forward moves the clock a day",
       abs((s["date"] - today["date"]) - 864e5) < 6e4,
       "%.1f h" % ((s["date"] - today["date"]) / 36e5))
    ok("and the weekday on the readout changes with it",
       s["readout"][:3] != today["readout"][:3],
       "%s -> %s" % (today["readout"], s["readout"]))

    # The thing this exists for: the sky is the forecast's, not today's.
    ok("the sky is now the forecast's", s["forecast"] is not None, s["readout"])
    ok("and it is the hour the clock is actually on",
       s["forecast"] is not None
       and abs(s["forecast"]["t"] - s["date"]) <= 36e5,
       s["forecast"] and "%.0f min out"
       % (abs(s["forecast"]["t"] - s["date"]) / 6e4))
    ok("the scene is rendering that kind of weather",
       s["kind"] == (s["forecast"] or {}).get("kind"),
       "%s vs %s" % (s["kind"], (s["forecast"] or {}).get("kind")))
    ok("and the chip shows the forecast temperature, not the live one",
       s["chipTemp"] == "%d°F" % s["forecast"]["temp"],
       "%s, live was %s°F" % (s["chipTemp"], today["liveTemp"]))

    # --- and says so ---------------------------------------------------------
    ok("the chip says it is a forecast", s["tagShown"] is True, s["tagText"])
    ok("and how far out", "+" in (s["tagText"] or ""), s["tagText"])

    # --- it stops where the forecast does ------------------------------------
    for _ in range(9):
        if st(c)["nextOff"]:
            break
        c.js("document.getElementById('timeDayNext').click()")
        time.sleep(2)
    s = st(c)
    ok("stepping stops at the end of what is known", s["nextOff"] is True,
       "%s, horizon +%.0f h"
       % (s["readout"], (s["horizon"] - s["now"]) / 36e5))
    ok("and the way back is open by then", s["prevOff"] is False)

    # --- live puts it all back -----------------------------------------------
    c.js("document.getElementById('timeLive').click()")
    time.sleep(3)
    s = st(c)
    ok("Live comes back to now", abs(s["date"] - s["now"]) < 12e4,
       "%.1f s off" % (abs(s["date"] - s["now"]) / 1000.0))
    ok("and stops calling it a forecast",
       s["forecast"] is None and s["tagShown"] is False, s["tagText"])
    ok("the chip is showing the measured temperature again",
       s["chipTemp"] == "%d°F" % s["liveTemp"],
       "%s vs live %s°F" % (s["chipTemp"], s["liveTemp"]))

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
