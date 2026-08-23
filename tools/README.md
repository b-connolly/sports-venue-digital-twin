# tools

Offline generators. None is needed to run the app — they exist so the generated
assets can be rebuilt or changed.

| Script | Produces | Notes |
|---|---|---|
| `make_field.py` | `field.jpg` | The painted playing surface. The midfield mark is two constants at the top (`LOGO_LEN_YD`, `LOGO_HGT_YD`). Needs Pillow. |
| `build_play.py` | `play.json`, `play_run.json`, `play_fieldgoal.json` | One NFL play, converted for the animation. Takes the play as an argument — `pass` (the default), `run` or `fieldgoal`; the table at the top of the file is the list. Measured up to `meta.measuredFrames`; see `celebrate.py` for what follows. |
| `anonymise.py` | the last step of `play.json` | Drops `name` and `jersey` from every player and the names from the play description; `meta.carrier` becomes an index. The renderer never reads any of it. |
| `celebrate.py` | the tail of each gridiron play | The celebration, the one piece of movement in the app that is not measured. A touchdown is celebrated in whichever end zone it was scored in; a kick is celebrated around the kicker. Imported by `build_play.py`, and runnable on its own against an existing `play.json` when the source CSV is not to hand. |
| `fieldgoal.py` | the ball in `play_fieldgoal.json` | Moves a measured field goal back to the 68 yard record and flies the ball there. The only long kick in the app, and the only one that is not measured — the release tracks one game, whose longest is 32 yards. Imported by `build_play.py`. |
| `make_pitch.py` | `pitch.jpg` | The association football pitch: regulation markings, no club marks. |
| `build_soccer.py` | `soccer.json`, `soccer_header.json`, `soccer_counter.json` | A goal from real 25 Hz tracking (Metrica Sports open data), resampled to 10. Takes the passage as an argument — `turnover` (the default), `header` or `counter`. |
| `kickoff.py` | the head of `soccer.json` | The three staged seconds in front of the tackle - a goal kick, the ball controlled, then the turnover. Imported by `build_soccer.py`, and runnable on its own. |

## Rebuilding play.json

All three NFL plays come from the one game the 2017 release actually tracks —
it carries play-by-play for the whole season but tracking for `2017090700`
alone, 177 plays of it:

```bash
propy build_play.py            # the deep pass  -> play.json
propy build_play.py run        # the run        -> play_run.json
propy build_play.py fieldgoal  # the record kick -> play_fieldgoal.json
```

`build_play.py` expects `tracking.csv`, `plays.csv` and `players.csv` beside it.
They come from the NFL's own public release — no Kaggle account needed:

```bash
B=https://raw.githubusercontent.com/nfl-football-ops/Big-Data-Bowl/master/Data
curl -sLO $B/games.csv -O $B/players.csv -O $B/plays.csv
curl -sL -o tracking.csv $B/tracking_gameId_2017090700.csv     # 30 MB
python build_play.py
```

The repository carries tracking for one game, 2017090700 (KC at NE, the 2017
season opener), which contains nine touchdowns. `GID`/`PID` at the top of the
script choose which. The current pick is playId 2756 — a 75-yard catch and run,
the longest in the game and the one that uses the most of the field.

To find the others:

```python
import csv
for r in csv.DictReader(open("plays.csv", encoding="utf-8")):
    if r["gameId"] == "2017090700" and "TOUCHDOWN" in r["playDescription"].upper():
        print(r["playId"], r["playDescription"][:90])
```

Copy the resulting `play.json` up into the app folder.


## Adjusting the celebration

`celebrate.py` trims any tail already on the file before appending a new one,
so it is safe to run repeatedly while tuning the constants at the top of it -
how long it lasts, how many team-mates reach the huddle, how close they stand,
and the acceleration limits everyone moves under.

```
propy celebrate.py
```

It reads and writes `play.json` in this folder if there is one, and the copy in
the app folder otherwise.

