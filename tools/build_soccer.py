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
import csv, json, math, os, sys
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

# The passages the app offers, all from Sample Game 2.
#
#   propy build_soccer.py            # the turnover, as before
#   propy build_soccer.py header     # the cross and the headed finish
#   propy build_soccer.py counter    # an interception broken away from
#
# The ball is only tracked while it is in play; the players are tracked
# throughout. So a passage starts where the ball's own record starts, and where
# that record has a hole in the middle - the tracker losing it in a tackle for
# under a second - `bridge` says it may be drawn straight across. Anything
# longer than a second or two is a dead ball and is not bridged: that would be
# inventing a phase of play rather than papering over a dropout.
#
# `events` may be given by hand where the interesting moments are not the ones
# the event file marks. Left out, they are derived from the file - see
# derive_events().
PASSAGES = {
    "turnover": {
        "period": "1", "start": 465.6, "goal": 488.1, "end": 500.0,
        "out": "soccer.json", "title": "Turnover to goal",
        "label": "Turnover to goal",
        "description": ("Won by a tackle in midfield, worked through eight passes "
                        "and a switch of play, then crossed and finished first time."),
        "credit": "First half, anonymised sample match",
        "lead_in": True,
        # Hand-picked: the switch of play is the moment that makes this passage
        # what it is, and the event file records it as one more pass.
        "events": {"win": 465.6, "switch": 482.8, "cross": 487.2,
                   "goal": 488.1, "celebration": 492.2}
    },
    "header": {
        "period": "2", "start": 2943.8, "goal": 2959.3, "end": 2971.0,
        "out": "soccer_header.json", "title": "Cross and header",
        "label": "Cross and header",
        "description": ("Won back in midfield, lost to a tackle and won straight "
                        "back, then crossed and headed in."),
        "credit": "Second half, anonymised sample match",
        "bridge": [(2954.2, 2955.1)]
    },
    "counter": {
        "period": "1", "start": 2100.3, "goal": 2122.0, "end": 2133.0,
        "out": "soccer_counter.json", "title": "Intercept and break",
        "label": "Intercept and break",
        "description": ("A goal kick headed clear, intercepted, and carried the "
                        "length of the pitch in five passes."),
        "credit": "First half, anonymised sample match"
    },
}

KEY = (sys.argv[1] if len(sys.argv) > 1 else "turnover").lower()
if KEY not in PASSAGES:
    raise SystemExit("unknown passage %r; try one of %s" % (KEY, ", ".join(PASSAGES)))
SPEC = PASSAGES[KEY]
PERIOD = SPEC["period"]
T_START, T_GOAL, T_END = SPEC["start"], SPEC["goal"], SPEC["end"]


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


def bridge_ball(spans):
    """Draw the ball straight across a dropout the tracker had.

    Only where the passage asks for it, and only over the span it names. The
    ball is measured either side; in between it was being contested at boot
    level and the tracker lost sight of it for under a second. A straight line
    between two known positions a few metres apart is the smallest thing that
    can be said, and it is recorded in meta so the file admits to it.
    """
    filled = []
    for (a, b) in spans or []:
        fa = [f for f in ball_raw if times.get(f, 0) <= a]
        fb = [f for f in ball_raw if times.get(f, 0) >= b]
        if not fa or not fb:
            continue
        f_a, f_b = max(fa), min(fb)
        pa, pb = ball_raw[f_a], ball_raw[f_b]
        for f in range(f_a + 1, f_b):
            if f in ball_raw or f not in times:
                continue
            u = (f - f_a) / (f_b - f_a)
            ball_raw[f] = (pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u)
        filled.append({"fromS": round(times[f_a], 2), "toS": round(times[f_b], 2),
                       "frames": f_b - f_a - 1,
                       "metres": round(math.hypot((pb[0] - pa[0]) * L,
                                                  (pb[1] - pa[1]) * W), 1)})
    return filled


# --- reacquisitions --------------------------------------------------------
# Distinct from a dropout, and needing a different repair. Here the tracker does
# not lose the ball, it loses track of *which* thing is the ball, and picks it
# up again somewhere else: the position steps several metres between two
# consecutive frames and then carries on smoothly. On screen the ball darts
# sideways and back with nobody near it, which is the one thing in a replay of
# measured data that looks like a bug rather than like football.
#
# Speed alone cannot find these, because a struck ball also jumps in one frame -
# a shot leaves the foot at 27 m/s from a standing start. What separates them is
# what happens next: a struck ball stays fast, and a reacquisition is followed by
# a ball barely moving. Measured over the three passages here, the rule finds one
# event - a 3.8 m step at 94 m/s followed by 3.8 m/s - and leaves every frame of
# the shot that scores the first goal alone.
STEP_MS = 25.0        # a step faster than this is either a strike or an error
AFTER_MS = 8.0        # ...and if the ball is slower than this after it, an error
LOOK = 5              # frames to judge "after" over
BLEND_S = 1.8         # seconds over which the step is absorbed


