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
import csv, json, math, os, sys, collections
from celebrate import add_celebration
from fieldgoal import to_record
from anonymise import anonymise
import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    dst = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

HERE = os.path.dirname(os.path.abspath(__file__))
HZ = 10.0

# The three passages the app offers, all from the one game the 2017 release
# actually tracks - it carries play-by-play for the whole season but tracking
# for 2017090700 alone, 177 plays of it.
#
#   propy build_play.py            # the deep pass, as before
#   propy build_play.py run        # the run
#   propy build_play.py fieldgoal  # the record kick
#
PLAYS = {
    "pass": {
        "game": "2017090700", "play": "2756", "out": "play.json",
        "celebrate": True,
        "blurb": (
            "The Quarterback lines up in the Shotgun position, hikes the ball, "
            "and passes deep for a 75 yard touchdown to the Wide Receiver."
        )
    },
    "run": {
        "game": "2017090700", "play": "4486", "out": "play_run.json",
        "celebrate": True,
        "blurb": (
            "From the I-formation the ball is handed off and run through the "
            "right side of the line, breaking into open field for a 21 yard "
            "touchdown."
        )
    },
    "fieldgoal": {
        "game": "2017090700", "play": "3559", "out": "play_fieldgoal.json",
        "celebrate": True, "record": True,
        "blurb": (
            "A field goal from 68 yards - the longest in NFL history - snapped, "
            "held and struck from the kicking team's own half."
        )
    },
}

KEY = (sys.argv[1] if len(sys.argv) > 1 else "pass").lower()
if KEY not in PLAYS:
    raise SystemExit("unknown play %r; try one of %s" % (KEY, ", ".join(PLAYS)))
SPEC = PLAYS[KEY]
GID, PID = SPEC["game"], SPEC["play"]
G = 9.80665
YD = 0.9144

def num(v, default=None):
    try: return float(v)
    except Exception: return default

rows = [r for r in csv.DictReader(open(os.path.join(HERE, "tracking.csv"), encoding="utf-8"))
        if r["gameId"] == GID and r["playId"] == PID]
play = next(r for r in csv.DictReader(open(os.path.join(HERE, "plays.csv"), encoding="utf-8"))
            if r["gameId"] == GID and r["playId"] == PID)
positions = {r["nflId"]: r["PositionAbbr"] for r in
             csv.DictReader(open(os.path.join(HERE, "players.csv"), encoding="utf-8"))
             if "PositionAbbr" in r} if True else {}

frames = sorted({int(r["frame.id"]) for r in rows})
F0, F1 = frames[0], frames[-1]
N = F1 - F0 + 1

events = {}
for r in rows:
    e = r["event"]
    if e and e != "NA":
        events.setdefault(e, int(r["frame.id"]) - F0)

by = collections.defaultdict(dict)
for r in rows:
    by[r["displayName"]][int(r["frame.id"]) - F0] = r

def track(seq):
    """Fill any gaps by holding the last good sample, so a dropped frame does
    not teleport a player to the origin."""
    xs, ys, ds = [], [], []
    last = None
    for i in range(N):
        r = seq.get(i)
        x = num(r["x"]) if r else None
        if x is None:
            x, y, d = last if last else (0.0, 0.0, 0.0)
        else:
            y = num(r["y"], 0.0); d = num(r["dir"], 0.0)
            last = (x, y, d)
        xs.append(round(x, 2)); ys.append(round(y, 2)); ds.append(round(d, 1))
    return xs, ys, ds

def home_abbr(game_id):
    """Which team abbreviation is the home side, inferred from the scoreboard.

    The release ships no games file, so there is nothing that states it. But
    every scoring play names the team in possession and moves one of the two
    score columns, and across a game that is unanimous - here twelve plays say
    one thing and eight say the other, with no play saying both.
    """
    votes = {}
    for r in csv.DictReader(open(os.path.join(HERE, "plays.csv"), encoding="utf-8")):
        if r["gameId"] != game_id:
            continue
        try:
            dh = int(r["HomeScoreAfterPlay"]) - int(r["HomeScoreBeforePlay"])
            dv = int(r["VisitorScoreAfterPlay"]) - int(r["VisitorScoreBeforePlay"])
        except ValueError:
            continue
        if dh > 0 and dv == 0:
            votes[r["possessionTeam"]] = votes.get(r["possessionTeam"], 0) + 1
        elif dv > 0 and dh == 0:
            votes[r["possessionTeam"]] = votes.get(r["possessionTeam"], 0) - 1
    return max(votes, key=votes.get) if votes else None


