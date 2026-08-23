"""Append a celebration to a gridiron play.

Everything the app animates is measured tracking data, with one exception, and
this is it. The league's tracking window closes about a second after the ball
crosses the line, so the clip ended on a receiver still running flat out with
nobody within twenty yards of him. What this adds is the few seconds that
follow: the nearest team-mates run in and mob him, the rest of the offence jogs
up and pulls short, and the defence walks back upfield.

Where they mob him depends on what the play was. A touchdown is celebrated in
the end zone it was scored in - either end; the app's two touchdowns score at
opposite ends of the field. A kick has no end zone to run to, because the ball
is in the air and nobody has crossed a line, so the unit converges on the kicker
where he stands.

No measured frame is touched. `meta.measuredFrames` records where the tracking
data stops, so the boundary stays visible in the file itself.

Two ways in:

  from celebrate import add_celebration        # build_play.py uses this
  add_celebration(out)

  propy celebrate.py                           # re-run it on an existing
                                               # play.json, which is what you
                                               # want when the source CSV is
                                               # not on the machine

Re-running on a file that already carries a tail trims the old one first, so it
is safe to run repeatedly while tuning the numbers below.
"""
import json, math, os
import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    dst = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

CEL_S = 8.0        # seconds of celebration
JOINERS = 3        # team-mates who reach the huddle
RING = 2.0         # yards they pull up short of the scorer
# Spacing has to survive the milling: two neighbours swinging in antiphase
# close by twice the wobble, so SEP is set well clear of 2 * WOBBLE or
# they walk through each other.
SEP = 50.0         # degrees, minimum spacing around the huddle
WOBBLE = 0.18      # radians, how far each man swings about his slot
# Real limits, in yards per second squared. Braking is the stronger of the
# two, as it is in a person: a receiver at 9 yd/s cannot be stopped inside
# the two yards the huddle is wide, and an even smoothing on velocity does
# not try - it sails him through the middle of the group and out the far
# side, which is what the first version of this did.
ACC = 5.0          # speeding up
BRK = 8.0          # slowing down
TURN = 300.0       # degrees a second; the measured data sits under this 99%
                   # of the time, and a cap stops a man snapping round on the
                   # frame he changes what he is looking at
TOP = {"scorer": 6.0, "mate": 9.0, "off": 4.5, "def": 2.2}   # yd/s
MARK = 2.8         # when the "Celebration" marker sits, seconds in
BACK_SEP = 16.0    # degrees between the men who pull up short
BACK_R = (10.0, 11.7, 13.4)   # and the ranks they stop on, in yards
MIN_GAP = 1.15     # yards centre to centre; a mob, but not men inside men
DECAY = 0.90       # how fast a separation nudge fades once the clash is over
NUDGE_STEP = 0.05  # and the most it may change in one frame, in yards


