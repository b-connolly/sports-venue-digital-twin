"""Drive the app in a real browser and check the replays still work.

The app's failures are visual and timed - a diagram that draws nothing, a
control that never appears, a play that loads but has no frames - and none of
them show up in a static check or a linter. So this opens the real thing in
headless Chrome, clicks through all six passages, and asserts what should be on
screen. It is the check to run before a deploy and again after one.

    propy smoke.py                                   # a local server
    propy smoke.py https://b-connolly.github.io/sports-venue-digital-twin/
    propy smoke.py https://esri-imagery-apps.s3.amazonaws.com/apps/digital-twin/sports-venue/index.html

Exits non-zero if anything failed, so it can gate a deploy.

Needs `websocket-client` and Chrome. Nothing is installed into the app: the
browser is driven over the DevTools protocol, in a throwaway profile, and the
page under test is whatever URL is given. The profile is thrown away for
real - it is registered with `atexit` in `chrome()` - because it holds 150-200
MB and a run happens every few minutes.

Two things worth knowing before adding a check of your own:

  * A gridiron play file has no `meta.title` - only the football ones carry one.
    Identify a play by the chooser's active button, or by its frame count.

  * The Draw Play checkbox is remembered across plays on purpose, so "starts
    unchecked" is only true of the first play of a session. Set it with
    `chalk(True)`, which reads the state first, rather than clicking blind.
"""
import atexit, json, os, shutil, subprocess, sys, tempfile, time, urllib.request

import websocket

URL = (sys.argv[1] if len(sys.argv) > 1
       else os.environ.get("APP_URL", "http://localhost:8777/"))
PORT = int(os.environ.get("CDP_PORT", "10541"))

# Opened with the replay already up, so the run does not depend on driving the
# tour to the right view first.
DEEP_LINK = "?live"

# label, offers Draw Play, how many line graphics the diagram has.
# The field goal draws one line rather than two: it has no routes, and what it
# draws instead is the ball's flight, which is a single arc.
GRIDIRON = [("Deep pass", True, 2), ("Run right", True, 2),
            ("Record field goal", True, 1)]
FOOTBALL = ["Turnover to goal", "Cross and header", "Intercept and break"]


