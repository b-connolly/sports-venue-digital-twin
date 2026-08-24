"""Build a bundled copy of the app, for comparison with the CDN one.

The app runs unbuilt: the browser is handed the same files that are in this
repository and fetches the SDK a module at a time from Esri's CDN, which is why
there is no package.json and nothing to install. That is a deliberate trade -
clone, serve, works - and it costs about a thousand HTTP requests on a cold load.

This produces the other version of that trade, so the two can be measured
against each other rather than argued about. It is a *generator*, not a fork:
the app is copied and its imports rewritten, so there is one source of truth and
the bundled build cannot drift from it.

    propy bundle.py                 # copy, rewrite, install, build
    propy bundle.py --no-build      # stop before npm, to inspect the tree

Output is ../build, which is gitignored. ../build/dist is the finished site -
plain static files, nothing server-side, ready for S3 or any other host.

What gets rewritten, and why each one has to be:

  import ... "https://js.arcgis.com/5.0/@arcgis/core/X"   ->  "@arcgis/core/X"
      Both the static imports and the ten dynamic ones. A bundler cannot see
      inside a URL specifier - it would leave them as runtime fetches to the CDN
      and bundle nothing - so the dynamic ones matter as much as the rest. Once
      they are bare, Vite code-splits them and the tool widgets stay lazy.

  esriConfig.assetsPath
      The SDK loads icons, workers and localisation at runtime rather than
      importing them. Unbundled they come from the CDN; bundled they have to be
      copied out of the package and pointed at locally, or the app runs but its
      widgets have no icons.

  the preconnect to js.arcgis.com
      Dropped, because the bundled build never talks to it. Leaving it in would
      open a connection to a host it does not use and flatter the comparison.

A build stamp is added on the way past - the commit it was built from, and when.
The app prints it on start-up. The two hosted copies are generated from the same
files so they cannot disagree about behaviour, but they are deployed separately
and either can be left behind; this is how you tell which you are looking at,
and whether it is current.
"""
import datetime, json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, ".."))
OUT = os.path.join(APP, "build")

CDN = "https://js.arcgis.com/5.0/@arcgis/core/"
# Whatever js.arcgis.com/5.0/ is serving right now, asked at build time rather
# than written down. Both hosted copies have to run the same SDK or they are not
# comparable and, worse, they behave differently: "^5.0.0" let npm install 5.1,
# where RenderNode.requireGeometryDepth became a getter with no setter. The app
# assigns it, so the assignment threw, the render node never registered, and the
# bundled copy had no Milky Way while the CDN one did. A caret is the wrong tool
# for pinning to somebody else's channel.
SDK_FALLBACK = "5.0.19"
KERNEL = "https://js.arcgis.com/5.0/@arcgis/core/kernel.js"

# Where the built copy is hosted. A prefix, not a bucket root, which is why
# vite is told base: "./" - every path in the build is relative, so the same
# dist works at any depth without being rebuilt for it.
S3 = "s3://esri-imagery-apps/apps/digital-twin/sports-venue/"

# Copied verbatim into public/, so they land at the root of dist and the app's
# own "./assets/..." and "./data/..." fetches resolve unchanged.
VERBATIM = ["assets", "data"]
SOURCE = ["index.html", "css", "js"]


def sdk_version():
    """The exact version behind the CDN channel the unbundled app uses."""
    try:
        import urllib.request
        src = urllib.request.urlopen(KERNEL, timeout=20).read().decode("utf-8", "replace")
        found = re.findall(r'"(\d+\.\d+\.\d+)"', src)
        if found:
            print("CDN /5.0/ is serving %s - pinning to it" % found[0])
            return found[0]
    except Exception as err:
        print("could not ask the CDN (%s); falling back to %s" % (err, SDK_FALLBACK))
    return SDK_FALLBACK


def stamp():
    """The commit this was built from, and when - so a stale copy shows itself."""
    try:
        sha = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=APP,
                             capture_output=True, text=True).stdout.strip()
        dirty = subprocess.run(["git", "status", "--porcelain"], cwd=APP,
                               capture_output=True, text=True).stdout.strip()
    except Exception:
        sha, dirty = "", ""
    when = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return "%s%s · %s" % (sha or "unknown", "+dirty" if dirty else "", when)