# Which of the two tracked sides has the ball. This used to be hard-coded as
# "away", which is right for two of the three plays here by luck: the third is
# a kick by the home team, and it put the whole kicking unit on the defending
# side - so the celebration formed around three defensive linemen.
POSSESSION_SIDE = "home" if home_abbr(GID) == play["possessionTeam"] else "away"
off = play["possessionTeam"]
players, ball = [], None
for name, seq in by.items():
    xs, ys, ds = track(seq)
    any_row = next(iter(seq.values()))
    if name == "football":
        ball = {"x": xs, "y": ys}
        continue
    players.append({
        "name": name,
        "jersey": any_row["jerseyNumber"],
        "side": "off" if any_row["team"] == POSSESSION_SIDE else "def",
        "pos": positions.get(any_row["nflId"], ""),
        "x": xs, "y": ys, "dir": ds
    })

# --- ball height -----------------------------------------------------------
# The 2017 release is x/y only. Height is reconstructed, not measured: carried
# at hand height, and a true ballistic arc between release and arrival whose
# apex follows from the hang time alone (h = g t^2 / 8). For this throw that is
# 2.4 s -> 7.1 m, which is a normal deep ball.
CARRY = 1.05
thrown, arrived = events.get("pass_forward"), events.get("pass_arrived")
# A kick that is about to be re-flown at record distance gets its height from
# fieldgoal.py instead; anything here would only be overwritten.
kicked = events.get("field_goal_attempt") if not SPEC.get("record") else None
landed = events.get("field_goal")
z = []
for i in range(N):
    if thrown is not None and arrived is not None and thrown <= i <= arrived:
        span = (arrived - thrown) / HZ
        t = (i - thrown) / HZ
        z.append(round(CARRY + (G * 0.5) * t * (span - t), 2))
    elif kicked is not None and landed is not None and kicked <= i <= landed:
        # Same rule as the pass: a true arc whose apex follows from the hang
        # time rather than being picked. Off the tee it starts on the ground.
        span = (landed - kicked) / HZ
        t = (i - kicked) / HZ
        z.append(round(0.11 + (G * 0.5) * t * (span - t), 2))
    elif kicked is not None and i > (landed or 0):
        z.append(0.11)
    else:
        z.append(CARRY)
ball["z"] = z

# Whoever is nearest the ball is holding it. Which frame to ask on depends on
# the play: the catch for a pass, and for a run the score rather than the
# handoff - at the mesh point the quarterback is as close to the ball as the
# back is, and picking him would build the celebration round the wrong man.
hold_f = events.get("pass_outcome_caught")
if hold_f is None and "handoff" in events:
    hold_f = events.get("touchdown", events["handoff"] + 5)
carrier = None
if hold_f is not None and hold_f < N:
    f = hold_f
    carrier = min(players, key=lambda p: (p["x"][f] - ball["x"][f]) ** 2
                                       + (p["y"][f] - ball["y"][f]) ** 2)["name"]
elif "field_goal_attempt" in events:
    # Nobody carries the ball on a kick, so the celebration forms around the
    # kicker. Measured from the hold rather than from the ball on the kick
    # frame: by then the ball is four yards downfield and the two men nearest
    # it are whoever happens to be rushing. The hold is where the ball stops
    # going backwards - and of the two of the kicking side standing over it,
    # the holder is on one knee and the kicker has just run into it, so the one
    # that moved is the one we want.
    kf = events["field_goal_attempt"]
    snap = events.get("ball_snap", 0)
    hold = min(range(snap, min(kf + 1, N)), key=lambda i: ball["x"][i])
    back = max(0, hold - 8)
    ours = [p for p in players if p["side"] == "off"] or players
    near = sorted(ours, key=lambda p: (p["x"][hold] - ball["x"][hold]) ** 2
                                    + (p["y"][hold] - ball["y"][hold]) ** 2)[:2]
    carrier = max(near, key=lambda p: math.hypot(p["x"][hold] - p["x"][back],
                                                 p["y"][hold] - p["y"][back]))["name"]

