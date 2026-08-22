"""Take the real people out of play.json.

The Big Data Bowl release is per-player, so the extraction carried names and
squad numbers through with it: `players[].name`, `players[].jersey`, the
`meta.carrier`, and the league's own play description, which names the passer
and the receiver. None of it is secret - it is a published play from a
televised game - but the app deliberately names nobody, and a public repository
should not ship a roster it has no reason to hold.

Nothing in the app reads any of it. `name` and `jersey` are never touched by the
renderer, and `carrier` is only used at build time, to know who the celebration
forms around. So the names can go and the only thing that has to survive is that
one reference, which becomes an index instead.

Positions stay. "WR" is a job, not a person, and the build scripts use it.

    propy anonymise.py

Safe to re-run: a file that has already been through this is left alone.
"""
import json
import os
import re

# An initial, a dot, a surname - hyphens and apostrophes included.
INITIALLED = re.compile(r"\b[A-Z]\.[A-Za-z'’-]+")


def strip_names(text):
    """Drop the passer and receiver from a league play description.

    Only the names go. The clock, the formation and the outcome are what the
    caption is for, and the app's own describe() still tidies those for display.
    """
    out = INITIALLED.sub("", str(text))
    out = re.sub(r"\s+to\s+(?=for|\Z)", " ", out)   # "to" left dangling
    out = re.sub(r"\s{2,}", " ", out).replace(" ,", ",")
    return out.strip()


def anonymise(out):
    players = out["players"]

    # Who the celebration forms around, as an index rather than a name. Written
    # before the names are dropped, and left alone if it has already been done.
    carrier = out["meta"].get("carrier")
    if isinstance(carrier, str):
        match = [i for i, p in enumerate(players) if p.get("name") == carrier]
        out["meta"]["carrier"] = match[0] if match else None

    for p in players:
        p.pop("name", None)
        p.pop("jersey", None)

    if "description" in out["meta"]:
        out["meta"]["description"] = strip_names(out["meta"]["description"])
    return out


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    src = os.path.join(here, "play.json")
    if not os.path.exists(src):
        src = os.path.abspath(os.path.join(here, "..", "play.json"))
    data = json.load(open(src, encoding="utf-8"))
    before = sum(1 for p in data["players"] if "name" in p)
    data = anonymise(data)
    json.dump(data, open(src, "w", encoding="utf-8"),
              separators=(",", ":"), ensure_ascii=False)
    print("wrote %s  %.1f KB" % (src, os.path.getsize(src) / 1024))
    print("  names removed from %d players" % before)
    print("  carrier is now index %s" % data["meta"]["carrier"])
    print("  description: %s" % data["meta"]["description"])
