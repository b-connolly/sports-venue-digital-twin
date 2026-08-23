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
import csv, json, math, os
from kickoff import add_kickoff
from anonymise import anonymise
import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    dst = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

HERE = os.path.dirname(os.path.abspath(__file__))
L, W = 105.0, 68.0
OUT_HZ = 10.0                  # resampled from 25 Hz to keep the file small
SRC_HZ = 25.0

# Sample Game 2, first half.
PERIOD = "1"
# The ball is only tracked while it is in play - 465.6 s (the tackle) to 488.5 s
# (the shot). The players are tracked throughout. So the clip starts exactly on
# the turnover: any earlier and the ball would have no recorded position and
# would hang motionless while everyone else moved around it.
T_START, T_GOAL, T_END = 465.6, 488.1, 500.0


def load(path):
    """Read one team's tracking file into {frame: {player: (x, y)}} and the
    ball. Row 3 carries the column names; each player occupies an x column and
    the unnamed y column immediately after it."""
    times = {}
    with open(path, encoding="utf-8") as fh:
        rows = csv.reader(fh)
        next(rows); next(rows)
        head = next(rows)
        cols = {name: i for i, name in enumerate(head)
                if name and name not in ("Period", "Frame", "Time [s]")}
        out, ball = {}, {}
        for r in rows:
            if r[0] != PERIOD:
                continue
            t = float(r[2])
            if t < T_START - 1 or t > T_END + 1:
                continue
            fr = int(r[1])
            times[fr] = t
            per = {}
            for name, i in cols.items():
                try:
                    x, y = float(r[i]), float(r[i + 1])
                except (ValueError, IndexError):
                    continue
                # Players off the pitch are written as NaN, which float()
                # accepts happily - so they have to be rejected explicitly or
                # the bench ends up on the field.
                if math.isnan(x) or math.isnan(y):
                    continue
                if name == "Ball":
                    ball[fr] = (x, y)
                else:
                    per[name] = (x, y)
            out[fr] = per
    return out, ball, times


home, ball_raw, times = load(os.path.join(HERE, "trk2_Home.csv"))
away, _, _ = load(os.path.join(HERE, "trk2_Away.csv"))
# Players and ball are tracked over different spans, so they get separate frame
# sets. Intersecting them - which is what this used to do - clipped everybody
# down to the ball's range, and the clip then sat frozen either side of it: no
# movement before the turnover, and a celebration that never played.
frames = sorted(set(home) & set(away))
ball_frames = sorted(ball_raw)
assert frames, "no player frames - is the tracking data downloaded?"
assert ball_frames, "no ball frames in the window"
f0 = frames[0]
first_t = times[f0]


def place(p):
    """Rotate the pitch 180 degrees so the scoring team attacks +x, matching the
    gridiron play and the way the goals are placed. Rotating rather than
    mirroring keeps left and right the right way round."""
    return (L - p[0] * L, W - p[1] * W)


def present(track):
    """Only players on the pitch for the whole window; substitutes are blank."""
    keys = None
    for fr in frames:
        here = set(track[fr])
        keys = here if keys is None else (keys & here)
    return sorted(keys, key=lambda s: int(s.replace("Player", "")))


att_keys, def_keys = present(home), present(away)
assert len(att_keys) == 11 and len(def_keys) == 11, (len(att_keys), len(def_keys))

N = int(round((T_END - T_START) * OUT_HZ)) + 1


# --- cleaning the source ---------------------------------------------------
# Optical tracking drops and reacquires people, and when it does the track
# jumps: one player here crosses 9.6 m in 0.24 s, which is four times what a
# person can run. The fix is a velocity limit - the position chases the measured
# one at a capped speed, so a genuine sprint passes through untouched and only
# the physically impossible is smoothed away. The cap is set above elite top
# speed on purpose: the point is to remove artefacts, not to tidy up the data.
CAP = 9.5                       # m/s; elite top speed is a shade over 10
BALL_CAP = 45.0                 # a struck ball is not a person - it is allowed
                                # to leave at 20 m/s and a shot at more


