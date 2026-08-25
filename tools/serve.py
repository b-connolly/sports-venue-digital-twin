"""Serve the app locally, with caching turned off.

    propy serve.py            # http://localhost:8777/
    propy serve.py 8080

Python's own `http.server` sends `Last-Modified` and nothing else. With no
`Cache-Control` a browser is entitled to guess how long a file stays fresh, and
Chrome's guess is a tenth of the file's age - so an hour-old app.js is cached
for six minutes and an ordinary reload never asks the server whether it changed.

That is a bad way to spend an afternoon. The failure does not look like a
caching problem: index.html is small and changes constantly so it comes back
fresh, while the stylesheet and the script do not - which leaves the browser
running new markup against old code. New buttons appear and do nothing, new
classes land with no rules behind them, and every one of those reads as a bug
in the change you just made. It cost exactly that here, twice, over a capture
panel that was wired correctly the whole time.

So: no-store on everything. A dev server has no business caching anyway.
"""
import os
import sys
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, ".."))


class Fresh(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is noise; only say something when it went wrong.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8777
    handler = partial(Fresh, directory=APP)
    # Threading, not the plain HTTPServer. `python -m http.server` has used the
    # threading one since 3.7 and this has to match it: a cold load asks for
    # something like a thousand files, most of them at once, and served one at a
    # time behind a single accept loop they queue until things start timing out.
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    print("serving %s" % APP)
    print("  http://localhost:%d/          nothing is cached" % port)
    print("  http://localhost:%d/?live     straight into the replay" % port)
    print("Ctrl-C to stop")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("")


if __name__ == "__main__":
    main()
