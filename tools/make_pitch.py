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

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