def add_celebration(out):
    hz = out["meta"]["hz"]
    n = out["meta"].get("measuredFrames") or out["meta"]["frames"]
    players, ball, events = out["players"], out["ball"], out["events"]

    # Trimming first makes the function idempotent, so tuning is a re-run
    # rather than a rebuild from the raw tracking data.
    for p in players:
        p["x"] = p["x"][:n]; p["y"] = p["y"][:n]; p["dir"] = p["dir"][:n]
    for k in ("x", "y", "z"):
        ball[k] = ball[k][:n]
    events.pop("celebration", None)

    cel_n = int(round(CEL_S * hz))
    last = n - 1
    width = out.get("space", {}).get("width", 53.333)
    length = out.get("space", {}).get("length", 120.0)

    # An index once the file has been anonymised, a name before that.
    who = out["meta"]["carrier"]
    if isinstance(who, int):
        carry = players[who]
    else:
        carry = next(p for p in players if p.get("name") == who)

    # Where the huddle forms.
    #
    # For a touchdown, the end zone the play actually finished in - which is not
    # always the same one. This used to be the constant 5.0, which suited the
    # first play in the app because it happened to score at that end, and walked
    # the second one thirty-seven yards back up the field to celebrate in the
    # end zone it had been running away from.
    #
    # For a kick there is no end zone to run to: the ball is in the air and
    # nobody has crossed a line, so the team converges on the kicker where he
    # stands. Which of the two is decided by what the play's own events say
    # happened, rather than by anything passed in.
    if "touchdown" in events:
        rx = 5.0 if carry["x"][last] < length / 2.0 else length - 5.0
    else:
        rx = carry["x"][last]
    # Pulled a quarter of the way back toward the middle of the field so the
    # huddle is not jammed against a sideline.
    ry = carry["y"][last] + (width / 2.0 - carry["y"][last]) * 0.25

    mates = sorted((p for p in players if p["side"] == "off" and p is not carry),
                   key=lambda p: math.hypot(p["x"][last] - rx, p["y"][last] - ry))
    huddle = mates[:JOINERS]

    def spread(group, degrees):
        """Give each man a slot on the bearing he is arriving from, then push
        the slots apart until none are within `degrees` of each other. Arriving
        from your own side is what stops anybody running through anybody else,
        and it is why the huddle forms the shape the approach dictates rather
        than a drawn circle."""
        sep = degrees * math.pi / 180.0
        slots = sorted((math.atan2(p["y"][last] - ry, p["x"][last] - rx), i)
                       for i, p in enumerate(group))
        for _ in range(24):
            for a in range(len(slots) - 1):
                gap = slots[a + 1][0] - slots[a][0]
                if gap < sep:
                    push = (sep - gap) / 2.0
                    slots[a] = (slots[a][0] - push, slots[a][1])
                    slots[a + 1] = (slots[a + 1][0] + push, slots[a + 1][1])
        return slots

    role = {id(carry): ("scorer", 0.0, 0.0)}
    for slot, (ang, i) in enumerate(spread(huddle, SEP)):
        role[id(huddle[i])] = ("mate", ang, 0.7 * slot)

    # The rest of the offence jogs up and pulls short. They get spread the same
    # way and staggered over three ranks, because half of them start within a
    # yard of each other on the line and would otherwise all converge on the
    # same spot and stand inside one another.
    rest = [p for p in players if p["side"] == "off" and id(p) not in role]
    stand = {}
    for slot, (ang, i) in enumerate(spread(rest, BACK_SEP)):
        rad = BACK_R[slot % len(BACK_R)]
        stand[id(rest[i])] = (rx + rad * math.cos(ang), ry + rad * math.sin(ang))

    def goal_of(p, t, x, y):
        """Where this player is heading at t seconds into the celebration."""
        r = role.get(id(p))
        if r and r[0] == "scorer":
            # Mobbed, so barely moving: a slow drift about the spot he scored on.
            a = 2 * math.pi * t / 4.0
            return rx + 0.4 * math.cos(a), ry + 0.4 * math.sin(a), TOP["scorer"]
        if r:
            _, base, ph = r
            # Far out he runs straight at the huddle on his own line, and only
            # settles into his allotted slot over the last few yards. Aiming at
            # the slot from the start swung his whole run sideways and took him
            # through whoever was already standing there.
            own = math.atan2(y - ry, x - rx)
            w = max(0.0, min(1.0, (math.hypot(x - rx, y - ry) - RING) / 8.0))
            off = ((own - base + math.pi) % (2 * math.pi)) - math.pi
            a = base + off * w + WOBBLE * math.sin(2 * math.pi * t / 3.4 + ph)
            rad = RING + 0.30 * math.sin(2 * math.pi * t / 2.1 + ph * 1.7)
            return rx + rad * math.cos(a), ry + rad * math.sin(a), TOP["mate"]
        if p["side"] == "off":
            gx, gy = stand[id(p)]
            return gx, gy, TOP["off"]
        return p["x"][last] + 25.0, p["y"][last], TOP["def"]   # defence walks off

    def start_speed(p):
        """Velocity at the last measured frame, taken over 0.3 s so one noisy
        sample cannot fling somebody across the field on the first synthesised
        frame."""
        k = 3
        vx = (p["x"][last] - p["x"][last - k]) * hz / k
        vy = (p["y"][last] - p["y"][last - k]) * hz / k
        s = math.hypot(vx, vy)
        return [vx * 9.5 / s, vy * 9.5 / s] if s > 9.5 else [vx, vy]

    def run(p):
        """Pursuit of that goal under an acceleration limit. Limiting the
        change in velocity rather than easing the position is what keeps the
        first synthesised frame continuous with the last measured one - a man
        running at 9 yd/s does not stop dead - and what stops the darting an
        ease on position produces."""
        x, y = p["x"][last], p["y"][last]
        v = start_speed(p)
        face = p["dir"][last]
        xs, ys, ds = [], [], []
        for i in range(cel_n):
            gx, gy, top = goal_of(p, (i + 1) / hz, x, y)
            dx, dy = gx - x, gy - y
            d = math.hypot(dx, dy)
            # Approach at the fastest speed he could still pull up from, so he
            # arrives on his spot rather than through it.
            want = min(top, math.sqrt(2.0 * BRK * max(d - 0.15, 0.0)))
            vdx = dx / d * want if d > 1e-6 else 0.0
            vdy = dy / d * want if d > 1e-6 else 0.0
            ax, ay = vdx - v[0], vdy - v[1]
            mag = math.hypot(ax, ay)
            cap = (BRK if want < math.hypot(v[0], v[1]) else ACC) / hz
            if mag > cap:
                ax, ay = ax * cap / mag, ay * cap / mag
            v[0] += ax; v[1] += ay
            x = min(length - 0.6, max(0.6, x + v[0] / hz))
            y += v[1] / hz
            # Facing. Running men look where they are going. Once a man is in
            # the huddle he looks in at it, whether or not he happens to be
            # moving - keying that off speed alone had two of the three staring
            # off sideways, because jostling round the ring is movement too.
            # The scorer turns on the spot, being mobbed from all sides.
            here = math.hypot(x - rx, y - ry) < 4.5
            if role.get(id(p), ("",))[0] == "scorer" and here:
                want = p["dir"][last] + 45.0 * (i + 1) / hz
            elif id(p) in role and here:
                want = math.degrees(math.atan2(rx - x, ry - y))
            elif math.hypot(v[0], v[1]) > 0.7:
                want = math.degrees(math.atan2(v[0], v[1]))
            else:
                want = face
            step = ((want - face + 540) % 360) - 180
            face = (face + max(-TURN / hz, min(TURN / hz, step))) % 360
            ds.append(round(face, 1))
            xs.append(round(x, 2)); ys.append(round(y, 2))
        return xs, ys, ds

    for p in players:
        xs, ys, ds = run(p)
        p["x"] += xs; p["y"] += ys; p["dir"] += ds

    # A light pass over the tail before the separation check below - the
    # order matters, because smoothing afterwards would blur men back into
    # each other.
    # Both the pursuit and the separation
    # correction are bounded per frame, but the two together still put a few
    # 12 m/s^2 spikes in - fine on paper, visible as a twitch at 10 Hz. A
    # binomial filter takes those out and moves nobody more than a couple of
    # centimetres. The measured frame before the seam is included as a fixed
    # neighbour, so the join stays continuous.
    for _ in range(2):
        for p in players:
            for key in ("x", "y"):
                a = p[key]
                sm = []
                for f in range(n, n + cel_n):
                    lo = a[f - 1]
                    hi = a[min(n + cel_n - 1, f + 1)]
                    sm.append(round((lo + 2 * a[f] + hi) / 4.0, 2))
                a[n:] = sm

    # Pursuit alone lets a man arriving late cut straight through one already
    # standing there - the last two into the huddle came within 10 cm. So the
    # tail gets a separation pass: any pair closer than MIN_GAP is pushed
    # apart, and each man's nudge is carried into the next frame and decayed
    # rather than recomputed from nothing, which is what stops the correction
    # from flickering on and off between frames.
    nudge = {id(p): [0.0, 0.0] for p in players}
    for f in range(n, n + cel_n):
        pos = {}
        for p in players:
            g = nudge[id(p)]
            g[0] *= DECAY; g[1] *= DECAY
            pos[id(p)] = [p["x"][f] + g[0], p["y"][f] + g[1]]
        for _ in range(6):
            clash = False
            for i, a in enumerate(players):
                pa = pos[id(a)]
                for b in players[i + 1:]:
                    pb = pos[id(b)]
                    dx, dy = pb[0] - pa[0], pb[1] - pa[1]
                    d = math.hypot(dx, dy)
                    if d < 1e-6:
                        dx, dy, d = 0.01, 0.0, 0.01       # exactly coincident
                    if d < MIN_GAP:
                        push = (MIN_GAP - d) / 2.0
                        ux, uy = dx / d, dy / d
                        pa[0] -= ux * push; pa[1] -= uy * push
                        pb[0] += ux * push; pb[1] += uy * push
                        clash = True
            if not clash:
                break
        for p in players:
            q = pos[id(p)]
            g = nudge[id(p)]
            # Rate-limited, because applying a whole overlap correction on the
            # frame it is discovered is a step in position - which reads as a
            # player twitching sideways, and shows up as 20 m/s^2 of implied
            # acceleration. Capped, the correction arrives over a few frames.
            for k in (0, 1):
                want = q[k] - p["x" if k == 0 else "y"][f]
                g[k] += max(-NUDGE_STEP, min(NUDGE_STEP, want - g[k]))
            p["x"][f] = round(p["x"][f] + g[0], 2)
            p["y"][f] = round(p["y"][f] + g[1], 2)

    # The ball stays in the scorer's hands, at the offset it had on the last
    # measured frame.
    bdx = ball["x"][last] - carry["x"][last]
    bdy = ball["y"][last] - carry["y"][last]
    hand = ball["z"][last]
    for i in range(cel_n):
        ball["x"].append(round(carry["x"][n + i] + bdx, 2))
        ball["y"].append(round(carry["y"][n + i] + bdy, 2))
        ball["z"].append(hand)

    events["celebration"] = n + int(round(MARK * hz))
    out["meta"]["measuredFrames"] = n
    out["meta"]["frames"] = n + cel_n
    return out, huddle


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    src = out_path("data", "play.json")
    data = json.load(open(src, encoding="utf-8"))
    data, huddle = add_celebration(data)
    json.dump(data, open(src, "w", encoding="utf-8"), separators=(",", ":"))
    hz = data["meta"]["hz"]
    print("wrote %s  %.1f KB" % (src, os.path.getsize(src) / 1024))
    print("  measured %.1f s + celebration %.1f s = %.1f s"
          % (data["meta"]["measuredFrames"] / hz, CEL_S, data["meta"]["frames"] / hz))
    print("  huddle: %s" % ", ".join(p["pos"] for p in huddle))