## Adjusting the lead-in

The measured passage opens on the tackle, because that is where Metrica's ball
tracking begins. `kickoff.py` puts three invented seconds in front of it so the
turnover can be seen coming, and records `meta.measuredFrom` so the boundary
stays visible in the data. Like `celebrate.py` it trims any lead-in already on
the file before writing a new one, so it is safe to re-run while tuning.

```
propy kickoff.py
```

All three passages come from Sample Game 2:

```bash
propy build_soccer.py            # tackle to finish  -> soccer.json
propy build_soccer.py header     # cross and header  -> soccer_header.json
propy build_soccer.py counter    # intercept, break  -> soccer_counter.json
```

Only the first needs `kickoff.py`'s staged lead-in: it opens on the tackle,
because that is where its ball tracking starts. The other two begin on a
recovery with the move still in front of them.

The ball's path gets two kinds of repair, both recorded in the file. A dropout
the passage declares in `bridge` is drawn straight across. A *reacquisition* -
where the tracker keeps tracking but jumps to a different object, stepping
several metres in one frame and carrying on smoothly - is found automatically
and eased out: the offset between the two sides of the seam is spread backwards
over the preceding frames with a smoothstep weight, so the ball keeps the shape
of its own motion. Drawing a straight line to where it reappeared was tried
first and is wrong — the line leaves at its own angle, so the ball swings off
course, runs to the new position and turns back, which is the same dart the step
made, just drawn instead of jumped. Speed alone cannot spot those, because
a struck ball also jumps in one frame; what separates them is that a struck ball
stays fast and a reacquisition is followed by a ball barely moving.

Timeline marks are read from the event file rather than written down, except
where a passage names its own — the switch of play in `turnover` is one pass
among nine in the source and the whole point of the move on screen.

## Rebuilding soccer.json

`build_soccer.py` expects `trk2_Home.csv`, `trk2_Away.csv` and `ev2.csv` beside
it — Sample Game 2 from Metrica Sports' open sample data, which is real 25 Hz
tracking for every player and the ball plus synchronised events, on a 105 x 68 m
pitch. **The data is anonymised at source**: no player, team or competition is
named in it, which is exactly what the app wants.

```bash
B=https://raw.githubusercontent.com/metrica-sports/sample-data/master/data/Sample_Game_2
curl -sL -o trk2_Home.csv $B/Sample_Game_2_RawTrackingData_Home_Team.csv   # 30 MB
curl -sL -o trk2_Away.csv $B/Sample_Game_2_RawTrackingData_Away_Team.csv   # 28 MB
curl -sL -o ev2.csv       $B/Sample_Game_2_RawEventsData.csv
python build_soccer.py
```

Their licence asks only that the source be acknowledged wherever the data is
used publicly. The app does that in the play caption and in the info sheet.

`T_START`, `T_GOAL` and `T_END` at the top choose the passage. The current one
is the first half at 463&ndash;500 s: a tackle won in midfield, eight passes, a
switch, a cross and a first-time finish, plus the real celebration afterwards.
To find the others:

```python
import csv
rows = list(csv.DictReader(open("ev2.csv", encoding="utf-8")))
for i, r in enumerate(rows):
    if r["Type"] == "SHOT" and "GOAL" in (r["Subtype"] or ""):
        print(r["Period"], r["Start Time [s]"], r["Subtype"])
```

Two quantities are **not** measured, and the script prints both every run:

- **Ball height.** The source is 2D. Only a delivery the events call a cross, or
  a pass too long to be rolled, is given an arc; the apex comes from its own
  hang time. Everything else stays on the deck.
- **De-glitching.** Optical tracking occasionally drops and reacquires a player,
  and the track jumps — in this window one player crosses 9.6 m in 0.24 s. A
  velocity cap set *above* elite top speed removes those artefacts without
  touching genuine sprints. It currently affects **0.22% of samples**, and the
  script reports the figure so it cannot creep up unnoticed.