def mend_ball():
    """Smooth out any place the tracker jumped to a different object."""
    fs = sorted(ball_raw)
    mended = []

    def speed(i):
        dt = times[fs[i]] - times[fs[i - 1]]
        if dt <= 0 or dt > 0.2:
            return None
        a, b = ball_raw[fs[i - 1]], ball_raw[fs[i]]
        return math.hypot((b[0] - a[0]) * L, (b[1] - a[1]) * W) / dt

    for i in range(1, len(fs)):
        sp = speed(i)
        if sp is None or sp < STEP_MS:
            continue
        after = [speed(j) for j in range(i + 1, min(i + 1 + LOOK, len(fs)))]
        after = [v for v in after if v is not None]
        if not after or sum(after) / len(after) >= AFTER_MS:
            continue                          # a struck ball; leave it be
        # Absorb the step rather than draw a line to it.
        #
        # Drawing a straight line from a fixed point to where the ball
        # reappeared was the obvious repair and it is wrong: the line leaves at
        # its own angle, so the ball swings off its measured course, runs to the
        # new position and turns back. That is the same dart the step made, just
        # drawn instead of jumped, and it still happens with nobody near it.
        #
        # What has to go is the corner, not the gap. The offset between the two
        # sides of the seam is spread backwards over the preceding frames with a
        # smoothstep weight, which is flat at both ends - so the ball keeps the
        # shape of its own measured motion and is eased sideways onto the new
        # line without ever changing direction sharply.
        pa, pb = ball_raw[fs[i - 1]], ball_raw[fs[i]]
        off = (pb[0] - pa[0], pb[1] - pa[1])
        span = 0
        while span < len(fs) - 1 and times[fs[i - 1]] - times[fs[i - 1 - span]] < BLEND_S:
            span += 1
        if span < 2:
            continue
        for k in range(i - span, i):
            u = (k - (i - span)) / span
            w = u * u * (3 - 2 * u)               # smoothstep: flat at both ends
            base = ball_raw[fs[k]]
            ball_raw[fs[k]] = (base[0] + off[0] * w, base[1] + off[1] * w)
        mended.append({"atS": round(times[fs[i]], 2),
                       "stepM": round(math.hypot(off[0] * L, off[1] * W), 1),
                       "blendedOverS": round(times[fs[i - 1]] - times[fs[i - span]], 2)})
    return mended


MENDED = mend_ball()
BRIDGED = bridge_ball(SPEC.get("bridge"))

# Which way the scoring team is playing, taken from where the ball finishes
# rather than assumed. Teams change ends at half time, so a passage in the
# second half attacks the opposite way to one in the first, and a goal for the
# away side attacks the opposite way again.
_goal_f = min(ball_raw, key=lambda f: abs(times.get(f, 0) - T_GOAL))
ATTACKS_PLUS_X = ball_raw[_goal_f][0] > 0.5
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
    """Put the scoring team's attack along +x, matching the gridiron play and
    the way the goals are placed.

    Rotating rather than mirroring keeps left and right the right way round.
    Whether a rotation is needed at all depends on the half and on which side
    scored, so it is read off the ball's own finishing position rather than
    written down here and quietly falsified by the next passage."""
    if ATTACKS_PLUS_X:
        return (p[0] * L, p[1] * W)
    return (L - p[0] * L, W - p[1] * W)


def present(track):
    """Only players on the pitch for the whole window; substitutes are blank."""
    keys = None
    for fr in frames:
        here = set(track[fr])
        keys = here if keys is None else (keys & here)
    return sorted(keys, key=lambda s: int(s.replace("Player", "")))


