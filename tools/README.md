# tools

Offline generators. None of them is needed to run the app — they exist so the
generated assets can be rebuilt or changed. Each writes straight into `data/` or
`assets/`; nothing has to be copied by hand.

Run them with the Python that has Pillow, from this folder.

| Script | Writes | What it does |
|---|---|---|
| `build_play.py` | `data/play.json`, `data/play_run.json`, `data/play_fieldgoal.json` | One NFL play, converted for the animation. Takes the play as an argument — `pass` (the default), `run` or `fieldgoal`. The `PLAYS` table at the top is the list. |
| `celebrate.py` | the tail of each gridiron play | The celebration. A touchdown is celebrated in whichever end zone it was scored in; a kick around the kicker, where he stands. Imported by `build_play.py`, and runnable alone against an existing file. |
| `fieldgoal.py` | the ball in `play_fieldgoal.json` | Moves a measured field goal back to the 68 yard record and flies the ball there. Imported by `build_play.py`. |
| `build_soccer.py` | `data/soccer.json`, `data/soccer_header.json`, `data/soccer_counter.json` | One passage of football from 25 Hz tracking, resampled to 10. Takes the passage as an argument — `turnover` (the default), `header` or `counter`. The `PASSAGES` table at the top is the list. |
| `kickoff.py` | the head of `soccer.json` | Three staged seconds in front of the tackle. Imported by `build_soccer.py`, and runnable alone. |
| `anonymise.py` | the last step of every play file | Drops `name` and `jersey` from every player and the names from the play description; `meta.carrier` becomes an index. The renderer never reads any of it. |
| `make_field.py` | `assets/field.jpg` | The painted gridiron. The midfield mark is two constants at the top (`LOGO_LEN_YD`, `LOGO_HGT_YD`). |
| `make_pitch.py` | `assets/pitch.jpg` | The football pitch: regulation markings, no club marks, with an apron of grass around them. |

## Getting the source data

Neither release is redistributed here — both are a `curl` away, and the scripts
refuse to run without them. `tools/*.csv` is gitignored.

**NFL Big Data Bowl**, the league's own public release. No account needed:

```bash
B=https://raw.githubusercontent.com/nfl-football-ops/Big-Data-Bowl/master/Data
curl -sLO $B/players.csv -O $B/plays.csv
curl -sL -o tracking.csv $B/tracking_gameId_2017090700.csv     # 30 MB
```

**Metrica Sports** open sample data — 25 Hz for every player and the ball, plus
synchronised events, on a 105 x 68 m pitch. Anonymised at source: no player,
team or competition is named in it, which is exactly what the app wants. Their
licence asks only that the source be acknowledged where the data is used
publicly, which the app does in the replay caption and the info sheet.

```bash
B=https://raw.githubusercontent.com/metrica-sports/sample-data/master/data/Sample_Game_2
curl -sL -o trk2_Home.csv $B/Sample_Game_2_RawTrackingData_Home_Team.csv   # 30 MB
curl -sL -o trk2_Away.csv $B/Sample_Game_2_RawTrackingData_Away_Team.csv   # 28 MB
curl -sL -o ev2.csv       $B/Sample_Game_2_RawEventsData.csv
```

## The three gridiron plays

```bash
propy build_play.py            # deep pass       -> play.json          19.7 s
propy build_play.py run        # I-formation run -> play_run.json      16.1 s
propy build_play.py fieldgoal  # record kick     -> play_fieldgoal.json 14.7 s
```

All three come from the one game the 2017 release actually tracks. It carries
play-by-play for the whole season and tracking for `2017090700` alone — 177
plays of it, which is worth knowing before going looking for a fourth. To see
what is there:

```python
import csv
have = {(r["gameId"], r["playId"]) for r in
        csv.DictReader(open("tracking.csv", encoding="utf-8"))}
for r in csv.DictReader(open("plays.csv", encoding="utf-8")):
    if (r["gameId"], r["playId"]) in have:
        print(r["playId"], r["playDescription"][:90])
```

## The three football passages

```bash
propy build_soccer.py          # tackle to finish -> soccer.json          34.5 s
propy build_soccer.py header   # cross and header -> soccer_header.json   27.3 s
propy build_soccer.py counter  # intercept, break -> soccer_counter.json  32.8 s
```

All three are Sample Game 2. A passage is chosen by the times in `PASSAGES`, and
what limits the choice is the ball: it is only tracked while in play, so a
passage can start no earlier than its own tracking does. To find the goals and
then walk backwards from each until the ball's record has a hole in it:

```python
import csv
for r in csv.DictReader(open("ev2.csv", encoding="utf-8")):
    if r["Type"] == "SHOT" and "GOAL" in (r["Subtype"] or ""):
        print(r["Period"], r["Start Time [s]"], r["Subtype"], r["Team"])
```