def declitch(xs, ys, speed=CAP):
    cap = speed / OUT_HZ
    ox, oy, fixed = [xs[0]], [ys[0]], 0
    for i in range(1, len(xs)):
        dx, dy = xs[i] - ox[-1], ys[i] - oy[-1]
        d = math.hypot(dx, dy)
        if d > cap:
            dx, dy = dx * cap / d, dy * cap / d
            fixed += 1
        ox.append(ox[-1] + dx)
        oy.append(oy[-1] + dy)
    return ox, oy, fixed


CLEANED = []


def sample_at(track, key, t):
    """Linear interpolation between the two source frames either side of t.

    Each source is clamped to its own tracked span. For the ball that means it
    rests where it was last seen once it is out of play - which, after a shot on
    target, is in the back of the net.
    """
    span = frames if track else ball_frames
    fr = f0 + (t - first_t) * SRC_HZ
    a = max(span[0], min(span[-1], int(math.floor(fr))))
    b = max(span[0], min(span[-1], a + 1))
    u = max(0.0, min(1.0, fr - a))
    pa = (track[a].get(key) if track else ball_raw.get(a))
    pb = (track[b].get(key) if track else ball_raw.get(b))
    pa = pa or pb
    pb = pb or pa
    ax, ay = place(pa)
    bx, by = place(pb)
    return ax + (bx - ax) * u, ay + (by - ay) * u


def track_of(source, key, speed=CAP):
    raw_x, raw_y = [], []
    for i in range(N):
        t = T_START + i / OUT_HZ
        x, y = sample_at(source, key, t)
        raw_x.append(x); raw_y.append(y)
    raw_x, raw_y, fixed = declitch(raw_x, raw_y, speed)
    if fixed:
        CLEANED.append((key or "Ball", fixed))

    xs, ys, ds = [], [], []
    prev = None
    for i in range(N):
        x, y = raw_x[i], raw_y[i]
        xs.append(round(x, 2)); ys.append(round(y, 2))
        if prev is None:
            ds.append(0.0)
        else:
            dx, dy = x - prev[0], y - prev[1]
            ds.append(round(math.degrees(math.atan2(dx, dy)) % 360, 1)
                      if (dx * dx + dy * dy) > 4e-4 else ds[-1])
        prev = (x, y)
    if len(ds) > 1:
        ds[0] = ds[1]
    return xs, ys, ds


players = []
for k in att_keys:
    xs, ys, ds = track_of(home, k)
    players.append({"name": "Attacker", "jersey": "", "side": "off",
                    "pos": k.upper(), "x": xs, "y": ys, "dir": ds})
for k in def_keys:
    xs, ys, ds = track_of(away, k)
    players.append({"name": "Defender", "jersey": "", "side": "def",
                    "pos": k.upper(), "x": xs, "y": ys, "dir": ds})

bx, by, _ = track_of(None, None, BALL_CAP)

# --- ball height -----------------------------------------------------------
# The source is 2D: x and y are measured, z is not recorded at all. So height is
# the one quantity here that is inferred rather than observed, and the event
# list is what it is inferred from.
#
# A ball cannot be told from its ground track alone whether it was rolling or
# flying - a slow 7 m pass and a lofted 27 m diagonal can share an average
# speed. So the rule is deliberately conservative: only a delivery the event
# data calls a CROSS, or a pass long enough that it is almost certainly in the
# air, gets an arc. Everything else stays on the deck. The apex follows from the
# delivery's own hang time (h = g t^2 / 8), capped so an over-long event
# boundary cannot launch the ball into orbit.
LOFT_MIN_M = 25.0               # a pass this long is not being rolled
APEX_CAP = 8.0


