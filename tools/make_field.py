"""Regenerate the painted gridiron texture.

Regulation markings only: five-yard lines, NFL hash marks 70 ft 9 in from each
sideline, yard numbers on both sidelines with the far row inverted as on a real
field, and plain dark-blue end zones. No club name, no badge, no sponsor - the
surface is meant to read as a venue rather than as one team's home.

Edit and re-run; it writes field.jpg (portrait, ready for the app) next to
itself.
"""
from PIL import Image, ImageDraw, ImageFont
import os, math

YD = 26                                   # pixels per yard
W, H = 120*YD, int(round(53.333*YD))
TURF_A, TURF_B = (34,88,44), (28,78,38)
# A deep navy for the end zones: dark enough to separate cleanly from the
# turf from the high broadcast angles the app flies, without going to black,
# which loses all its shading under a low sun.
ENDZONE, WHITE = (12,35,66), (245,245,240)
LOGO_LEN_YD, LOGO_HGT_YD = 6.0, 3.0       # half-length, half-height of the mark

img = Image.new("RGB", (W,H), TURF_A); d = ImageDraw.Draw(img)
for i in range(24):
    x0 = i*5*YD
    d.rectangle([x0,0,x0+5*YD,H], fill=TURF_A if i%2==0 else TURF_B)
d.rectangle([0,0,10*YD,H], fill=ENDZONE)
d.rectangle([110*YD,0,W,H], fill=ENDZONE)

def font(sz):
    for p in (r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\segoeuib.ttf"):
        if os.path.exists(p): return ImageFont.truetype(p, sz)
    return ImageFont.load_default()

lw = max(2, YD//7)
for yd in range(10,111,5):
    x = yd*YD
    d.line([(x,0),(x,H)], fill=WHITE, width=lw*(2 if yd in (10,110) else 1))
hash_in = 70.75/3.0
for yd in range(11,110):
    x = yd*YD
    for yy in (hash_in, 53.333-hash_in):
        y = yy*YD
        d.line([(x,y-0.4*YD),(x,y+0.4*YD)], fill=WHITE, width=lw)
    d.line([(x,0),(x,0.6*YD)], fill=WHITE, width=lw)
    d.line([(x,H-0.6*YD),(x,H)], fill=WHITE, width=lw)

f_num = font(int(YD*3.4))
for yd,lab in [(20,"10"),(30,"20"),(40,"30"),(50,"40"),(60,"50"),
               (70,"40"),(80,"30"),(90,"20"),(100,"10")]:
    x = yd*YD
    for y,flip in ((int(H*0.16),True),(int(H*0.84),False)):
        t = Image.new("RGBA",(int(YD*7),int(YD*4.6)),(0,0,0,0))
        ImageDraw.Draw(t).text((t.width//2,t.height//2),lab,font=f_num,
                               fill=WHITE+(255,),anchor="mm")
        if flip: t = t.rotate(180)
        img.paste(t,(x-t.width//2,y-t.height//2),t)

# End zones are left plain. Naming a club here would tie the surface to one
# team, and the app is meant to read as a venue rather than a fixture - the
# same reason the midfield mark is a bare outline and the kit is generic.

# Midfield: a plain white outline. A football silhouette is a lens - two
# circular arcs meeting at points - not an ellipse; the points are what make it
# read as a football rather than an eye.
cx, cy = 60*YD, H//2
a, b = int(YD*LOGO_LEN_YD), int(YD*LOGO_HGT_YD)
R = (a*a + b*b) / (2.0*b)
off = R - b
sw = int(lw*2.6)
def arc(sign):
    t0 = math.asin(a/R); pts = []
    for i in range(121):
        t = -t0 + (2*t0)*i/120.0
        pts.append((cx + R*math.sin(t), cy - sign*(off - R*math.cos(t))))
    return pts
top, bot = arc(1), arc(-1)
d.line(top + bot[::-1] + [top[0]], fill=WHITE, width=sw, joint="curve")

here = os.path.dirname(os.path.abspath(__file__))
img.save(os.path.join(here,"field_landscape.jpg"), quality=88, optimize=True)
rot = img.rotate(90, expand=True)
rot.save(os.path.join(here,"field.jpg"), quality=88, optimize=True)
print("  field.jpg %dx%d  %.0f KB"%(rot.size[0],rot.size[1],
      os.path.getsize(os.path.join(here,"field.jpg"))/1024))
img.crop((cx-int(a*2.0),cy-int(b*2.4),cx+int(a*2.0),cy+int(b*2.4))).resize(
    (760,int(760*(b*4.8)/(a*4.0))), Image.LANCZOS).save(os.path.join(here,"midfield_preview.png"))
