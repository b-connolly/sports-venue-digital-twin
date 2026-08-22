"""Take the real people out of play.json.

The Big Data Bowl release is per-player, so the extraction carried names and
squad numbers through with it: `players[].name`, `players[].jersey`, the
`meta.carrier`, and the league's own play description, which names the passer
and the receiver. None of it is secret - it is a published play from a
televised game - but the app deliberately names nobody, and a public repository
should not ship a roster it has no reason to hold.

Nothing in the app reads any of it. `name` and `jersey` are never touched by the
renderer, and `carrier` is only used at build time, to know who the celebration
forms around. So the names can go and the only thing that has to survive is that
one reference, which becomes an index instead.

Positions stay. "WR" is a job, not a person, and the build scripts use it.

    propy anonymise.py

Safe to re-run: a file that has already been through this is left alone.
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

