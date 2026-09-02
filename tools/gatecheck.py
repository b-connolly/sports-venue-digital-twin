"""Does the gate actually hold Explore shut, and let the right people through?

The app asks for an @esri.com address and a shared access code before it will
open. This is the one check that does *not* take smoke.chrome()'s bypass - the
rest of the suite seeds the credential into localStorage so it can get on with
testing the scene, and a bypass that is always on is a bypass that hides the
thing it bypasses.

What is worth asserting, in order of how badly it would go unnoticed:

  * Explore stays shut on a fully loaded scene. The failure to fear is not
    "the gate is missing" but "the gate is there and the button opens anyway
    once the warm-up finishes", because the two unlock paths are separate and
    only one of them was ever about the viewer.
  * The loading message still tells the truth. It used to read the button's own
    disabled state, which now stays true for a reason that has nothing to do
    with loading - so a signed-out viewer would have sat in front of a finished
    scene being told it was still loading.
  * A wrong domain and a wrong code are both refused, and refused distinctly.
  * The right pair opens it, and is remembered across a reload.

Not covered, and deliberately: that the gate cannot be circumvented. It can -
everything it does runs in the visitor's browser out of a file they already
have. It is a doormat, not a lock, and a test claiming otherwise would be the
most misleading thing in this folder.

Run tools/serve.py first, then: python tools/gatecheck.py
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
GOOD_MAIL = "someone@esri.com"
GOOD_CODE = "esrirocks"
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


def ev(c, expr):
    r = c.send("Runtime.evaluate", expression=expr, returnByValue=True)
    if "exceptionDetails" in r:
        d = r["exceptionDetails"]
        x = d.get("exception") or {}
        return "EXC: " + str(x.get("description") or d.get("text"))[:200]
    return r.get("result", {}).get("value")


def submit(c, email, code):
    c.js("""(function(){
      document.getElementById('gateEmail').value = %r;
      document.getElementById('gatePass').value = %r;
      document.getElementById('gate').dispatchEvent(
        new Event('submit', {cancelable:true, bubbles:true}));})()"""
         % (email, code))
    time.sleep(1.2)


# The gate left standing: this is the one check that means to meet it.
proc, c = chrome(signin=False)
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("typeof window.__view === 'object'"):
            break
        time.sleep(0.5)

    # Wait for the app's own readiness, which is the whole point: an Explore
    # button that is shut because nothing has loaded proves nothing.
    #
    # `__door.ready`, not `view.ready`. The latter is true within seconds of
    # the view existing, long before the first view has been warmed, so a
    # check resting on it asserts against a scene that is still arriving and
    # reads the resulting "Loading" as a bug.
    ready = False
    for _ in range(150):
        time.sleep(1)
        if c.js("!!(window.__door && window.__door.ready)"):
            ready = True
            break
    ok("the scene got ready, so the gate is what is holding it", ready)

    ok("the form is on the curtain",
       c.js("!!document.getElementById('gate') && "
            "!document.getElementById('gate').classList.contains('gone')"))
    ok("and Explore is shut behind it",
       c.js("document.getElementById('enter').disabled") is True)
    # The message used to be driven off the button's own disabled state, which
    # now stays true for a reason that has nothing to do with loading - so a
    # signed-out viewer sat in front of a finished scene being told to wait.
    # Given a moment to catch up, since the warm-up writes it per view.
    for _ in range(20):
        time.sleep(1)
        if "loading" not in (c.js(
                "document.getElementById('loadmsg').textContent") or "").lower():
            break
    ok("the message does not claim it is still loading",
       "loading" not in (c.js("document.getElementById('loadmsg').textContent")
                         or "").lower(),
       c.js("document.getElementById('loadmsg').textContent"))

    # --- the two ways to be turned away, told apart ---------------------------
    submit(c, "someone@gmail.com", GOOD_CODE)
    msg = c.js("document.getElementById('gateMsg').textContent")
    ok("another domain is refused",
       c.js("document.getElementById('enter').disabled") is True)
    ok("and told which half was wrong", "esri.com" in (msg or "").lower(), msg)
    ok("with the email marked, not the code",
       c.js("document.getElementById('gateEmail').classList.contains('bad')")
       is True)

    submit(c, GOOD_MAIL, "notthecode")
    msg = c.js("document.getElementById('gateMsg').textContent")
    ok("a wrong code is refused",
       c.js("document.getElementById('enter').disabled") is True)
    ok("and says so distinctly", "code" in (msg or "").lower(), msg)
    ok("with the code marked, not the email",
       c.js("document.getElementById('gatePass').classList.contains('bad')")
       is True)

    # Typing again clears the complaint rather than leaving it standing.
    c.js("""(function(){var f=document.getElementById('gatePass');
      f.value='x'; f.dispatchEvent(new Event('input',{bubbles:true}));})()""")
    time.sleep(0.4)
    ok("starting to fix it clears the complaint",
       (c.js("document.getElementById('gateMsg').textContent") or "") == "")

    # --- and the pair that works ---------------------------------------------
    submit(c, GOOD_MAIL, GOOD_CODE)
    ok("the right address and code open Explore",
       c.js("document.getElementById('enter').disabled") is False)
    ok("and the form gets out of the way",
       c.js("document.getElementById('gate').classList.contains('gone')")
       is True)
    ok("the button is offered, not merely enabled",
       c.js("document.getElementById('enter').classList.contains('ready')")
       is True)

    # --- remembered, so a reload mid-demo does not ask again ------------------
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("typeof window.__view === 'object'"):
            break
        time.sleep(0.5)
    time.sleep(2)
    ok("a reload does not ask again",
       c.js("document.getElementById('gate').classList.contains('gone')")
       is True)
    for _ in range(120):
        time.sleep(1)
        if c.js("document.getElementById('enter').disabled") is False:
            break
    ok("and Explore opens on its own once the scene is back",
       c.js("document.getElementById('enter').disabled") is False)

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