def ball_events():
    out = []
    with open(os.path.join(HERE, "ev2.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["Period"] != PERIOD or r["Type"] not in ("PASS", "SHOT"):
                continue
            try:
                a, b = float(r["Start Time [s]"]), float(r["End Time [s]"])
                d = math.hypot((float(r["End X"]) - float(r["Start X"])) * L,
                               (float(r["End Y"]) - float(r["Start Y"])) * W)
            except (ValueError, KeyError):
                continue
            if b <= a or a < T_START or b > T_END:
                continue
            sub = (r["Subtype"] or "").upper()
            if r["Type"] == "SHOT":
                out.append((a, b, min(0.6, 9.80665 * (b - a) ** 2 / 8)))
            elif "CROSS" in sub or d >= LOFT_MIN_M:
                out.append((a, b, min(APEX_CAP, 9.80665 * (b - a) ** 2 / 8)))
    return out


AIRBORNE = ball_events()
bz = []
for i in range(N):
    t = T_START + i / OUT_HZ
    z = 0.11
    for (a, b, apex) in AIRBORNE:
        if a <= t <= b:
            u = (t - a) / (b - a)
            z = max(z, 0.11 + 4 * apex * u * (1 - u))
    bz.append(round(z, 2))

# Markers on the transport bar, taken from the source's own event times.
events = {
    "win": int(round((465.6 - T_START) * OUT_HZ)),      # tackle won
    "switch": int(round((482.8 - T_START) * OUT_HZ)),   # switched right
    "cross": int(round((487.2 - T_START) * OUT_HZ)),
    "goal": int(round((T_GOAL - T_START) * OUT_HZ)),
    # Not an event in the source data - the source stops at the goal. This is
    # read off the tracking that follows it: between 23.5 s and 27.5 s the
    # scoring side closes from 20.8 m of spread to 16.2 m and its centroid
    # starts for the corner flag, which is the moment they wheel away.
    "celebration": int(round((492.2 - T_START) * OUT_HZ))
}

out = {
    "meta": {
        "hz": OUT_HZ, "frames": N,
        "sport": "football",
        "title": "Turnover to goal",
        "description": ("Won by a tackle in midfield, worked through eight passes "
                        "and a switch of play, then crossed and finished first time."),
        "credit": "First half, anonymised sample match",
        "source": "Metrica Sports open sample data, 25 Hz resampled to 10",
        "sourceShort": "Metrica Sports’ open sample data",
        "measured": True,
        "carrier": None
    },
    "events": events,
    "space": {"length": L, "width": W, "unit": "m"},
    "surface": "pitch",
    "ball": {"x": bx, "y": by, "z": bz, "radius": 0.11},
    "players": players
}

# The three staged seconds in front of the tackle; see kickoff.py.
out, _kicker, _receiver, _apex = add_kickoff(out)

# Same shape as the gridiron file: no fields the renderer never reads.
out = anonymise(out)

dst = out_path("data", "soccer.json")
json.dump(out, open(dst, "w", encoding="utf-8"), separators=(",", ":"))
print("wrote %s  %.1f KB" % (dst, os.path.getsize(dst) / 1024))
print("  %d players, %d frames (%.1f s), goal at %.1f s"
      % (len(players), N, N / OUT_HZ, T_GOAL - T_START))

worst = []
for pl in players:
    xs, ys = pl["x"], pl["y"]
    peak = max(math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) * OUT_HZ
               for i in range(1, len(xs)))
    worst.append((peak, pl["pos"]))
worst.sort(reverse=True)
print("  fastest: " + ", ".join("%s %.1f m/s" % (p, v) for v, p in worst[:3])
      + "  (measured, bar the de-glitching below)")
tot = sum(n for _, n in CLEANED)
print("  de-glitched %d of %d samples (%.2f%%): %s"
      % (tot, N * (len(players) + 1), 100.0 * tot / (N * (len(players) + 1)),
         ", ".join("%s x%d" % (k, n) for k, n in sorted(CLEANED, key=lambda kv: -kv[1])) or "none"))
print("  %d airborne deliveries: %s" % (len(AIRBORNE),
      ", ".join("%.1fs apex %.1fm" % (a - T_START, k) for a, b, k in AIRBORNE)))
cross = next((i for i in range(1, N) if bx[i] >= 105 > bx[i - 1]), None)
if cross:
    print("  ball crosses the goal line at y=%.2f z=%.2f (mouth 30.34-37.66, bar 2.44)"
          % (by[cross], bz[cross]))