out = {
    "meta": {
        "hz": HZ, "frames": N,
        "game": "2017-09-07 " + play["possessionTeam"] + " offense",
        "quarter": int(play["quarter"]), "clock": play["GameClock"],
        "result": int(play["PlayResult"]),
        "description": play["playDescription"].strip(),
        "source": "NFL Big Data Bowl 2017 tracking data (nfl-football-ops/Big-Data-Bowl)",
        "sport": "gridiron",
        # Names the occasion, not the teams - see build_soccer.py.
        # What the caption reads out. The league description is kept in
        # `description` for provenance, but it is trade shorthand; this is
        # the same play told to somebody watching.
        "blurb": SPEC["blurb"],
        "credit": "",
        "sourceShort": "the league’s public Big Data Bowl release",
        "measured": True,
        "carrier": carrier
    },
    "events": events,
    "space": {"length": 120.0, "width": 53.333, "unit": "yd"},
    "surface": "gridiron",
    "ball": ball,
    "players": players
}
def hold_the_line(out):
    """Stand everyone still until the ball is snapped.

    Nothing may move before the snap but the man in motion, and these plays have
    none. The tracking says otherwise: over the second and a bit in front of the
    snap a guard travels two feet and turns through two hundred and ten degrees.
    The travel is real enough - players creep and settle - but the turning is
    not. `dir` is the tracker's estimate of which way a body is facing, and for
    somebody who is barely moving it has nothing to work from, so it wanders.
    Rendered, that is an offensive line pirouetting at the line of scrimmage,
    which is the one thing on screen that a viewer will know is wrong.

    So the pre-snap frames are held at the pose each man has on the snap itself.
    Held there rather than at their own first frame, so nobody jumps as the play
    starts: the first moving frame is the measured one it was always going to be.
    """
    snap = out["events"].get("ball_snap")
    if not snap:
        return out, 0
    for p in out["players"]:
        for k in ("x", "y", "dir"):
            at_snap = p[k][snap]
            for i in range(snap):
                p[k][i] = at_snap
    # Recorded like every other departure from the measurement.
    out["meta"]["heldToSnap"] = snap
    return out, snap


# Nothing moves before the snap.
out, held = hold_the_line(out)

# The pieces of movement in the app that are not measured, each in its own
# file so the boundary is somewhere a reader can find it.
huddle, modelled = [], None
if SPEC.get("record"):
    out, modelled = to_record(out)
if SPEC.get("celebrate"):
    out, huddle = add_celebration(out)
N = out["meta"]["frames"]

# Last: the renderer never reads a name, and the repo should not ship one.
out = anonymise(out)

dst = out_path("data", SPEC["out"])
# ensure_ascii=False to match kickoff.py, which also writes these files.
# Without it the two disagree about how to spell an apostrophe and the
# committed file depends on which script ran last.
json.dump(out, open(dst, "w", encoding="utf-8"),
          separators=(",", ":"), ensure_ascii=False)
print("wrote %s  %.1f KB" % (dst, os.path.getsize(dst) / 1024))
print("  frames %d (%.1f s)  players %d  carrier %s" % (N, N / HZ, len(players), carrier))
if huddle:
    print("  measured %.1f s, then a %.1f s celebration; huddle: %s"
          % (out["meta"]["measuredFrames"] / HZ, (N - out["meta"]["measuredFrames"]) / HZ,
             ", ".join(q["pos"] for q in huddle)))
if modelled:
    print("  moved %.1f yd back: a measured %.1f yd kick re-flown at %.0f yd"
          % (modelled["shift"], modelled["was"], 68.0))
    print("  %.1f m/s at 37 deg, apex %.1f m, crosses the bar at %.2f s"
          % (modelled["v"], modelled["apex"], modelled["to_posts"]))
    print("  %d measured frames, %d in the clip" % (modelled["n_measured"], modelled["n"]))
print("  held still for %.1f s before the snap" % (held / HZ))
print("  events:", {k: round(v / HZ, 1) for k, v in sorted(events.items(), key=lambda kv: kv[1])})
print("  ball apex %.1f m" % max(ball["z"]))
print("  %s" % out["meta"]["description"][:100])
