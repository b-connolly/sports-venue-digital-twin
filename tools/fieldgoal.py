"""Move a measured field goal back to record distance, and fly the ball there.

The 2017 Big Data Bowl release tracks exactly one game. It contains two made
field goals, of 32 and 25 yards, and no long one exists to be used - so a record
kick cannot be taken from the data. This makes one, and is deliberately a
separate file from build_play.py so that the boundary between what was measured
and what was not stays somewhere a reader can find it.

WHAT IS REAL. The snap, the hold, the protection, the kicker's approach and
every one of the twenty-two players' positions, from the measured 32 yard
attempt (game 2017090700, play 3559). All of it is translated bodily down the
field - the same movement, further out - which changes where the play happens
and nothing about how it happens. Nobody's motion relative to anyone else is
touched.

WHAT IS NOT. The ball, from the moment it leaves the foot. The measured kick
carries 32 yards and this one has to carry 68, so the flight is computed rather
than tracked: a plain parabola with no drag, at a launch angle a placekicker
would actually use. The clip is also longer than the measured one, because a 68
yard kick hangs about a second and a half longer than a 32 yard kick; the extra
frames hold the last measured pose.

  hold to the posts  68 yd = 62.18 m
  launch             26.5 m/s at 37 degrees
  apex               12.9 m
  at the posts       4.5 m, which clears the 3.048 m crossbar by 1.45 m
  hang to the bar    2.94 s

68 yards is the NFL record, set by Cam Little for Jacksonville against Las Vegas
in 2025, beating the 66 Justin Tucker kicked in 2021.

`meta.modelled` records all of this in the file itself, so the app can say so in
the caption rather than the claim living only in this docstring.
"""
import math

G = 9.80665
YD = 0.9144

RECORD_YD = 68.0          # the distance being modelled
LAUNCH_DEG = 37.0         # placekickers leave the foot at 35-40
CLEAR_M = 4.5             # height as it crosses the bar; the bar is at 3.048
POSTS_X = 120.0           # back of the end zone, in the source's yard frame
SETTLE_S = 0.6            # a little after it comes down, before the clip ends


def _speed_for(distance_m, clear_m, deg):
    """Launch speed that puts the ball `clear_m` up after `distance_m`.

    From z = x tan0 - g x^2 / (2 v^2 cos^2 0), solved for v. Chosen this way
    round because what matters is that it clears the bar by a believable margin
    - a record kick should look close - rather than that it lands anywhere in
    particular.
    """
    a = math.radians(deg)
    drop = distance_m * math.tan(a) - clear_m
    if drop <= 0:
        raise ValueError("that angle clears the bar at any speed")
    return math.sqrt(G * distance_m ** 2 / (2 * math.cos(a) ** 2 * drop))


def to_record(out, kick_event="field_goal_attempt", good_event="field_goal"):
    """Rewrite a measured field goal as a record-distance one.

    Takes and returns the dict build_play.py assembles, in the source's own
    yard frame, before it is handed to anonymise().
    """
    hz = out["meta"]["hz"]
    ball, players = out["ball"], out["players"]
    kick_f = out["events"].get(kick_event)
    if kick_f is None:
        raise ValueError("no %s event; is this a field goal?" % kick_event)

    # --- how far to move it -------------------------------------------------
    # Not the kick frame: on that frame the ball has already left the hold and
    # is a few yards downfield, which reads as a 28 yard attempt when the play
    # is a 32. The hold is where the ball stops going backwards - it travels
    # away from the line from the snap, sits, and then goes the other way.
    snap_f = out["events"].get("ball_snap", 0)
    window = range(snap_f, min(kick_f + 1, len(ball["x"])))
    hold_f = min(window, key=lambda i: ball["x"][i])
    spot_x, hold_y = ball["x"][hold_f], ball["y"][hold_f]
    was_yd = POSTS_X - spot_x
    shift = RECORD_YD - was_yd          # yards to move everyone back

    for p in players:
        p["x"] = [round(x - shift, 2) for x in p["x"]]
    ball["x"] = [round(x - shift, 2) for x in ball["x"]]
    spot_x -= shift

    # --- how long the flight takes ------------------------------------------
    dist_m = RECORD_YD * YD
    v = _speed_for(dist_m, CLEAR_M, LAUNCH_DEG)
    a = math.radians(LAUNCH_DEG)
    vx, vz = v * math.cos(a), v * math.sin(a)
    to_posts = dist_m / vx                       # seconds to reach the bar
    hang = 2 * vz / G                            # and to come back to the turf
    apex = vz ** 2 / (2 * G)

    n_measured = out["meta"]["frames"]
    n_flight = int(round((kick_f / hz + hang + SETTLE_S) * hz))
    n = max(n_measured, n_flight)

    # --- the ball -----------------------------------------------------------
    # Straight at the posts, down the same line the hold was on. A real kick
    # drifts; inventing a drift as well would be inventing more than is needed.
    bx, by, bz = ball["x"][:], ball["y"][:], ball["z"][:]
    for i in range(kick_f, n):
        t = (i - kick_f) / hz
        z = vz * t - 0.5 * G * t * t
        along = vx * t / YD                      # metres of flight, in yards
        if z <= 0:                               # down, and it stays down
            z = 0.11
            along = min(along, vx * hang / YD)
        x = spot_x + along
        if i < len(bx):
            bx[i], by[i], bz[i] = round(x, 2), round(hold_y, 2), round(z, 2)
        else:
            bx.append(round(x, 2)); by.append(round(hold_y, 2)); bz.append(round(z, 2))
    ball["x"], ball["y"], ball["z"] = bx, by, bz

    # --- everyone else, for the frames the measurement does not cover --------
    # Held, not extrapolated. Walking them on from their last velocity would be
    # inventing movement; standing still while the ball is in the air is at
    # least what a kicking team does.
    for p in players:
        for k in ("x", "y", "dir"):
            last = p[k][-1]
            p[k] = p[k] + [last] * (n - len(p[k]))

    # --- events -------------------------------------------------------------
    # The measured "good" frame belonged to a kick that took 1.6 s to arrive.
    # This one takes 2.94, so it is moved to when the ball actually crosses.
    out["events"][good_event] = kick_f + int(round(to_posts * hz))
    out["meta"]["frames"] = n
    out["meta"]["modelled"] = {
        "what": "ball flight and field position",
        "distanceYd": RECORD_YD,
        "measuredDistanceYd": round(was_yd, 1),
        "movedYd": round(shift, 1),
        "launchMs": round(v, 1),
        "launchDeg": LAUNCH_DEG,
        "apexM": round(apex, 1),
        "clearsAtM": CLEAR_M,
        "toPostsS": round(to_posts, 2),
        "measuredFrames": n_measured
    }
    return out, {"v": v, "apex": apex, "to_posts": to_posts, "hang": hang,
                 "was": was_yd, "shift": shift, "n": n, "n_measured": n_measured}
