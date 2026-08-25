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
page under test is whatever URL is given.

Two things worth knowing before adding a check of your own:

  * A gridiron play file has no `meta.title` - only the football ones carry one.
    Identify a play by the chooser's active button, or by its frame count.

  * The Draw Play checkbox is remembered across plays on purpose, so "starts
    unchecked" is only true of the first play of a session. Set it with
    `chalk(True)`, which reads the state first, rather than clicking blind.
"""
import json, os, subprocess, sys, time, urllib.request

import websocket

URL = (sys.argv[1] if len(sys.argv) > 1
       else os.environ.get("APP_URL", "http://localhost:8777/"))
PORT = int(os.environ.get("CDP_PORT", "10541"))

# Opened with the replay already up, so the run does not depend on driving the
# tour to the right view first.
DEEP_LINK = "?live"

GRIDIRON = [("Deep pass", True), ("Run right", True), ("Record field goal", False)]
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


def chrome():
    exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    if not os.path.exists(exe):
        exe = os.path.expandvars(
            r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe")
    if not os.path.exists(exe):
        raise SystemExit("Chrome not found - set the path in chrome()")
    # A fresh profile each run, or a warm cache decides what the test measures.
    prof = os.path.join(os.environ.get("TEMP", "."), "smoke-%d" % int(time.time()))
    proc = subprocess.Popen(
        [exe, "--headless=new", "--remote-debugging-port=%d" % PORT,
         "--user-data-dir=" + prof, "--no-first-run", "--no-default-browser-check",
         # The app is served from somewhere other than the debugger's origin, and
         # swiftshader stands in for a GPU that headless does not get.
         "--remote-allow-origins=*", "--window-size=1400,900",
         "--enable-unsafe-swiftshader", "about:blank"],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(60):
        try:
            d = json.loads(urllib.request.urlopen(
                "http://127.0.0.1:%d/json/list" % PORT, timeout=2).read())
            tgt = next((t for t in d if t["type"] == "page"), None)
            if tgt:
                return proc, CDP(websocket.create_connection(
                    tgt["webSocketDebuggerUrl"], timeout=60))
        except Exception:
            pass
        time.sleep(0.5)
    proc.terminate()
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
        return json.loads(c.js(PROBE))

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

        ok("app loaded", bool(c.js("!!window.__play")))
        ok("slides bound", c.js(IDX) not in ("01 / 01", "?", ""), c.js(IDX))

        first = True
        print("")
        print("-- American Football --")
        for label, drawable in GRIDIRON:
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
            ok("%-18s draws" % label, st["a"] > 0 and st["b"] > 0,
               "white=%d orange=%d" % (st["a"], st["b"]))
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