def events_in(t0, t1, period=None):
    """The source's own events over a span, in order."""
    out = []
    with open(os.path.join(HERE, "ev2.csv"), encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            if r["Period"] != (period or PERIOD):
                continue
            try:
                st = float(r["Start Time [s]"])
            except ValueError:
                continue
            if t0 <= st <= t1:
                out.append((st, r["Team"], r["Type"], (r["Subtype"] or "").upper(),
                            r["From"], r["To"]))
    return out


# "Attacker" means the side that scores, which is not always the home one.
_shot = next(((st, team) for st, team, ty, sub, _f, _t
              in events_in(T_GOAL - 0.6, T_GOAL + 0.6)
              if ty == "SHOT" and "GOAL" in sub), None)
assert _shot, "no goal in the event file at %.1f s" % T_GOAL
SCORER_IS_HOME = _shot[1] == "Home"
att_track, def_track = (home, away) if SCORER_IS_HOME else (away, home)
att_keys, def_keys = present(att_track), present(def_track)
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
    xs, ys, ds = track_of(att_track, k)
    players.append({"name": "Attacker", "jersey": "", "side": "off",
                    "pos": k.upper(), "x": xs, "y": ys, "dir": ds})
for k in def_keys:
    xs, ys, ds = track_of(def_track, k)
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
HEAD_M = 2.05                   # where a ball has to be to be headed


def met_in_the_air(t):
    """Was the ball headed, or challenged for in the air, at about time t?

    This is what decides whether a delivery is allowed to finish on the ground.
    A cross that ends up on somebody's head cannot arrive at ankle height, and
    modelling it as a parabola that returns to zero - which is what a delivery
    to feet does - put the ball on the turf at the exact moment it was headed
    into the net.
    """
    for st, _team, ty, sub, _f, _to in events_in(t - 0.45, t + 0.45):
        if ty == "CHALLENGE" and "AERIAL" in sub:
            return True
        if "HEAD" in sub:
            return True
    return False


def ball_events():
    """Deliveries that leave the ground, as (start, end, apex, kind)."""
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
            hang = 9.80665 * (b - a) ** 2 / 8
            if r["Type"] == "SHOT":
                # A header at goal starts at head height and goes down into it,
                # rather than rising from the floor.
                kind = "from_head" if "HEAD" in sub else "arc"
                out.append((a, b, min(0.6, hang), kind))
            elif "CROSS" in sub or d >= LOFT_MIN_M:
                kind = "to_head" if met_in_the_air(b) else "arc"
                # A delivery to be headed has to carry: its own hang time gives
                # a driven cross an apex of a metre and a half, which is under
                # the height it has to arrive at.
                apex = min(APEX_CAP, hang)
                if kind == "to_head":
                    apex = min(APEX_CAP, max(apex, HEAD_M))
                out.append((a, b, apex, kind))
    return out


AIRBORNE = ball_events()
bz = []
for i in range(N):
    t = T_START + i / OUT_HZ
    z = 0.11
    for (a, b, apex, kind) in AIRBORNE:
        if not (a <= t <= b):
            continue
        u = (t - a) / (b - a)
        if kind == "to_head":
            # Rises and stays up: a parabola with a ramp under it, so it leaves
            # the ground and arrives at the height it is met.
            h = 0.11 + 4 * apex * u * (1 - u) * (1 - u) + HEAD_M * u
        elif kind == "from_head":
            # Struck downwards off the forehead.
            h = 0.11 + HEAD_M * (1 - u) ** 2
        else:
            h = 0.11 + 4 * apex * u * (1 - u)
        z = max(z, h)
    bz.append(round(z, 2))

# --- markers on the transport bar ------------------------------------------
# What a viewer should be told is happening, and when.
#
# A passage may name its own moments - the switch of play in the turnover is one
# pass among nine in the event file and the whole point of the move on screen -
# but left to itself this reads them off the source. Not every event: a passage
# runs to twenty of them and a timeline of twenty marks is a smear. Only the
# turns of possession, the delivery and the finish, which is what anyone
# watching would call out.
MARKS = [
    # (Type, Subtype fragment, key, label rank - lower survives crowding)
    ("SHOT", "GOAL", "goal", 0),
    ("PASS", "CROSS", "cross", 1),
    ("CHALLENGE", "TACKLE-WON", "win", 2),
    ("RECOVERY", "INTERCEPTION", "intercept", 3),
    ("CHALLENGE", "AERIAL-WON", "aerial", 4),
    ("PASS", "GOAL KICK", "kick", 5),
    ("SET PIECE", "FREE KICK", "freekick", 5),
    # Last, so a plain recovery only claims a moment no better-named event has.
    ("RECOVERY", "", "recover", 6),
]
MAX_MARKS = 5


def derive_events():
    """The moments worth marking, from the source's own event list."""
    found = []
    for st, team, ty, sub, _from, _to in events_in(T_START - 0.2, T_GOAL + 0.2):
        for want_ty, want_sub, key, rank in MARKS:
            if ty != want_ty or want_sub not in sub:
                continue
            # Only the scoring side's turnovers: the other team winning it back
            # is the same instant seen from the other side, and marking both
            # puts two labels on one tick.
            if key != "goal" and team != ("Home" if SCORER_IS_HOME else "Away"):
                break
            found.append((st, key, rank))
            break
    # One mark per moment, and never two within a second of each other.
    found.sort(key=lambda e: (e[0], e[2]))
    kept = []
    for st, key, rank in found:
        if kept and st - kept[-1][0] < 1.0:
            continue
        kept.append((st, key, rank))
    # If it is still crowded, drop the least interesting from the middle - the
    # goal and the first thing that happens always stay.
    while len(kept) > MAX_MARKS:
        middle = kept[1:-1]
        worst = max(middle, key=lambda e: e[2])
        kept.remove(worst)
    # A passage should say how it starts. Without this the counter opens with
    # fourteen seconds of unexplained football before its first mark.
    if not kept or kept[0][0] - T_START > 2.0:
        first = events_in(T_START - 0.2, T_START + 1.5)
        if first:
            st, _team, ty, sub, _f, _t = first[0]
            key = ("kick" if "GOAL KICK" in sub else
                   "freekick" if ty == "SET PIECE" else
                   "recover" if ty == "RECOVERY" else "start")
            kept.insert(0, (st, key, 9))

    out = {}
    for st, key, _rank in kept:
        # Two of a kind in one passage - it happens - get a number.
        name, n = key, 2
        while name in out:
            name, n = "%s%d" % (key, n), n + 1
        out[name] = st
    out["goal"] = T_GOAL
    return out


raw_events = SPEC.get("events") or derive_events()
if "celebration" not in raw_events:
    # Not an event in the source data - the source stops at the goal. Taken as
    # the moment the scoring side stops running at the ball and starts running
    # away from it, which in the turnover passage measured 4.1 s after the shot.
    raw_events["celebration"] = min(T_GOAL + 4.1, T_END - 0.6)
events = {k: int(round((t - T_START) * OUT_HZ)) for k, t in raw_events.items()}

out = {
    "meta": {
        "hz": OUT_HZ, "frames": N,
        "sport": "football",
        "title": SPEC["title"],
        "description": SPEC["description"],
        "credit": SPEC["credit"],
        "source": "Metrica Sports open sample data, 25 Hz resampled to 10",
        "sourceShort": "Metrica Sports’ open sample data",
        "measured": True,
        "carrier": None,
        # Where the tracker lost the ball and the file draws a straight line.
        # Absent when it did not; see bridge_ball().
        **({"bridged": BRIDGED} if BRIDGED else {}),
        # Where the tracker jumped to a different object and the step was
        # walked out; see mend_ball().
        **({"mended": MENDED} if MENDED else {})
    },
    "events": events,
    "space": {"length": L, "width": W, "unit": "m"},
    "surface": "pitch",
    "ball": {"x": bx, "y": by, "z": bz, "radius": 0.11},
    "players": players
}

# The three staged seconds in front of the tackle; see kickoff.py. Only the
# turnover passage needs them - it opens on the tackle itself, because that is
# where its ball tracking begins. The others start on a recovery with the move
# still in front of them.
if SPEC.get("lead_in"):
    out, _kicker, _receiver, _apex = add_kickoff(out)

# Same shape as the gridiron file: no fields the renderer never reads.
out = anonymise(out)

dst = out_path("data", SPEC["out"])
# ensure_ascii=False to match kickoff.py, which also writes these files.
# Without it the two disagree about how to spell an apostrophe and the
# committed file depends on which script ran last.
json.dump(out, open(dst, "w", encoding="utf-8"),
          separators=(",", ":"), ensure_ascii=False)
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
      ", ".join("%.1fs %s apex %.1fm" % (a - T_START, kind, k)
                    for a, b, k, kind in AIRBORNE)))
cross = next((i for i in range(1, N) if bx[i] >= 105 > bx[i - 1]), None)
if cross:
    print("  ball crosses the goal line at y=%.2f z=%.2f (mouth 30.34-37.66, bar 2.44)"
          % (by[cross], bz[cross]))
