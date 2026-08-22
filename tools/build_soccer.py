"""Build soccer.json from real tracking data.

Source: Metrica Sports' open sample data (github.com/metrica-sports/sample-data)
- 25 Hz positions for every player and the ball, with synchronised event data,
on a 105 x 68 m pitch. Their licence asks only that the source be acknowledged
if the data is used publicly, which the app does in the caption and in the info
sheet.

The passage taken is Sample Game 2, first half: a tackle won in midfield, worked
through eight passes and a switch of play, crossed, and finished first time.
Twenty-two and a half seconds from the turnover to the goal.

WHY THIS REPLACED THE PREVIOUS VERSION. This play used to be a reconstruction of
a famous goal, because no tracking data exists for any famous historical match.
That meant hand-authoring the touches and inferring everything else from a
team-shape model, a pressing model and a velocity limiter - a lot of machinery
whose only purpose was to make invented coordinates behave like real ones. All
of it is gone. Every position here is measured, so the movement is simply what
happened: the runs, the closing speeds, the angles a defence actually took, and
a real celebration afterwards rather than a scripted one.

The data is anonymised at source - no player, team or competition is named
anywhere in it - which happens to be exactly what the app wants.

Needs trk2_Home.csv and trk2_Away.csv beside it; see README.md for the fetch.
"""

import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.abspath(os.path.join(here, "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

