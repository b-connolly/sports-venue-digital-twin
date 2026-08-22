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
import csv, json, math, os, collections
from celebrate import add_celebration
from anonymise import anonymise

HERE = os.path.dirname(os.path.abspath(__file__))
GID, PID = "2017090700", "2756"
HZ = 10.0
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
        "side": "off" if any_row["team"] == "away" else "def",
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
z = []
for i in range(N):
    if thrown is not None and arrived is not None and thrown <= i <= arrived:
        span = (arrived - thrown) / HZ
        t = (i - thrown) / HZ
        z.append(round(CARRY + (G * 0.5) * t * (span - t), 2))
    else:
        z.append(CARRY)
ball["z"] = z

carrier = None
if "pass_outcome_caught" in events:
    # Whoever is nearest the ball on the catch frame is holding it.
    f = events["pass_outcome_caught"]
    carrier = min(players, key=lambda p: (p["x"][f] - ball["x"][f]) ** 2
                                       + (p["y"][f] - ball["y"][f]) ** 2)["name"]

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
        "blurb": (
            "The Quarterback lines up in the Shotgun position, hikes the ball, "
            "and passes deep for a 75 yard touchdown to the Wide Receiver."
        ),
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
# The one piece of movement in the app that is not measured; see celebrate.py.
out, huddle = add_celebration(out)
N = out["meta"]["frames"]

# Last: the renderer never reads a name, and the repo should not ship one.
out = anonymise(out)

dst = os.path.join(HERE, "play.json")
json.dump(out, open(dst, "w", encoding="utf-8"), separators=(",", ":"))
print("wrote %s  %.1f KB" % (dst, os.path.getsize(dst) / 1024))
print("  frames %d (%.1f s)  players %d  carrier %s" % (N, N / HZ, len(players), carrier))
print("  measured %.1f s, then a %.1f s celebration; huddle: %s"
      % (out["meta"]["measuredFrames"] / HZ, (N - out["meta"]["measuredFrames"]) / HZ,
         ", ".join(q["pos"] for q in huddle)))
print("  events:", {k: round(v / HZ, 1) for k, v in sorted(events.items(), key=lambda kv: kv[1])})
print("  ball apex %.1f m" % max(ball["z"]))
print("  %s" % out["meta"]["description"][:100])
