"""Prepend a short lead-in to the football play, so the tackle can be seen coming.

The measured passage opens on the tackle itself, because that is where the
source's ball tracking begins - Metrica records the ball only while it is in
play, from 465.6 s. Everyone is already moving and the ball changes feet in the
first tenth of a second, which is too fast to read. This adds three seconds in
front of it: a goal kick, the ball controlled in midfield, and then the tackle
exactly where the clip used to start.

None of it happened. It is the second piece of authored movement in the app,
after the gridiron celebration, and it is marked the same way -
`meta.measuredFrom` says how many frames at the head of the file are invented,
so the boundary stays visible in the data.

What it is built from is real, though. The kick is taken by whichever defender
is deepest at the tackle - PLAYER25, the goalkeeper, at x 97.5 - and it is
played to the man who actually gets dispossessed, PLAYER22, standing 2 m from
the ball when the measured data begins. Every player is walked backwards from
the position and the velocity they genuinely have on the first measured frame,
so the join is continuous rather than a cut.

    propy kickoff.py

Re-running trims any lead-in already on the file first, so it is safe to run
repeatedly while tuning the numbers below.
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

