"""Generate pitch.jpg — a generic association football pitch.

Deliberately plain: mown stripes and the regulation markings, no club badge, no
sponsor, no competition mark. Dimensions follow the Laws of the Game for a
pitch at the larger end of the permitted range, which is what a stadium of this
size would have.

  overall            105 x 68 m
  centre circle      9.15 m radius
  penalty area       16.5 m deep, 40.32 m wide
  goal area          5.5 m deep, 18.32 m wide
  penalty spot       11 m from the goal line
  penalty arc        9.15 m radius about the spot, drawn only outside the area
  corner arc         1 m radius
  line width         12 cm

Output is written portrait, so its long axis matches the field's north-south
orientation in the scene, the same convention make_field.py uses.
"""
from PIL import Image, ImageDraw
import os, math

M = 16                                   # pixels per metre
L, W = 105.0, 68.0
LW = max(2, int(0.12 * M))               # 12 cm lines

TURF_A, TURF_B = (38, 96, 48), (32, 86, 42)
WHITE = (243, 245, 242)

img = Image.new("RGB", (int(L * M), int(W * M)), TURF_A)
d = ImageDraw.Draw(img)

# Mown stripes, five metres each, running across the pitch as they usually do.
for i in range(int(L / 5) + 1):
    if i % 2:
        d.rectangle([i * 5 * M, 0, (i + 1) * 5 * M, W * M], fill=TURF_B)

def X(m): return m * M
def Y(m): return m * M
def line(x0, y0, x1, y1, w=None):
    d.line([(X(x0), Y(y0)), (X(x1), Y(y1))], fill=WHITE, width=w or LW)
def rect(x0, y0, x1, y1):
    d.rectangle([X(x0), Y(y0), X(x1), Y(y1)], outline=WHITE, width=LW)
def circle(cx, cy, r):
    d.ellipse([X(cx - r), Y(cy - r), X(cx + r), Y(cy + r)], outline=WHITE, width=LW)
def dot(cx, cy, r=0.18):
    d.ellipse([X(cx - r), Y(cy - r), X(cx + r), Y(cy + r)], fill=WHITE)

# Boundary, halfway line, centre circle and spot.
half = LW / 2 / M
rect(half, half, L - half, W - half)
line(L / 2, 0, L / 2, W)
circle(L / 2, W / 2, 9.15)
dot(L / 2, W / 2)

for end in (0, 1):
    sign = 1 if end == 0 else -1
    gl = 0.0 if end == 0 else L                      # goal line
    # Penalty and goal areas.
    rect(min(gl, gl + sign * 16.5), W / 2 - 20.16,
         max(gl, gl + sign * 16.5), W / 2 + 20.16)
    rect(min(gl, gl + sign * 5.5), W / 2 - 9.16,
         max(gl, gl + sign * 5.5), W / 2 + 9.16)
    spot = gl + sign * 11.0
    dot(spot, W / 2)

    # Penalty arc: the part of a 9.15 m circle about the spot that falls outside
    # the penalty area. Half-angle to the area edge comes straight from the
    # geometry - the area is 5.5 m beyond the spot.
    edge = abs(16.5 - 11.0)
    th = math.degrees(math.acos(edge / 9.15))
    base = 0 if end == 0 else 180
    d.arc([X(spot - 9.15), Y(W / 2 - 9.15), X(spot + 9.15), Y(W / 2 + 9.15)],
          start=base - th, end=base + th, fill=WHITE, width=LW)

    # Corner arcs.
    for cy in (0.0, W):
        x0, y0 = gl - 1.0, cy - 1.0
        s = {(0, 0.0): (0, 90), (0, W): (270, 360),
             (1, 0.0): (90, 180), (1, W): (180, 270)}[(end, cy)]
        d.arc([X(x0), Y(y0), X(x0 + 2), Y(y0 + 2)],
              start=s[0], end=s[1], fill=WHITE, width=LW)

here = os.path.dirname(os.path.abspath(__file__))
img.save(os.path.join(here, "pitch_landscape.jpg"), quality=88, optimize=True)
rot = img.rotate(90, expand=True)
dst = os.path.join(here, "pitch.jpg")
rot.save(dst, quality=88, optimize=True)
print("  pitch.jpg %dx%d  %.0f KB" % (rot.size[0], rot.size[1],
                                      os.path.getsize(dst) / 1024))
