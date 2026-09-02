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
| `kickoff.py` | the head of `soccer.json` | Three staged seconds in front of the tackle. Imported by `build_soccer.py`, and runnable alone. Moves the event frames and `meta.assist` to match. |
| `anonymise.py` | the last step of every play file | Drops `name` and `jersey` from every player and the names from the play description; `meta.carrier` becomes an index. The renderer never reads any of it. |
| `make_field.py` | `assets/field.jpg` | The painted gridiron, with the solid white out-of-bounds border outside the lines — six feet, the rulebook minimum, and `APRON_YD` if you want it wider. The midfield mark is two constants at the top (`LOGO_LEN_YD`, `LOGO_HGT_YD`). |
| `make_pitch.py` | `assets/pitch.jpg` | The football pitch: regulation markings, no club marks, with an apron of grass around them. |
| `bundle.py` | `../build/dist` | A bundled copy of the app, generated from these same files, for the hosted comparison. Not needed to run anything. |
| `smoke.py` | nothing | Drives the app in headless Chrome and checks all six replays still work. Run before a deploy and again after one. |
| `seatcheck.py` | nothing | Every section faces where the seating chart says it does. |
| `zonecheck.py` | nothing | The same table against the club's own zone names. No browser needed. |
| `seatrelease.py` | nothing | A seat lets go of the camera when you leave it. |
| `tourcheck.py` | nothing | The slideshow runs its own replays through, and asks for a press when it stops. |
| `dockcheck.py` | nothing | The replay panel folds away while a passage runs, and comes back on hover. |
| `lightscheck.py` | nothing | The light switch is offered at every hour and stays where it was put. |
| `nightcheck.py` | nothing | The night views arrive at night, with the ground lit. |
| `flycheck.py` | nothing | The walk from Night Sky to the statues stays outside the stadium, and walks the sun home rather than snapping it. |
| `forecastcheck.py` | nothing | The clock reaches days that have not happened, the sky follows it there, and the chip says which it is showing. |
| `playfield.py` | nothing | The field transform, ported from `js/play.js`. Imported by the two below. |
| `simulate_play.py` | nothing | Replays a tracked passage on a clock and posts it as events, for an ArcGIS Velocity feed. See [`docs/VELOCITY.md`](../docs/VELOCITY.md). |
| `mockreceiver.py` | nothing | A local stand-in for a Velocity HTTP Receiver, so the feed can be built without an org. |
| `placardcheck.py` | nothing | The placard card shows the layer's own configured fields, says ILLEGIBLE where the reader could not read, marks the placard it is about, and is the only panel a click can raise. |
| `gatecheck.py` | nothing | The login is asked for on arrival, the scene loads behind it, and Explore opens only once both have happened. Refuses each half distinctly and lets any domain through with the right password. The one check that does not take `chrome()`'s sign-in bypass. |
| `statscheck.py` | nothing | The play's numbers describe the play, and the app says where they came from. |
| `simcheck.py` | nothing | The ported transform still agrees with the app, to the centimetre, on both sports. |
| `digitise_chart.py` | `tools/bearings.json` | Reads the section bearings off `seating_chart.png`. Rerun it if the chart changes. |

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

Each passage also records who the goal belongs to, in `meta.assist`: the player
who played the final delivery, the player who scored, and three frames — the
delivery leaving, the delivery arriving, and the ball crossing the line. The app
draws exactly that span and nothing else of the passage.

All of it is read out of the event file, which names both players, because none
of it can be recovered from the tracking afterwards. The source is 2D, so a ball
in the air is modelled as a straight line at constant speed between two measured
points, and a touch in the middle of that flight leaves no trace in it — by the
numbers alone the header looks like a cross that flew past its scorer and went
in on its own. Two details of the event file matter here. The frame a goal is
stamped at is the moment the shot is *struck*, and both crosses are finished
first time, so the delivery arriving and the goal are the same frame and the
finish is drawn from the shot's own end time instead. And three events share the
instant of the header — the aerial won, the shot, and the aerial lost by the man
who was beaten to it — so an end time looked up by time alone answers with the
defender's challenge, which ends the moment it begins.

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
| How far back and how high each seat sits | `js/seats.js` | `a`, `b`, `up` per ring |
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

**The out-of-bounds border.** The painted gridiron is bigger than the field:
`width`/`depth` in `CONFIG.field.surfaces.gridiron` is the slab that carries the
texture, `play` is the marked field inside it, and everything that measures
itself against the surface reads `play`. Confusing the two stands all 22 players
two yards wide of their own markings and puts the uprights in the crowd, which
is the whole reason the two numbers exist separately.

**Where the seats are.** Which way round the bowl a section sits is measured,
not assumed: `digitise_chart.py` reads all 135 off the published seating plan.
How far back it sits and how high are not - those are `a`, `b` and `up` in
`js/seats.js`, tuned by standing in them, because a seating chart shrinks the
field to make room for its labels and its radii are schematic even though its
angles are not.

Three attempts at deriving the angles instead all failed the same way. Sections
are not evenly spaced - the lower bowl steps by as little as 7.3 degrees and as
much as 13.2, because a section is a roughly constant width and the bowl is an
ellipse - and every wrong answer still put every section in a plausible seat,
facing the field, at a sensible height. It was simply the wrong seat, and only a
chart could say so. See `digitise_chart.py` and `zonecheck.py`.

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

## Checking it still works

```bash
propy smoke.py                                    # a local server
propy smoke.py https://b-connolly.github.io/sports-venue-digital-twin/
```

Opens the app in headless Chrome, clicks through all six passages, and
asserts what should be on screen: each play loads with frames, the Draw Play
checkbox is offered where a play has a route to draw and hidden where it has
not, the diagram draws both its lines, a football passage is blank before its
delivery, and the A and G shortcuts change sport. Exits non-zero if anything
failed, so it can gate a deploy.

It exists because everything that has gone wrong here has been visual and
timed rather than syntactic - a diagram that drew nothing at all while its
geometry read back perfectly, a keyboard shortcut that had never once worked,
a bundled build whose sky was missing because a caret let npm install a
different SDK. None of those fail a linter. All of them fail this.

Needs `websocket-client` and Chrome. Nothing is installed into the app: the
browser is driven over the DevTools protocol in a throwaway profile.

```bash
propy seatcheck.py          # a local server first; needs Chrome
propy zonecheck.py          # neither - reads js/seats.js directly
```

`seatcheck.py` pins sections to compass points the chart shows without trusting
any anchor: 114 on the north end, 132 on the south, 105 and 123 level with the
50 on either touchline. It leads with those because an earlier version checked
only which sections shared a spoke, and passed while the whole bowl was rotated
forty degrees - every relative claim true, every seat on the wrong side of the
ground.

`zonecheck.py` checks the same table against a source that knows nothing about
angles: the configuration behind the club's own 3D seat viewer, which names the
zone each section is sold as. It lists the same 135 sections, no more and none
missing. All 14 sold as Field Level End Zone face an end, all 14 Upper Level
Sideline face a touchline, North End Zone really is north. Exactly two are sold
as field-level prime - 105 and 123 - and the model puts them at 269.9 and 90.2
degrees, facing each other across the halfway line.


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
