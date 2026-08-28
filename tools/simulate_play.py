"""Play a recorded passage back as if it were happening now.

The replays in this app are real tracking - twenty-two people and a ball at
10 Hz, from the NFL Big Data Bowl and from Metrica - but they are a recording,
and a recording is not a feed. This turns one into the other: it walks the
frames on a clock and posts each one to an ArcGIS Velocity HTTP Receiver, in the
shape a live tracking feed would arrive in.

    propy simulate_play.py                       # gridiron, to stdout
    propy simulate_play.py --play football
    propy simulate_play.py --url http://localhost:8799/  --loop
    propy simulate_play.py --url https://...velocity.../  --rate 0.5
    propy simulate_play.py --out frames.json     # the whole passage, no clock

## What Velocity is being asked to do with it

Nothing here computes speed, distance or possession, and that is deliberate.
Those are what Velocity is for - Calculate Motion Statistics reads the last n
observations of a track and returns speed, acceleration, distance travelled and
whether it is idling; Join Features puts each player against the ball; Detect
Incidents opens and closes on a condition. Computing them here and shipping the
answers would make this a file transfer with extra steps.

So what goes out is position, identity and time, and nothing else that could be
derived from them.

## The one field that matters more than it looks: `t`

`t` is seconds into the passage, and it is what makes this usable rather than
merely impressive.

The app's replay is scrubbable. It can be paused, restarted, dragged to the
catch and dragged back. A stream is a wall clock and cannot be dragged. Key the
analytics to wall-clock time and they are right only while nobody touches the
transport - and the moment somebody does, the numbers on screen belong to a
different instant than the players on screen, which is worse than having no
numbers at all.

Keyed to `t` instead, the client holds observations by their place in the
passage and shows whichever one matches its own playhead. Scrubbing works.
Pausing works. Network jitter stops mattering, because the stream can run ahead
of real time and fill the buffer. The app keeps the clock; Velocity keeps the
arithmetic.

`ts` is still there and is still the wall clock, because Velocity wants a time
field of its own and because the archive should record when a thing was
observed. The two are not interchangeable and the client must use `t`.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from playfield import Field, load, phases, tracks, PLAYS  # noqa: E402

# The receiver takes a JSON array, so a frame goes as one request rather than
# twenty-three. At 10 Hz that is ten requests a second instead of two hundred
# and thirty, for the same events and the same latency.
BATCH_BY_FRAME = True


def observations(data, play_key):
    """Every observation in the passage, in frame order."""
    field = Field(data)
    hz = float(data["meta"]["hz"])
    n = int(data["meta"]["frames"])
    ppl = tracks(data)
    phase = phases(data)
    ball = data["ball"]

    for f in range(n):
        t = round(f / hz, 3)
        frame = []
        for p in ppl:
            lon, lat = field.to_world(p["x"][f], p["y"][f])
            ob = {
                "play": play_key,
                "kind": "player",
                "track": p["track"],
                "side": p["side"],
                "pos": p["pos"],
                "frame": f,
                "t": t,
                "phase": phase[f],
                "lon": round(lon, 7),
                "lat": round(lat, 7),
                # Players are on the ground. The ball is the only thing with a
                # height, and it is the height that makes a pass a pass.
                "z": 0.0,
            }
            if p["dir"] is not None:
                ob["heading"] = round(field.heading(p["dir"][f]), 1)
            frame.append(ob)

        lon, lat = field.to_world(ball["x"][f], ball["y"][f])
        frame.append({
            "play": play_key,
            "kind": "ball",
            # The ball is a track like any other, because Join Features needs
            # something to join the players *to*, and because its own speed is
            # worth having: a throw and a handoff are the same event to a
            # possession rule and nothing alike to a speedometer.
            "track": "ball",
            "side": "ball",
            "pos": "BALL",
            "frame": f,
            "t": t,
            "phase": phase[f],
            "lon": round(lon, 7),
            "lat": round(lat, 7),
            "z": round(float(ball["z"][f]), 2),
        })
        yield f, t, frame


def post(url, payload, timeout=5):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.status


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--play", default="gridiron",
                    help="one of: %s" % ", ".join(PLAYS))
    ap.add_argument("--url", help="Velocity HTTP Receiver endpoint")
    ap.add_argument("--rate", type=float, default=1.0,
                    help="clock multiplier; 2 is twice as fast, 0 is no wait")
    ap.add_argument("--loop", action="store_true", help="run the passage on repeat")
    ap.add_argument("--out", help="write every observation to a file and stop")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    data = load(args.play)
    meta = data["meta"]
    n, hz = int(meta["frames"]), float(meta["hz"])
    print("%s — %d frames at %g Hz (%.1f s), %d players + ball"
          % (args.play, n, hz, n / hz, len(data["players"])))
    print("   %s" % (meta.get("description") or meta.get("game") or ""))

    if args.out:
        every = [ob for _f, _t, frame in observations(data, args.play)
                 for ob in frame]
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(every, fh)
        print("wrote %d observations to %s (%.0f kB)"
              % (len(every), args.out, os.path.getsize(args.out) / 1024.0))
        return

    if not args.url:
        for _f, _t, frame in observations(data, args.play):
            for ob in frame:
                print(json.dumps(ob))
        return

    step = (1.0 / hz) / args.rate if args.rate > 0 else 0.0
    sent = failed = laps = 0
    print("posting to %s at %g Hz%s"
          % (args.url, hz * args.rate, " on repeat" if args.loop else ""))
    print("   Ctrl-C to stop")
    try:
        while True:
            t0 = time.time()
            for f, t, frame in observations(data, args.play):
                stamp = time.strftime("%Y-%m-%dT%H:%M:%S",
                                      time.gmtime()) + "Z"
                for ob in frame:
                    ob["ts"] = stamp
                try:
                    if BATCH_BY_FRAME:
                        post(args.url, frame)
                    else:
                        for ob in frame:
                            post(args.url, ob)
                    sent += len(frame)
                except (urllib.error.URLError, OSError) as err:
                    failed += 1
                    if failed <= 3:
                        print("  ! %s" % err)
                if not args.quiet and f % 50 == 0:
                    print("  t=%5.1fs  frame %3d/%d  sent %d" % (t, f, n, sent))
                # Paced against the wall clock rather than by sleeping a fixed
                # step: posting takes time, and sleeping the full interval on
                # top of it drifts slower and slower behind the passage it is
                # meant to be replaying.
                if step:
                    due = t0 + (f + 1) * step
                    late = due - time.time()
                    if late > 0:
                        time.sleep(late)
            laps += 1
            if not args.loop:
                break
    except KeyboardInterrupt:
        print("\nstopped")
    print("%d observations, %d laps, %d failed requests" % (sent, laps, failed))


if __name__ == "__main__":
    main()