class CDP:
    """Enough of the DevTools protocol to click things and read the page back."""

    def __init__(self, ws):
        self.ws, self.id, self.errs = ws, 0, []

    def _note(self, m):
        if (m.get("method") == "Runtime.consoleAPICalled"
                and m["params"]["type"] == "error"):
            t = " ".join(str(a.get("value", a.get("description", "")))
                         for a in m["params"].get("args", []))[:140]
            # Calcite complains about its own asset paths in this setup, and the
            # scene layers log a benign "already loading" while tiles overlap.
            if "calcite" not in t and "already loading" not in t:
                self.errs.append(t)
        if m.get("method") == "Runtime.exceptionThrown":
            self.errs.append("EXC " + str(m["params"]["exceptionDetails"])[:200])

    def send(self, method, **params):
        self.id += 1
        self.ws.settimeout(60)
        self.ws.send(json.dumps({"id": self.id, "method": method, "params": params}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.id:
                return r.get("result", {})
            self._note(r)

    def js(self, expr):
        return (self.send("Runtime.evaluate", expression=expr, returnByValue=True)
                .get("result", {}).get("value"))


def chrome(signin=True):
    """A headless browser, already past the gate unless asked otherwise.

    Explore waits on two things now - the scene being ready and somebody having
    signed in - and every check here drives it by waiting for the button to
    come alive. Rather than teach a dozen files to fill a form, the credential
    is seeded into sessionStorage before any page script runs, which is the
    same state a viewer who signed in earlier this session arrives in.

    `signin=False` leaves the gate standing, which is what gatecheck.py wants:
    a bypass that is always on is a bypass that hides the thing it bypasses.
    """
    exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not os.path.exists(exe):
        exe = os.path.expandvars(
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
    if not os.path.exists(exe):
        raise SystemExit("Chrome not found - set the path in chrome()")
    # A fresh profile each run, or a warm cache decides what the test measures
    # - and taken away again afterwards, which it was not for a long time.
    #
    # Chrome puts 150-200 MB into one of these. Ninety-eight of them had
    # accumulated in TEMP before anybody looked: 17 GB, from a checks folder
    # that describes itself as installing nothing.
    #
    # `mkdtemp` rather than the timestamp this used, which two runs starting
    # inside the same second would share - and the suite runs them back to
    # back. `atexit` rather than a `finally` in each caller, because otherwise
    # all fourteen scripts have to remember, and the one that forgets is the
    # one that leaks.
    prof = tempfile.mkdtemp(prefix="smoke-")

    def sweep():
        # The browser has to be gone first or the profile is still locked;
        # callers terminate it, and this is the backstop for the ones that
        # raised on the way. Failure here is not worth a traceback over.
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            pass
        shutil.rmtree(prof, ignore_errors=True)
    proc = subprocess.Popen(
        [exe, "--headless=new", "--remote-debugging-port=%d" % PORT,
         "--user-data-dir=" + prof, "--no-first-run", "--no-default-browser-check",
         # The app is served from somewhere other than the debugger's origin, and
         # swiftshader stands in for a GPU that headless does not get.
         "--remote-allow-origins=*", "--window-size=1400,900",
         "--enable-unsafe-swiftshader", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    atexit.register(sweep)
    for _ in range(60):
        try:
            d = json.loads(urllib.request.urlopen(
                "http://127.0.0.1:%d/json/list" % PORT, timeout=2).read())
            tgt = next((t for t in d if t["type"] == "page"), None)
            if tgt:
                c = CDP(websocket.create_connection(
                    tgt["webSocketDebuggerUrl"], timeout=60))
                if signin:
                    # Runs before the page's own scripts on every navigation,
                    # so the app finds the credential already there. about:blank
                    # has no usable storage, hence the try.
                    c.send("Page.enable")
                    c.send("Page.addScriptToEvaluateOnNewDocument", source=(
                        "try{sessionStorage.setItem("
                        "'venue.gate','checks@example.com');}catch(e){}"))
                return proc, c
        except Exception:
            pass
        time.sleep(0.5)
    sweep()
    raise SystemExit("Chrome never offered a page to drive")


PICK_JS = """(function(){var h=null;document.querySelectorAll('#playPicks button').forEach(
  function(b){ if((b.querySelector('.playseg__label')||{}).textContent===%s) h=b;});
  if(h) h.click();})()"""

PROBE = """(function(){
  var p=window.__play; if(!p) return JSON.stringify({none:true});
  var g=p.chalk.layer.graphics;
  var sum=function(gr){ if(!gr||!gr.geometry) return 0;
    return gr.geometry.paths.reduce(function(a,b){return a+b.length;},0); };
  var act=document.querySelector('#playPicks button.on')
       || document.querySelector('#playPicks button.active');
  return JSON.stringify({
    shown:(act&&act.querySelector('.playseg__label'))
          ? act.querySelector('.playseg__label').textContent : null,
    sport:p.data.meta.sport, frames:p.data.meta.frames,
    hidden:document.getElementById('playChalk').hidden,
    on:p.chalkOn, vis:p.chalk.layer.visible,
    dur:+p.duration.toFixed(1),
    a:sum(g.getItemAt(0)), b:sum(g.getItemAt(1))});})()"""

IDX = ("(function(){var t=document.getElementById('tourIdx');"
       "return t?t.textContent.trim():'?';})()")


def main():
    proc, c = chrome()
    fails = []

    def ok(name, cond, detail=""):
        print(("  PASS  " if cond else "  FAIL  ") + name
              + ("  " + str(detail) if detail else ""))
        if not cond:
            fails.append(name)

    def probe():
        """The app's state, or empty zeroes if there is no app to ask.

        PROBE answers {none:true} when window.__play is missing, and every
        caller here indexes the answer. Reading a key that is not there raises,
        and a test that dies on a KeyError says nothing about what went wrong -
        it looks identical whether the diagram failed, the page was blank, or
        Chrome went away mid-run. All three have happened. Filling in zeroes
        turns each of them into a plain FAIL with the numbers next to it.
        """
        st = json.loads(c.js(PROBE) or '{"none":true}')
        if st.get("none"):
            return {"none": True, "shown": None, "sport": None, "frames": 0,
                    "hidden": None, "on": None, "vis": None, "dur": 0,
                    "a": 0, "b": 0}
        return st

    def wait_play(limit=45):
        for _ in range(limit):
            if c.js("!!window.__play"):
                time.sleep(1.5)
                return True
            time.sleep(0.6)
        return False

    def pick(label):
        c.js(PICK_JS % json.dumps(label))
        for _ in range(30):
            time.sleep(0.6)
            if probe().get("frames"):
                return

    def chalk(on):
        for _ in range(3):
            if bool(probe().get("on")) == on:
                return
            c.js("document.getElementById('playChalk').click()")
            time.sleep(1.0)

    try:
        print("testing %s" % URL)
        for target in (URL, URL + DEEP_LINK):
            c.send("Page.enable")
            c.send("Runtime.enable")
            c.send("Page.navigate", url=target)
            wait_play(120)
        time.sleep(9)

        loaded = bool(c.js("!!window.__play"))
        ok("app loaded", loaded)
        if not loaded:
            # Everything after this reads window.__play, so there is nothing to
            # learn from running it - and plenty to lose, because the first
            # thing it does is index a probe that has no keys, and a traceback
            # says far less than the two lines below.
            #
            # The usual cause is not the app at all. A bucket prefix served
            # over the S3 REST endpoint has no directory index, and if a
            # zero-byte placeholder object sits at that key it is served as an
            # empty file: HTTP 200, no body, no error anywhere. The page is
            # blank and everything looks fine from the outside.
            body = c.js("document.body ? document.body.innerHTML.length : -1")
            title = c.js("document.title || ''")
            print("")
            print("  the page never started the app.")
            print("  body is %s bytes, title is %r" % (body, title))
            if not body or int(body) < 200:
                print("  that is an empty page - check the URL resolves to a")
                print("  file. A prefix ending in / needs index.html on it.")
            fails.append("app never loaded")
            return 1

        ok("slides bound", c.js(IDX) not in ("01 / 01", "?", ""), c.js(IDX))

        first = True
        print("")
        print("-- American Football --")
        for label, drawable, lines in GRIDIRON:
            pick(label)
            st = probe()
            ok("%-18s loads" % label, st.get("frames", 0) > 0,
               "%s frames" % st.get("frames"))
            ok("%-18s toggle %s" % (label, "offered" if drawable else "hidden"),
               st["hidden"] != drawable)
            if first:
                ok("%-18s starts unchecked" % label,
                   st["on"] is False and st["vis"] is False)
                first = False
            if not drawable:
                continue
            chalk(True)
            c.js("(function(){var p=window.__play;p.pause();p.seek(p.duration*0.62);})()")
            time.sleep(2)
            st = probe()
            ok("%-18s draws" % label,
               st["a"] > 0 and (lines < 2 or st["b"] > 0),
               "first=%d second=%d" % (st["a"], st["b"]))
            chalk(False)
            ok("%-18s unchecks" % label, probe()["vis"] is False)

        print("")
        print("-- Football --")
        c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true}));")
        ok("G shortcut switches sport",
           wait_play() and probe()["sport"] == "football", probe().get("shown"))
        for label in FOOTBALL:
            pick(label)
            st = probe()
            ok("%-20s loads" % label, st.get("frames", 0) > 0,
               "%s frames" % st.get("frames"))
            ok("%-20s toggle offered" % label, st["hidden"] is False)
            chalk(True)
            # A frame short of the ball crossing the line: both the delivery and
            # the finish are drawn, and neither has been cut off yet.
            c.js("(function(){var p=window.__play,a=p.data.meta.assist;"
                 "p.pause();p.seek((a.scored-1)/p.data.meta.hz);})()")
            time.sleep(2)
            st = probe()
            ok("%-20s draws the goal" % label, st["a"] > 0 and st["b"] > 0,
               "delivery=%d finish=%d" % (st["a"], st["b"]))
            c.js("(function(){window.__play.seek(0);})()")
            time.sleep(1.5)
            st = probe()
            ok("%-20s clear before it" % label, st["a"] == 0 and st["b"] == 0)

        print("")
        print("-- back to American Football --")
        chalk(False)
        c.js("window.dispatchEvent(new KeyboardEvent('keydown',{key:'a',bubbles:true}));")
        ok("A shortcut switches back",
           wait_play() and probe()["sport"] == "gridiron", probe().get("sport"))

        print("")
        print("console errors: %s" % (c.errs or "none"))
        if c.errs:
            fails.append("console errors")
    finally:
        proc.terminate()
        print("")
        print("%s  (%d failed)" % ("SMOKE TEST PASSED" if not fails
                                   else "SMOKE TEST FAILED", len(fails)))
        for f in fails:
            print("   - %s" % f)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