Only `turnover` needs `kickoff.py`'s staged lead-in — it opens on the tackle
itself, because that is where its ball tracking starts. The other two begin on a
recovery with the move still in front of them.

Timeline marks are read from the event file rather than written down, except
where a passage names its own: the switch of play in `turnover` is one pass
among nine in the source and the whole point of the move on screen.

Which way the scoring side attacks is read off where the ball finishes, not
assumed. Teams change ends at half time, and it is not always the home side
scoring.

## What is not measured

Everything the app animates is measured tracking data apart from the following,
and every one of them is recorded in the file it belongs to, so the boundary is
visible in the data rather than only in this README.

| | Where | Recorded as |
|---|---|---|
| The celebration after each gridiron play | `celebrate.py` | `meta.measuredFrames` |
| Nobody moving before the snap | `build_play.py` | `meta.heldToSnap` |
| The record field goal's distance and flight | `fieldgoal.py` | `meta.modelled` |
| Three staged seconds before the tackle | `kickoff.py` | `meta.measuredFrom` |
| The ball's height, in football | `build_soccer.py` | — |
| Two repairs to the ball's path | `build_soccer.py` | `meta.bridged`, `meta.mended` |

**Nobody moves before the snap.** The tracking says otherwise — over the second
before it a guard travels two feet and turns through 210 degrees. The travel is
real enough, players creep and settle; the turning is not. `dir` is an estimate
of which way a body is facing, and for somebody barely moving it has nothing to
work from. Rendered, that is an offensive line pirouetting at the line of
scrimmage. Every pre-snap frame is held at the pose that man has on the snap
itself, so nothing jumps as the play starts.

**The record field goal.** 68 yards is the record and it had to be made rather
than found: the tracked game's longest is 32. The players, the snap, the hold
and the strike are that measured attempt moved 35.1 yd downfield; only the
distance and the flight are computed — 26.5 m/s at 37 degrees, apex 12.9 m,
crossing the bar at 4.5 m and clearing it by 1.44. The app reads all of it out
in the replay caption.

**Ball height, in football.** The source is 2D. Only a delivery the events call
a cross, or a pass too long to be rolled, is given an arc, and the apex comes
from its own hang time. A delivery met in the air finishes at head height and a
header at goal starts there — without that the cross arrived at ankle height and
the header was nodded in off the floor.

**Two repairs to the ball's path.** A dropout the passage declares in `bridge` is
drawn straight across — in `header`, 0.9 s during a tackle, 4.7 m. A
*reacquisition*, where the tracker keeps tracking but jumps to a different
object, is found automatically and eased out. Speed alone cannot spot those,
because a struck ball also jumps in one frame; what separates them is that a
struck ball stays fast and a reacquisition is followed by a ball barely moving.
Across the three passages the rule finds exactly one — a 3.8 m step at 94 m/s
followed by 3.8 m/s — and leaves every frame of the shot that scores the first
goal alone.

Drawing a straight line to where the ball reappeared was tried first and is
wrong: the line leaves at its own angle, so the ball swings off course, runs to
the new position and turns back. That is the same dart the step made, drawn
instead of jumped, and it still happens with nobody near it. The offset is
spread backwards with a smoothstep weight instead, so the ball keeps the shape
of its own motion.

**De-glitching** is a separate thing and applies to the players. Optical tracking
occasionally drops and reacquires someone and the track jumps — in `turnover`
one player crosses 9.6 m in 0.24 s. A velocity cap set *above* elite top speed
removes the artefact without touching a genuine sprint. Each run prints the
figure so it cannot creep up unnoticed: 0.24% of samples in `turnover`, none at
all in the other two.

## Re-running safely

`celebrate.py` and `kickoff.py` both trim whatever they added last time before
adding it again, so they are safe to run repeatedly while tuning the constants at
the top of each — how long the celebration lasts, how many team-mates reach the
huddle, how close they stand, the acceleration limits everyone moves under.

```bash
propy celebrate.py    # reads and writes play.json
propy kickoff.py      # reads and writes soccer.json
```

Every committed file under `data/` and the two textures rebuild byte-identically
from these scripts, so a rebuild that produces a diff means something actually
changed.

## The painted surfaces

```bash
propy make_field.py
propy make_pitch.py
```

The pitch is drawn with an apron of grass around the markings, as a real ground
has: 113 x 74 m painted around a 105 x 68 m pitch, four metres of it behind each
goal. Without it the turf stopped dead on the goal line and the goal stood on
the grey slab with its net slung 2.2 m further back, so a ball crossing the line
went from green to grey at the one moment anybody is watching it.

`CONFIG.field.surfaces` in the app has to agree: `width`/`depth` is the painted
slab and `play` is the marked pitch inside it. Everything that measures itself
against a surface — where the players stand, where the goals go — uses `play`.