def rewrite(text):
    """CDN specifiers to bare ones, and the asset path to a local folder."""
    text = text.replace('"%s' % CDN, '"@arcgis/core/')
    text = text.replace(
        'esriConfig.assetsPath = "@arcgis/core/assets"',
        'esriConfig.assetsPath = "./arcgis-assets"')
    return text


def main():
    if not shutil.which("npm"):
        raise SystemExit("npm is not on PATH - install Node, or use --no-build")

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "public"))

    # --- the app, with its imports rewritten ------------------------------
    rewritten = 0
    for name in SOURCE:
        src, dst = os.path.join(APP, name), os.path.join(OUT, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    for root, _dirs, files in os.walk(OUT):
        for f in files:
            if not f.endswith((".js", ".html")):
                continue
            p = os.path.join(root, f)
            before = open(p, encoding="utf-8").read()
            after = rewrite(before)
            if f == "index.html":
                after = re.sub(
                    r'\s*<link rel="preconnect" href="https://js\.arcgis\.com"[^>]*>',
                    "", after)
                tag = '<meta name="venue-build" content="%s" />' % stamp()
                # A bare newline, not os.linesep: these files are opened in
                # text mode, so the write translates it to the platform
                # ending itself. Handed the Windows pair it wrote both, and
                # the head carried a doubled carriage return.
                after = after.replace("</head>", tag + "\n</head>")
            if after != before:
                open(p, "w", encoding="utf-8").write(after)
                rewritten += 1
    print("rewrote %d files" % rewritten)

    for name in VERBATIM:
        shutil.copytree(os.path.join(APP, name), os.path.join(OUT, "public", name))

    # --- what a build needs, and nothing else -----------------------------
    json.dump({
        "name": "sports-venue-digital-twin-bundled",
        "private": True,
        "type": "module",
        "scripts": {"build": "vite build", "preview": "vite preview"},
        "dependencies": {"@arcgis/core": sdk_version()},
        "devDependencies": {"vite": "^6.0.0"}
    }, open(os.path.join(OUT, "package.json"), "w"), indent=2)

    open(os.path.join(OUT, "vite.config.js"), "w", encoding="utf-8").write(
        '''import { defineConfig } from "vite";

export default defineConfig({
  // Relative, so the built site works from a bucket root or a subfolder
  // without being rebuilt for each.
  base: "./",
  build: {
    // Not "assets": the app already has a folder of that name carrying the
    // playing surfaces and the sky, copied through public/, and Vite would
    // write its own output on top of it.
    assetsDir: "bundle",
    chunkSizeWarningLimit: 4000
  }
});
''')

    if "--no-build" in sys.argv:
        print("tree ready in %s (stopped before npm)" % OUT)
        return

    print("npm install ...")
    subprocess.run(["npm", "install", "--silent"], cwd=OUT, check=True, shell=True)

    # The SDK's runtime assets are not imported, so nothing pulls them into the
    # bundle - they have to be copied.
    src = os.path.join(OUT, "node_modules", "@arcgis", "core", "assets")
    shutil.copytree(src, os.path.join(OUT, "public", "arcgis-assets"))
    print("copied the SDK's runtime assets")

    print("vite build ...")
    subprocess.run(["npm", "run", "build"], cwd=OUT, check=True, shell=True)

    dist = os.path.join(OUT, "dist")
    total = sum(os.path.getsize(os.path.join(r, f))
                for r, _d, fs in os.walk(dist) for f in fs)
    count = sum(len(fs) for _r, _d, fs in os.walk(dist))
    print("\nbuilt %s" % dist)
    print("  %d files, %.1f MB" % (count, total / 1048576))
    print("  built from %s" % stamp())
    print("")
    print("  aws s3 sync dist/ %s --delete" % S3)
    print("  then invalidate the CloudFront distribution, if there is one")


if __name__ == "__main__":
    main()
