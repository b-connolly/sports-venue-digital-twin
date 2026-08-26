"""Read the section bearings straight off the seating chart.

The chart is a plan with a compass on it, drawn to scale: the field measures
300 x 132 px against a real 109.7 x 48.8 m, so a pixel is 0.366 m either way.
North is to the left, south to the right, east up, west down.

Every section is a solid blue block separated from its neighbours by white
gaps, so a connected-component pass finds all 135 without any OCR. Numbers are
then assigned by walking each ring in order from a single anchor read off the
picture by eye - one bearing to get right instead of 135.

Decks separate by radius once the radius is normalised for the bowl being an
ellipse rather than a circle. At an aspect of 1.47 the sorted radii break
cleanly after 36 blocks and again after 92, which is the lower bowl, then the
300s and the 200 club sharing a band, then the 500s.
"""
import json
import os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
CHART = os.path.join(HERE, "seating_chart.png")

ASPECT = 1.47
FIELD_M = 109.7                      # goal line to goal line, end zones in

a = np.array(Image.open(CHART).convert("RGB")).astype(int)

g = ((abs(a[:, :, 0] - 26) < 40) & (abs(a[:, :, 1] - 143) < 40)
     & (abs(a[:, :, 2] - 65) < 40))
ys, xs = np.nonzero(g)
CX, CY = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2
SCALE = (xs.max() - xs.min()) / FIELD_M

blue = ((abs(a[:, :, 0] - 2) < 45) & (abs(a[:, :, 1] - 108) < 45)
        & (abs(a[:, :, 2] - 223) < 45))
lab, n = ndimage.label(blue)
sizes = ndimage.sum(blue, lab, range(1, n + 1))
keep = [i + 1 for i in range(n) if sizes[i] > 300]
assert len(keep) == 135, "expected 135 sections, segmented %d" % len(keep)

blocks = []
for cy, cx in ndimage.center_of_mass(blue, lab, keep):
    th = np.arctan2(-(cy - CY), -(cx - CX))
    r = np.hypot(cx - CX, cy - CY) / SCALE
    blocks.append({
        "b": float(np.degrees(th) % 360), "r": float(r),
        "u": float(r * np.hypot(np.cos(th) / ASPECT, np.sin(th)))})

blocks.sort(key=lambda d: d["u"])
bowl, middle, top = blocks[:36], blocks[36:92], blocks[92:]

# The 200 club is the nine blocks of the middle band sitting over the south.
middle.sort(key=lambda d: d["b"])
mid_s = min(range(len(middle)), key=lambda i: abs(middle[i]["b"] - 180))
club = middle[mid_s - 4:mid_s + 5]
threes = [d for d in middle if d not in club]

out = {}

# Closed ring: roll it so 114 lands on the north, where the chart puts it.
bowl.sort(key=lambda d: d["b"])
at = min(range(36), key=lambda i: abs(((bowl[i]["b"] + 180) % 360) - 180))
bowl = bowl[at - 14:] + bowl[:at - 14]
for i, d in enumerate(bowl):
    out[100 + i] = d

for i, d in enumerate(club):
    out[228 + i] = d

# Arcs: unwrap about the south, where each is broken, then walk from the low end.
for first, ring in ((300, threes), (500, top)):
    ring.sort(key=lambda d: (d["b"] - 180) % 360)
    for i, d in enumerate(ring):
        out[first + i] = d

assert len(out) == 135

print("field centre px (%.1f, %.1f), scale %.3f px/m" % (CX, CY, SCALE))
print()
print("anchors the chart shows, and where the walk put them:")
for sec, want, why in [(114, 0, "middle of the north end"),
                       (232, 180, "middle of the club"),
                       (323, 0, "middle of the north 300s"),
                       (521, 0, "middle of the north 500s"),
                       (100, None, "south-west corner"),
                       (346, None, "east end of the 300 arc"),
                       (542, None, "east end of the 500 arc")]:
    got = out[sec]["b"]
    err = "" if want is None else "  off %.1f" % abs(((got - want + 180) % 360) - 180)
    print("   %3d  %6.1f deg%s   (%s)" % (sec, got, err, why))

json.dump({str(s): out[s] for s in out}, open(os.path.join(HERE, "bearings.json"), "w"),
          indent=1)
print()
print("wrote bearings.json")

for name, first, count in (("100", 100, 36), ("200", 228, 9),
                           ("300", 300, 47), ("500", 500, 43)):
    bs = [out[first + i]["b"] for i in range(count)]
    span = (bs[-1] - bs[0]) % 360
    steps = [((bs[i + 1] - bs[i]) % 360) for i in range(count - 1)]
    print()
    print("%s ring: starts %.1f, ends %.1f, span %.1f" % (name, bs[0], bs[-1], span))
    print("   step: mean %.2f  min %.2f  max %.2f  (even spacing would be %.2f)"
          % (np.mean(steps), min(steps), max(steps),
             span / (count - 1) if count < 40 or name != "100" else 360 / count))
    print("   out:  min %.0f m  max %.0f m" % (
        min(out[first + i]["r"] for i in range(count)),
        max(out[first + i]["r"] for i in range(count))))
