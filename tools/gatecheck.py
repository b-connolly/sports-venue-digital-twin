"""Does the gate actually hold Explore shut, and let the right people through?

The app asks for a username - any email address - and the shared password
on arrival, and holds Explore shut until it gets them. The scene loads
behind the box, so the two waits overlap instead of queueing. This is the one check that does *not* take smoke.chrome()'s bypass - the
rest of the suite seeds the credential into localStorage so it can get on with
testing the scene, and a bypass that is always on is a bypass that hides the
thing it bypasses.

What is worth asserting, in order of how badly it would go unnoticed:

  * It is asked before the scene is ready, not after. The point of the
    order is that the login and the loading run at the same time, so the
    thing to catch is a regression to asking once everything is warm -
    which still works, and wastes the twenty seconds it was meant to use.
  * Explore waits on both. It opens when the scene is ready AND the login
    is answered, in whichever order those land.
  * The loading message still tells the truth. It used to read the button's own
    disabled state, which now stays true for a reason that has nothing to do
    with loading - so a signed-out viewer would have sat in front of a finished
    scene being told it was still loading.
  * A username that is not an address and a wrong password are refused, and
    refused distinctly, so it is clear which half to fix.
  * Any domain with the right password gets in - the password is the rule -
    and the answer is remembered across a reload.

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
# Deliberately not an esri.com address: the gate is the
# password, and the domain must not quietly start mattering.
GOOD_MAIL = "someone@gmail.com"
GOOD_PASS = "esrirocks"
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

    # --- asked on arrival, before anything is ready --------------------------
    up = None
    for _ in range(80):
        time.sleep(0.25)
        if c.js("!!document.getElementById('signin') && "
                "!document.getElementById('signin').hidden"):
            up = True
            break
    ok("the login is asked for on arrival", up is True)
    ok("before the scene is anywhere near ready",
       c.js("!!(window.__door && window.__door.ready)") is False)
    ok("and Explore is shut meanwhile",
       c.js("document.getElementById('enter').disabled") is True)

    # --- what is refused -----------------------------------------------------
    submit(c, "not-an-address", GOOD_PASS)
    msg = c.js("document.getElementById('gateMsg').textContent")
    ok("something that is not an address is refused",
       c.js("document.getElementById('signin').hidden") is False)
    ok("with the username marked, not the password",
       c.js("document.getElementById('gateEmail').classList.contains('bad')")
       is True, msg)

    submit(c, GOOD_MAIL, "wrongpassword")
    msg = c.js("document.getElementById('gateMsg').textContent")
    ok("a wrong password is refused",
       c.js("document.getElementById('signin').hidden") is False)
    ok("and says password rather than username",
       "password" in (msg or "").lower(), msg)
    ok("with the password marked, not the username",
       c.js("document.getElementById('gatePass').classList.contains('bad')")
       is True)

    c.js("""(function(){var f=document.getElementById('gatePass');
      f.value='x'; f.dispatchEvent(new Event('input',{bubbles:true}));})()""")
    time.sleep(0.4)
    ok("starting to fix it clears the complaint",
       (c.js("document.getElementById('gateMsg').textContent") or "") == "")

    # --- the password is the gate, not the domain ----------------------------
    # GOOD_MAIL is deliberately not an esri.com address. The rule is the
    # password, and a check that only ever tried one domain would not notice
    # if the domain quietly started mattering again.
    submit(c, GOOD_MAIL, GOOD_PASS)
    time.sleep(1)
    ok("any address with the right password is accepted",
       c.js("document.getElementById('signin').hidden") is True, GOOD_MAIL)
    ok("the curtain stays up - signing in is not entering",
       c.js("document.getElementById('intro').classList.contains('gone')")
       is False)

    # --- the loading carried on behind it ------------------------------------
    # The whole point of the order. If the bar has not moved by here, the
    # login was blocking the load rather than overlapping it.
    width = c.js("document.getElementById('loadfill').style.width") or "0%"
    moved = float(width.replace("%", "") or 0)
    ok("the scene was loading behind the box", moved > 5, width)

    # --- and Explore opens on its own once the scene is ready ----------------
    for _ in range(150):
        time.sleep(1)
        if c.js("document.getElementById('enter').disabled") is False:
            break
    ok("Explore opens once the scene is ready",
       c.js("document.getElementById('enter').disabled") is False)
    ok("offered, not merely enabled",
       c.js("document.getElementById('enter').classList.contains('ready')")
       is True)

    c.js("document.getElementById('enter').click()")
    time.sleep(2)
    ok("and the click goes straight in, with nothing else asked",
       c.js("document.getElementById('intro').classList.contains('gone')")
       is True)

    # --- remembered, so a reload mid-demo does not ask again -----------------
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("typeof window.__view === 'object'"):
            break
        time.sleep(0.5)
    time.sleep(2)
    ok("a reload does not ask again",
       c.js("document.getElementById('signin').hidden") is True)
    for _ in range(150):
        time.sleep(1)
        if c.js("document.getElementById('enter').disabled") is False:
            break
    ok("and Explore comes back on the scene alone",
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
