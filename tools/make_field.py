"""Regenerate the painted gridiron texture.

Regulation markings only: five-yard lines, NFL hash marks 70 ft 9 in from each
sideline, yard numbers on both sidelines with the far row inverted as on a real
field, and plain dark-blue end zones. No club name, no badge, no sponsor - the
surface is meant to read as a venue rather than as one team's home.

Edit and re-run; it writes field.jpg (portrait, ready for the app) next to
itself.
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

