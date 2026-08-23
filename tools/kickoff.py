"""Prepend a short lead-in to the football play, so the tackle can be seen coming.

The measured passage opens on the tackle itself, because that is where the
source's ball tracking begins - Metrica records the ball only while it is in
play, from 465.6 s. Everyone is already moving and the ball changes feet in the
first tenth of a second, which is too fast to read. This adds three seconds in
front of it: a goal kick, the ball controlled in midfield, and then the tackle
exactly where the clip used to start.

None of it happened. It is the second piece of authored movement in the app,
after the gridiron celebration, and it is marked the same way -
`meta.measuredFrom` says how many frames at the head of the file are invented,
so the boundary stays visible in the data.

What it is built from is real, though. The kick is taken by whichever defender
is deepest at the tackle - PLAYER25, the goalkeeper, at x 97.5 - and it is
played to the man who actually gets dispossessed, PLAYER22, standing 2 m from
the ball when the measured data begins. Every player is walked backwards from
the position and the velocity they genuinely have on the first measured frame,
so the join is continuous rather than a cut.

    propy kickoff.py

Re-running trims any lead-in already on the file first, so it is safe to run
repeatedly while tuning the numbers below.
"""
import json, math, os
import os


def out_path(*parts):
    """Somewhere under the app, from tools/. Created if it is not there yet."""
    dst = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", *parts))
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    return dst

LEAD_S = 3.0          # seconds of lead-in
REST = 0.30           # ball sits at the keeper's feet this long
FLIGHT = 1.90         # then this long in the air
BACK = 0.55           # how far back a player starts, as a fraction of v * LEAD
START_V = 0.60        # and how much of their final speed they start with
TOUCH = 0.15          # a controlling touch keeps this much of the ball's pace
G = 9.80665
REST_Z = 0.11         # ball radius: on the ground


def hermite(p0, v0, p1, v1, T, t):
    """Cubic through p0 and p1, leaving at v0 and arriving at v1."""
    s = max(0.0, min(1.0, t / T))
    h00 = 2 * s ** 3 - 3 * s ** 2 + 1
    h10 = s ** 3 - 2 * s ** 2 + s
    h01 = -2 * s ** 3 + 3 * s ** 2
    h11 = s ** 3 - s ** 2
    return tuple(h00 * a + h10 * T * u + h01 * b + h11 * T * w
                 for a, u, b, w in zip(p0, v0, p1, v1))


