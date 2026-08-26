"""Check the seating bearings against the club's own zone names.

js/seats.js gets its bearings from the published seating chart. This checks
them against a completely different source: the configuration behind the
Broncos' official 3D seat viewer, which names the zone every section is sold
as - end zone, sideline, corner, which club, which end.

That source says nothing about angles, so agreeing with it is evidence rather
than a restatement. If the bowl were rotated - which it twice was - sections
sold as "North End Zone" would not come out facing north.

No browser and no server needed; this reads js/seats.js directly.

    python tools/zonecheck.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SEATS = os.path.join(HERE, os.pardir, "js", "seats.js")
ZONES = os.path.join(HERE, "section_zones.json")

fails = []


def ok(name, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + name
          + ("  " + str(detail) if detail else ""))
    if not cond:
        fails.append(name)


def bearings():
    """The at[] tables out of seats.js, without running a browser."""
    src = open(SEATS, encoding="utf-8").read()
    out = {}
    for m in re.finditer(
            r'name:\s*"(\d+)",\s*first:\s*(\d+)(?:[^}]*?)at:\s*\[([^\]]*)\]',
            src, re.S):
        first = int(m.group(2))
        vals = [float(v) for v in re.findall(r"-?\d+\.?\d*", m.group(3))]
        for i, v in enumerate(vals):
            out[first + i] = v % 360
    return out


def off(a, b):
    return abs(((a - b + 180) % 360) - 180)


at = bearings()
zones = json.load(open(ZONES, encoding="utf-8"))["zones"]
zones = {int(k): v for k, v in zones.items()}

print("read %d bearings from js/seats.js" % len(at))
print("read %d sections from the club's own viewer" % len(zones))
print()

ok("the two sources list the same sections",
   set(at) == set(zones),
   "ours only %s, theirs only %s"
   % (sorted(set(at) - set(zones)), sorted(set(zones) - set(at))))

# The two premium field-level sections are the ones on the halfway line, one on
# each touchline. Nothing in our model was fitted to this.
prime = sorted(s for s, z in zones.items() if any("Prime" in x for x in z)
               and any("Between Goal Lines" not in x for x in z)
               and s < 200 and len(z) == 2 and all("Prime" in x for x in z))
ok("exactly two sections are sold as field-level prime", len(prime) == 2, prime)
if len(prime) == 2:
    a, b = (at[prime[0]], at[prime[1]])
    ok("and they sit on the halfway line, facing each other",
       min(off(a, 90), off(a, 270)) < 3 and min(off(b, 90), off(b, 270)) < 3
       and off(a, b) > 174,
       "%d at %.1f, %d at %.1f" % (prime[0], a, prime[1], b))

# A section sold as an end zone should face an end, and one sold as a sideline
# should face a touchline.
def side(b):
    d = min(off(b, 0), off(b, 180))
    return "end" if d < 30 else ("sideline" if d > 60 else "corner")


for zname, want in [("Field Level - End Zone", "end"),
                    ("Plaza Level End Zone", "end"),
                    ("Upper Level - Sideline", "sideline"),
                    ("Field Level - Corner End Zone", "corner")]:
    secs = sorted(s for s, z in zones.items() if zname in z)
    got = [side(at[s]) for s in secs]
    ok("%s (%d sections) all face the %s" % (zname, len(secs), want),
       secs and all(g == want for g in got),
       "%d of %d" % (sum(1 for g in got if g == want), len(secs)))

# The ones that name a compass direction are the strongest check of all: they
# pin the model's north to the real north.
for zname, which, lo, hi in [("300 Level North End Zone", "north", -60, 60),
                             ("Upper Level - North End Zone", "north", -60, 60),
                             ("United Club West", "west", 190, 320),
                             ("United Club East", "east", 40, 170)]:
    secs = sorted(s for s, z in zones.items() if zname in z)
    inside = [s for s in secs
              if (lo <= (at[s] if at[s] <= 180 else at[s] - 360) <= hi
                  if lo < 0 else lo <= at[s] <= hi)]
    ok("%s (%d sections) really is %s" % (zname, len(secs), which),
       len(inside) == len(secs),
       "%d of %d in range" % (len(inside), len(secs)))

print()
print("%s  (%d failed)" % ("PASSED" if not fails else "FAILED", len(fails)))
for f in fails:
    print("   - %s" % f)
sys.exit(1 if fails else 0)
