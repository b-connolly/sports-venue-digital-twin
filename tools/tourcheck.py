"""Does the slideshow run itself, and ask for a hand when it stops?

Two things, and they are opposite sides of the same rule: the show owns the
views it staged, and the viewer owns everything else.

The show used to stand itself down on the American football view - it flew
there, opened the passage that view exists to show, and stopped the slideshow
for doing so, because opening a replay was treated as somebody overriding the
show whoever had done it. Whoever pressed play then had to press it again, on
the one view where something was actually happening.

It does stop there now, and that is not the same bug coming back: it stops
*after* the passage has run to its end, on purpose, because the end of a replay
is where somebody wants to scrub back through it rather than be moved along.
The distinction is the whole of the first half of this file - the passage must
finish, and only then may the show stand down - so both halves are asserted
together and neither can be satisfied by the other's failure.

And when it does stop - because the viewer changed the play, or the camera -
nothing said so. The play button now asks for a press when pressing it is the
thing to do: on arrival, and after the show has been stopped out from under
whoever started it. Never while it is running, and never after they have
answered it.

The third part is the way past the arrows. Stepping is fine on a first pass and
useless on a second, when somebody wants the night sky again and does not want
to walk four views to reach it - so the name of the view is a button and it
drops the whole list. Checked here for the two things that make it useful: that
the list is built from the scene's own slides rather than a hard-coded set, and
that choosing one actually arrives there.

Run tools/serve.py first, then: python tools/tourcheck.py
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
  var b = document.getElementById('tourPlay'), p = window.__play;
  return JSON.stringify({
    slide: (document.getElementById('tourIdx')||{}).textContent,
    touring: b.classList.contains('on'),
    hint: b.classList.contains('hint'),
    t: p ? +p.time.toFixed(1) : null,
    dur: p ? +p.duration.toFixed(1) : null});})()"""


def st(c):
    return json.loads(c.js(STATE))


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

    # --- the opening invitation ---------------------------------------------
    s = st(c)
    ok("the play button asks for a press on arrival", s["hint"] is True, s)
    ok("and the show is not running yet", s["touring"] is False, s)

    # --- pressing it answers the question -----------------------------------
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(3)
    s = st(c)
    ok("pressing play starts the show", s["touring"] is True, s)
    ok("and stops the button asking", s["hint"] is False, s)

    # --- the staged replay runs out, and then hands the show back -----------
    # Slide two opens the gridiron passage. Two failures are being told apart
    # here and they look identical from a single sample: standing the show down
    # because a replay was opened (the old bug) and standing it down because the
    # replay has finished (the intent). What separates them is where the
    # playhead is at the moment it stops, so that is what is captured.
    deadline = time.time() + 180
    saw_replay = False
    stopped = None
    while time.time() < deadline:
        s = st(c)
        if s["slide"].startswith("02"):
            saw_replay = True
            if not s["touring"]:
                stopped = s
                break
        if saw_replay and not s["slide"].startswith("02"):
            break
        time.sleep(1)
    ok("it reached the replay view", saw_replay, s)
    ok("the show stops there rather than moving on", stopped is not None, s)
    ok("and only once the passage had run to its end",
       stopped is not None and stopped["t"] is not None
       and stopped["dur"] is not None and stopped["t"] >= stopped["dur"] - 0.6,
       stopped and "%s of %s" % (stopped["t"], stopped["dur"]))
    ok("the button asks to be pressed to carry on",
       stopped is not None and stopped["hint"] is True, stopped)

    # Pressing it carries on from where the show left off rather than restarting
    # it - the hold is a held breath, not a stop.
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(6)
    s = st(c)
    ok("pressing it moves on to the next view",
       not s["slide"].startswith("02") and s["touring"] is True, s)

    # --- and the football view holds too ------------------------------------
    # Both replays, not just the first. They share one branch in schedule() so
    # this cannot really diverge, but "pause on both sports" is the ask and one
    # sample of one sport is not it. The football passage is the long one - 37 s
    # against the gridiron's 20 - so this waits accordingly.
    deadline = time.time() + 180
    held = None
    while time.time() < deadline:
        s = st(c)
        if s["slide"].startswith("03") and not s["touring"]:
            held = s
            break
        if not s["slide"].startswith("03") and held is None and s["touring"] \
                and time.time() > deadline - 60:
            break                      # walked past it: that is the failure
        time.sleep(1)
    ok("the football view holds as well", held is not None, s)
    ok("and it too ran its passage out first",
       held is not None and held["t"] is not None and held["dur"] is not None
       and held["t"] >= held["dur"] - 0.6,
       held and "%s of %s" % (held["t"], held["dur"]))

    # Back under way for the checks below, which are about the viewer stopping
    # the show rather than the show standing itself down.
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(5)

    # --- and the viewer stopping it is still a different thing --------------
    c.js("""(function(){
      var b = document.querySelectorAll('#playPicks button');
      if (b.length > 1) b[1].click();})()""")
    time.sleep(4)
    s = st(c)
    ok("changing the play stops the show", s["touring"] is False, s)
    ok("and the button asks for a press again", s["hint"] is True, s)

    # --- and answering it clears the ask -------------------------------------
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(3)
    s = st(c)
    ok("pressing it again clears the ask", s["hint"] is False, s)
    c.js("document.getElementById('tourPlay').click()")
    time.sleep(2)
    s = st(c)
    ok("stopping it by hand does not nag", s["hint"] is False, s)

    # --- jumping straight to a view ------------------------------------------
    # Built from the scene, so the count is whatever the author saved. What can
    # be asserted is that it matches the counter the rail is already showing.
    n_slides = int(st(c)["slide"].split("/")[1])
    ok("the list has one item per view",
       c.js("document.getElementById('tourList').children.length") == n_slides,
       "%s of %s" % (c.js("document.getElementById('tourList').children.length"),
                     n_slides))
    ok("and it starts closed",
       bool(c.js("document.getElementById('tourList').hidden")))

    c.js("document.getElementById('tourTitle').click()")
    time.sleep(0.6)
    ok("pressing the name of the view opens it",
       not c.js("document.getElementById('tourList').hidden"))
    ok("and the name says so",
       c.js("""document.getElementById('tourTitle')
         .getAttribute('aria-expanded')""") == "true")

    # The last view, which is the furthest from wherever the show left off, so
    # arriving at it cannot be a coincidence.
    c.js("""(function(){var l=document.getElementById('tourList');
      l.children[l.children.length-1].click();})()""")
    time.sleep(5)
    ok("choosing one closes the list",
       bool(c.js("document.getElementById('tourList').hidden")))
    ok("and arrives at that view",
       st(c)["slide"].startswith("%02d" % n_slides), st(c)["slide"])
    ok("which is then marked as the one you are on",
       bool(c.js("""(function(){var l=document.getElementById('tourList');
         return l.children[l.children.length-1].classList.contains('on');})()""")))

    # Clicking away puts it back, the way the sport chooser does.
    c.js("document.getElementById('tourTitle').click()")
    time.sleep(0.4)
    c.js("""document.body.dispatchEvent(new PointerEvent('pointerdown',
      {bubbles:true, clientX:700, clientY:500}))""")
    time.sleep(0.4)
    ok("clicking away closes it",
       bool(c.js("document.getElementById('tourList').hidden")))

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