def add_kickoff(out):
    hz = out["meta"]["hz"]
    lead = int(round(LEAD_S * hz))
    players, ball, events = out["players"], out["ball"], out["events"]
    length = out.get("space", {}).get("length", 105.0)
    width = out.get("space", {}).get("width", 68.0)

    # Idempotent: drop any lead-in already there, and put the events back where
    # the measured data has them.
    had = out["meta"].get("measuredFrom", 0)
    if had:
        for p in players:
            p["x"] = p["x"][had:]; p["y"] = p["y"][had:]; p["dir"] = p["dir"][had:]
        for k in ("x", "y", "z"):
            ball[k] = ball[k][had:]
        events.pop("kick", None)
        for k in list(events):
            events[k] -= had

    def vel(p):
        """Velocity on the first measured frame, over 0.3 s so one noisy sample
        cannot throw the whole approach."""
        k = 3
        return ((p["x"][k] - p["x"][0]) * hz / k, (p["y"][k] - p["y"][0]) * hz / k)

    # --- the players, walked backwards ------------------------------------
    paths = {}
    for p in players:
        v = vel(p)
        p0 = (p["x"][0], p["y"][0])
        start = (p0[0] - v[0] * LEAD_S * BACK, p0[1] - v[1] * LEAD_S * BACK)
        v_start = (v[0] * START_V, v[1] * START_V)
        xs, ys, ds = [], [], []
        face = p["dir"][0]
        prev = None
        for i in range(lead):
            x, y = hermite(start, v_start, p0, v, LEAD_S, i / hz)
            x = min(length - 0.5, max(0.5, x))
            y = min(width - 0.5, max(0.5, y))
            if prev and math.hypot(x - prev[0], y - prev[1]) > 0.02:
                face = math.degrees(math.atan2(x - prev[0], y - prev[1])) % 360
            prev = (x, y)
            xs.append(round(x, 2)); ys.append(round(y, 2)); ds.append(round(face, 1))
        paths[id(p)] = (xs, ys, ds)

    # --- who is involved ---------------------------------------------------
    # The kick is taken by the deepest defender, which in this passage is their
    # goalkeeper; it is played to the man the tackle is about to take it from,
    # who is simply the defender nearest the ball when the data begins.
    bx0, by0 = ball["x"][0], ball["y"][0]
    keeper = max((p for p in players if p["side"] == "def"), key=lambda p: p["x"][0])
    receiver = min((p for p in players if p["side"] == "def" and p is not keeper),
                   key=lambda p: math.hypot(p["x"][0] - bx0, p["y"][0] - by0))

    at = lambda p, i: (paths[id(p)][0][i], paths[id(p)][1][i])
    land_i = min(lead - 1, int(round((REST + FLIGHT) * hz)))
    spot = at(keeper, 0)                       # the ball starts at his feet
    target = at(receiver, land_i)              # and is aimed where he will be

    # --- the ball ----------------------------------------------------------
    bvx = (ball["x"][3] - ball["x"][0]) * hz / 3
    bvy = (ball["y"][3] - ball["y"][0]) * hz / 3
    # The last invented frame has to hand over cleanly to the first real one.
    seam = (bx0 - bvx / hz, by0 - bvy / hz)

    flight_v = ((target[0] - spot[0]) / FLIGHT, (target[1] - spot[1]) / FLIGHT)
    settle_T = (lead - 1) / hz - (REST + FLIGHT)

    bxs, bys, bzs = [], [], []
    for i in range(lead):
        t = i / hz
        if t < REST:
            x, y, z = spot[0], spot[1], REST_Z
        elif t <= REST + FLIGHT:
            u = (t - REST) / FLIGHT
            x = spot[0] + (target[0] - spot[0]) * u
            y = spot[1] + (target[1] - spot[1]) * u
            # A true arc, so the apex follows from the hang time rather than
            # being picked: h = g T^2 / 8.
            z = REST_Z + (G / 2) * (t - REST) * (REST + FLIGHT - t)
        else:
            # Controlled: the touch kills most of the pace, and the ball is then
            # eased onto the exact position and speed the measured data starts
            # with, so nothing jumps at the join.
            x, y = hermite(target, (flight_v[0] * TOUCH, flight_v[1] * TOUCH),
                           seam, (bvx, bvy), settle_T, t - REST - FLIGHT)
            z = REST_Z
        bxs.append(round(x, 2)); bys.append(round(y, 2)); bzs.append(round(z, 2))

    # --- splice -------------------------------------------------------------
    for p in players:
        xs, ys, ds = paths[id(p)]
        p["x"] = xs + p["x"]; p["y"] = ys + p["y"]; p["dir"] = ds + p["dir"]
    ball["x"] = bxs + ball["x"]
    ball["y"] = bys + ball["y"]
    ball["z"] = bzs + ball["z"]

    for k in list(events):
        events[k] += lead
    events["kick"] = int(round(REST * hz))
    out["meta"]["measuredFrom"] = lead
    out["meta"]["frames"] += lead
    return out, keeper, receiver, max(bzs)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    src = out_path("data", "soccer.json")
    data = json.load(open(src, encoding="utf-8"))
    data, keeper, receiver, apex = add_kickoff(data)
    json.dump(data, open(src, "w", encoding="utf-8"),
              separators=(",", ":"), ensure_ascii=False)
    hz = data["meta"]["hz"]
    print("wrote %s  %.1f KB" % (src, os.path.getsize(src) / 1024))
    print("  %.1f s lead-in + %.1f s measured = %.1f s"
          % (LEAD_S, (data["meta"]["frames"] - data["meta"]["measuredFrom"]) / hz,
             data["meta"]["frames"] / hz))
    print("  kick by %s -> controlled by %s, apex %.1f m" % (keeper["pos"], receiver["pos"], apex))
    print("  events:", {k: round(v / hz, 1) for k, v in sorted(data["events"].items(),
                                                               key=lambda kv: kv[1])})
