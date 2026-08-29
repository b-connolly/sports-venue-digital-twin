"""Does the placard card say what the reader actually read?

The alumni statues carry engraved placards. They were photographed with a phone,
an optical character recognition model was run over the images, and the readings
were attached to boxes in a 3D object layer standing where the placards stand.
The staged view opens a card for one of them.

The thing worth checking is not that a card appears. It is that the card is
honest, because this is the one place in the app showing a machine's reading of
something and the whole exercise is admitting what it got wrong:

  * the fields shown come from the layer's own popup configuration, not from a
    list written in the app - so what the scene's author chose is what appears,
    and a change made in the web scene reaches the card without a code change
  * a line the reader could not make out shows ILLEGIBLE, marked as such, rather
    than being hidden or quietly guessed
  * the confidence the reader assigned itself is on screen next to the name it
    assigned

Steve Atwater is the record it opens on and a good one to assert against: read
at HIGH confidence, with two of its lines - the jersey number and the induction
year - unreadable. Both halves in one card.

Run tools/serve.py first, then: python tools/placardcheck.py
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from smoke import chrome  # noqa: E402

URL = os.environ.get("APP_URL", "http://localhost:8777/")
WANT_ID = "20130219_t06"
fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


CARD = """(function(){
  var rows = [].map.call(
    document.querySelectorAll('#placardRows .pcard__row'), function(r){
      var dd = r.querySelector('dd');
      return { label: r.querySelector('dt').textContent.trim(),
               value: dd.textContent.trim(),
               illegible: dd.classList.contains('illegible') };});
  var card = document.getElementById('placardCard');
  return JSON.stringify({
    open: !card.hidden,
    inSide: !!card.closest('#side'),
    name: document.getElementById('placardName').textContent.trim(),
    conf: document.getElementById('placardConf').textContent.trim(),
    confClass: document.getElementById('placardConf').className,
    note: document.getElementById('placardNote').textContent.trim(),
    rows: rows });})()"""


def ev(c, expr, wait=False):
    r = c.send("Runtime.evaluate", expression=expr, returnByValue=True,
               awaitPromise=wait)
    if "exceptionDetails" in r:
        d = r["exceptionDetails"]
        x = d.get("exception") or {}
        return "EXC: " + str(x.get("description") or d.get("text"))[:300]
    return r.get("result", {}).get("value")


proc, c = chrome()
try:
    c.send("Page.enable")
    c.send("Runtime.enable")
    c.send("Page.navigate", url=URL)
    for _ in range(400):
        if c.js("typeof window.__view === 'object'"):
            break
        time.sleep(0.5)
    for _ in range(300):
        if not c.js("document.getElementById('enter').disabled"):
            break
        time.sleep(0.5)
    c.js("document.getElementById('enter').click()")
    time.sleep(8)

    # The staged view, found by name rather than by number so renaming a slide
    # cannot silently point this at a different one.
    titles = json.loads(c.js("""JSON.stringify([].map.call(
      document.getElementById('tourList').children,
      function(b){ return b.textContent; }))"""))
    at = next((i for i, t in enumerate(titles)
               if "Optical Character" in t), None)
    ok("the scene still has the text-extraction view", at is not None,
       str(titles[-3:]))
    if at is None:
        raise SystemExit(1)
    c.js("document.getElementById('tourList').children[%d].click()" % at)

    # The read is retried by the app - a layer view can only answer for what it
    # has drawn - so this waits the same way a viewer would.
    s = None
    for _ in range(24):
        time.sleep(2)
        s = json.loads(c.js(CARD))
        if s["open"] and s["rows"]:
            break
    ok("arriving at the view opens a card", s["open"] is True)
    ok("in the right-hand column, with the analytics card", s["inSide"] is True)
    ok("it read the placard it was asked for",
       s["name"] == "STEVE ATWATER", s["name"])
    ok("and shows the confidence the reader gave itself",
       s["conf"] == "HIGH", s["conf"])
    ok("graded, so HIGH and ILLEGIBLE do not look alike",
       "conf-high" in s["confClass"], s["confClass"])

    # --- the fields are the scene's choice, not the app's --------------------
    want = ev(c, """(function(){
      var l = window.__view.map.allLayers.find(function(x){
        return x.type === 'scene' && /Optical Character/i.test(x.title || '');});
      var t = l && l.popupTemplate;
      var el = t && t.content && t.content.filter
        ? t.content.filter(function(e){ return e.type === 'fields'; })[0] : null;
      var infos = (el && el.fieldInfos && el.fieldInfos.length)
        ? el.fieldInfos
        : (t ? t.fieldInfos.filter(function(f){ return f.visible; }) : []);
      return JSON.stringify(infos.filter(function(f){ return f.visible !== false; })
        .map(function(f){ return f.fieldName; }));})()""")
    cfg = [f for f in json.loads(want) if f not in ("NAME", "CONFIDENCE")]
    shown = [r["label"].upper().replace(" ", "_") for r in s["rows"]]
    ok("the layer's popup configuration is what drives the card",
       shown == cfg, "card %s vs scene %s" % (shown, cfg))

    # --- and it admits what it could not read --------------------------------
    bad = [r for r in s["rows"] if r["value"].upper() == "ILLEGIBLE"]
    ok("the lines it could not read say so", len(bad) >= 2,
       str([r["label"] for r in bad]))
    ok("and they are marked rather than left to look like readings",
       bool(bad) and all(r["illegible"] for r in bad),
       str([(r["label"], r["illegible"]) for r in bad]))
    ok("nothing was quietly guessed in their place",
       all(r["value"] for r in s["rows"]))

    # Normalised the same way `shown` is: the card's labels are prose ("Years
    # played"), the layer's field names are not.
    good = {r["label"].upper().replace(" ", "_"): r["value"] for r in s["rows"]}
    ok("the readable fields carry the real values",
       good.get("SCHOOL") == "ARKANSAS" and good.get("POSITION") == "SAFETY"
       and good.get("YEARS_PLAYED") == "1989-1998",
       str({k: good.get(k) for k in ("SCHOOL", "POSITION", "YEARS_PLAYED")}))

    note = s["note"].lower()
    ok("the card says the text was read by a machine",
       "optical character recognition" in note, s["note"][:70])
    ok("and how many photos it had to read from",
       "photos" in note and any(ch.isdigit() for ch in note), s["note"][:90])
    ok("and that ILLEGIBLE means unread, not absent",
       "rather than a guess" in note, s["note"][-60:])

    # --- it belongs to the view that opened it -------------------------------
    c.js("document.getElementById('next').click()")
    time.sleep(7)
    ok("moving on puts it away",
       json.loads(c.js(CARD))["open"] is False)

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
