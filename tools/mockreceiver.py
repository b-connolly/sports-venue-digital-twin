"""Stand in for a Velocity HTTP Receiver, so the feed can be built without one.

An HTTP Receiver in ArcGIS Velocity is a URL that accepts a JSON object or a
JSON array and treats what arrives as features. That is a small enough contract
to imitate, and imitating it buys a lot: the simulator, the event schema and the
field transform can all be finished and checked before anybody provisions
anything, and the org side becomes a change of URL rather than the first time
the thing has ever run.

    propy mockreceiver.py               # http://localhost:8799/
    propy mockreceiver.py 8801 --save frames.jsonl

Then, in another terminal:

    propy simulate_play.py --url http://localhost:8799/

It reports what it is being sent the way a receiver's own monitoring would - a
rate, a count, the tracks it has seen - so a schema mistake or a stalled clock
shows up here rather than three steps later in an empty stream layer.

What it deliberately does not do is validate against Velocity's own rules. It
will accept things Velocity would reject. It is a wire, not a referee; the
schema is asserted in tools/simcheck.py where it can be checked properly.
"""
import argparse
import json
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {
    "events": 0, "requests": 0, "bad": 0,
    "tracks": set(), "plays": set(), "first": None, "last": None,
    "t_min": None, "t_max": None, "save": None, "reported": 0,
}


class Receiver(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception as err:
            STATE["bad"] += 1
            self.send_response(400)
            self.end_headers()
            self.wfile.write(str(err).encode("utf-8"))
            return

        obs = body if isinstance(body, list) else [body]
        now = time.time()
        STATE["requests"] += 1
        STATE["events"] += len(obs)
        STATE["first"] = STATE["first"] or now
        STATE["last"] = now
        for ob in obs:
            if isinstance(ob, dict):
                if "track" in ob:
                    STATE["tracks"].add(ob["track"])
                if "play" in ob:
                    STATE["plays"].add(ob["play"])
                t = ob.get("t")
                if isinstance(t, (int, float)):
                    STATE["t_min"] = t if STATE["t_min"] is None else min(STATE["t_min"], t)
                    STATE["t_max"] = t if STATE["t_max"] is None else max(STATE["t_max"], t)
        if STATE["save"]:
            for ob in obs:
                STATE["save"].write(json.dumps(ob) + "\n")

        # Once a second, not once a frame: at 10 Hz the log would be the thing
        # slowing the receiver down.
        if now - STATE["reported"] >= 1:
            STATE["reported"] = now
            span = max(0.001, now - STATE["first"])
            print("  %6d events  %5.1f/s  %2d tracks  t %.1f..%.1f  %s"
                  % (STATE["events"], STATE["events"] / span,
                     len(STATE["tracks"]),
                     STATE["t_min"] or 0, STATE["t_max"] or 0,
                     ",".join(sorted(STATE["plays"]))))

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"ok":true}')

    def do_GET(self):
        """A summary, for anything that wants to check up on the run."""
        span = max(0.001, (STATE["last"] or 0) - (STATE["first"] or 0))
        out = {
            "events": STATE["events"], "requests": STATE["requests"],
            "bad": STATE["bad"], "tracks": sorted(STATE["tracks"]),
            "plays": sorted(STATE["plays"]),
            "rate": round(STATE["events"] / span, 1) if STATE["events"] else 0,
            "t": [STATE["t_min"], STATE["t_max"]],
        }
        body = json.dumps(out).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_a):
        pass                                  # the summary above is the log


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("port", nargs="?", type=int, default=8799)
    ap.add_argument("--save", help="append every observation to this file")
    args = ap.parse_args()

    if args.save:
        STATE["save"] = open(args.save, "a", encoding="utf-8")

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Receiver)
    print("receiver on http://127.0.0.1:%d/   (POST to send, GET for a summary)"
          % args.port)
    print("   Ctrl-C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n%d events in %d requests, %d rejected, %d tracks"
              % (STATE["events"], STATE["requests"], STATE["bad"],
                 len(STATE["tracks"])))
    finally:
        if STATE["save"]:
            STATE["save"].close()


if __name__ == "__main__":
    main()
