"""Turn one NFL Big Data Bowl play into the compact JSON the app animates.

Source: https://github.com/nfl-football-ops/Big-Data-Bowl (the league's own
public release of 2017 tracking data - 10 Hz x/y for all 22 players plus the
ball). Nothing here is invented; the only synthesised quantity is the ball's
height, which the 2017 data does not carry (see ball_z).

Field frame in the source data:
  x  0..120 yd along the length, 0..10 and 110..120 being the end zones
  y  0..53.333 yd across, 0 at one sideline
  dir degrees clockwise from +y  (verified against atan2 of travel to 0.1 deg)
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

