"""Append an end-zone celebration to the gridiron play.

Everything the app animates is measured tracking data, with one exception, and
this is it. The league's tracking window closes 1.1 s after the ball crosses
the line, so the clip ended on a receiver still running flat out with nobody
within twenty yards of him. What this adds is the few seconds that follow: the
nearest team-mates run in and mob him, the rest of the offence jogs up and
pulls short, and the defence walks back upfield.

No measured frame is touched. `meta.measuredFrames` records where the tracking
data stops, so the boundary stays visible in the file itself.

Two ways in:

  from celebrate import add_celebration        # build_play.py uses this
  add_celebration(out)

  propy celebrate.py                           # re-run it on an existing
                                               # play.json, which is what you
                                               # want when the source CSV is
                                               # not on the machine

Re-running on a file that already carries a tail trims the old one first, so it
is safe to run repeatedly while tuning the numbers below.
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

