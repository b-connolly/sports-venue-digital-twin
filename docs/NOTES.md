# Sports Venue Digital Twin

A custom single-page app around a reality-captured stadium web scene
(`2ecd0214d1c940fca2789d0146069786`), built on the **ArcGIS Maps SDK for
JavaScript 5.x**.

Dark, cinematic, deliberately sparse — the scene is the content and the
interface stays out of the way until you reach for it.

## Run it

ES modules will not load from `file://`, so serve the folder:

```bash
cd sports-venue-digital-twin
python -m http.server 8777        # or: npx serve .
```

Then open <http://localhost:8777>.

### Layout

No build step, no `npm`, nothing to install. It is a static site: ES modules
loaded straight from the CDN, served as files.

```
index.html          the page
css/                styles.css
js/                 the ten modules; app.js is the entry point
assets/             painted surfaces and the night sky
data/               the two replays, built by tools/
tools/              generators - textures, tracking extraction
serve.py            local dev server, no-cache
```

Everything the browser needs is committed, so the site works as-is when hosted.
`tools/` is only needed to regenerate the data; see `tools/README.md`.

`python -m http.server` works, but it sends no `Cache-Control`, which lets the
browser decide for itself how long each file stays fresh and serve a cached copy
without asking. Everything here is an ES module, so the browser decides that
per file - which means an edit can appear to have no effect at all, with nothing
in the console to say why. `serve.py` is the same thing with `no-store` on
everything:

```
python serve.py            # http://localhost:8777
python serve.py 8080       # somewhere else
```

If a change ever seems not to have taken, that is the first thing to rule out:
hard refresh with Ctrl+Shift+R (Cmd+Shift+R on a Mac).

`http.server` sends `Last-Modified` but no `Cache-Control`, so Chrome applies
heuristic caching and can keep serving a stale `app.js` or `styles.css` after an
edit — which reads as "my change did nothing". If you are iterating, either keep
DevTools open with *Disable cache* ticked, or serve with `Cache-Control:
no-store`.

## Deploy

It is static files with no build step, so it drops straight onto GitHub Pages,
ArcGIS Online as a hosted app, or any static host — copy the whole folder except
`README.md` and `tools/` and you are done. That is `index.html`, `styles.css`,
`app.js`, the modules it imports (`field.js`, `goals.js`, `jumbotron.js`,
`lights.js`, `meshkit.js`, `milkyway.js`, `play.js`), the three textures
(`field.jpg`, `pitch.jpg`, `milkyway.jpg`) and the two plays (`play.json`,
`soccer.json`).

The scene is **public**, so there is no sign-in and no OAuth app registration.
If it is ever made private, the app will need an `OAuthInfo` /
`IdentityManager` flow added in `app.js` before the scene loads.

## Live action

Each replay offers three cameras, in its title bar:

| | |
|---|---|
| **Fan Perspective** | From a seat you pick. The chooser comes up - 135 sections over five rings, with a plan of the bowl - and the camera previews each one as it is stepped through. Taking one settles into it and starts the passage from there. |
| **Broadcast** | The whole field from the touchline, where a television camera would be cut from. This is the opening view. |
| **Player Highlight** | Follows the ball. Taking hold of the camera hands it over and the button offers the follow back; press the mode again to give it up altogether. |

Broadcast is a single move and then the camera is yours again. A seat is not:
it is a fixed point, and the app holds you in it until you leave the mode.

  * **Drag turns your head.** A scene view has no first-person mode, so the
    gesture is intercepted and rewritten as heading and tilt with the position
    held. Tilt is clamped to 20-105 deg.
  * **Zoom is off.** The wheel and the two-finger pinch are taken out of
    `view.navigation.actionMap`, and double-click and the pan and zoom keys are
    stopped as they arrive. The SDK's seated verbs are deliberately left alone:
    `w`/`a`/`s`/`d` look about, `n` and `p` straighten up. A seat is a fixed
    point, so every zoom from one is a way out of the stand and nothing else -
    which is exactly how people used to strand themselves.
  * **The way back outlives leaving the seat.** *Recenter on the ball* is
    offered from the moment a seat is taken until Fan Perspective is given up,
    and it flies back to the seat first if the camera has been taken out of it.
    Anything that moves the camera - Home, a slide, the tour - gives the seat
    up, but only changing camera, closing the replay or applying a saved view
    gives the *mode* up, and only that clears the offer.

Leaving the seat and leaving fan perspective are separate events in `app.js`:
`leftSeat()` stands down the drag capture, the follow and the zoom lock, and
`leave()` additionally forgets the seat and withdraws the offer. The button
itself is shared with Player Highlight, so each owner sets its own flag through
`offerRecenter()` and neither can put away an offer it did not make.

The **L** button replays a real NFL touchdown on the field: a 75-yard catch and
run, third quarter of the 2017 season opener. Nobody is named - see
`tools/anonymise.py`.

Nothing about the movement is choreographed. Every position comes from the
league's own public tracking release, the [Big Data Bowl](https://github.com/nfl-football-ops/Big-Data-Bowl)
— 10 Hz x/y for all 22 players and the ball
— so the routes, the closing speeds, the blocking and the pursuit angles are the
ones that actually happened. `tools/build_play.py` converts one play into
`play.json`; see `tools/README.md` to rebuild it or pick a different play.

Three things are not measured, and all three are marked as such in the code.
The first is the ball's **height**, which the 2017 release does not
carry — a ballistic arc whose apex follows from the hang time (2.4 s, so 7.1 m).
The second is the **celebration**: the league's tracking window closes 1.1 s
after the ball crosses the line, so the clip ended on a receiver still running
with nobody within twenty yards of him. `tools/celebrate.py` appends eight
seconds after that last measured frame — the nearest team-mates run in and mob
him, the rest of the offence pulls up short, the defence walks off — and writes
`meta.measuredFrames` so the boundary stays visible in the data. It can be run
against an existing `play.json`, which is what you want when the source CSV is
not on the machine. The third is the **running motion**.

That last one is a limitation worth understanding. The SDK cannot play a
skinned animation: glTF skinning and keyframes are unsupported for models used
as symbols. What it does support, since 4.30, is cheap per-frame rigid
transforms on a `Mesh`. So each player is one rigid figure frozen mid-stride,
built from primitives, and the running is implied by secondary motion — a stride
bob whose frequency follows actual speed, a forward pitch that follows speed,
and a roll into the turn that follows the actual rate of change of heading. At
the distance this scene is viewed from, those cues carry the motion better than
limb detail would. All 22 figures share one `MeshLocalVertexSpace` origin at the
centre of the field, so a position is just a translation in metres and no
geodetic maths happens per frame.

The play is mapped onto the **painted texture**, not onto a regulation field:
the texture spans 120 yards across the measured 113.40 m, so matching the
texture is what keeps players standing on the painted lines. Verified by eye —
at t = 7.6 s the receiver stands beside the painted "30", which is where tracking
x ≈ 39 should put him.

Both replays live behind one **Live action** button in the rail, which opens out
into the two codes. Controls: play/pause, restart, and a scrub bar with the
moments of the play marked on it, and a three-way camera picker: **Fan
Perspective**, **Broadcast** and **Player Highlight**. Broadcast is the opening
view. Only Player Highlight holds the camera - it follows the ball frame by
frame - so pressing it again lets go and hands the view back to where it was.
The other two are a single move, which is why pressing either again simply
repeats it. Between moves the camera is yours: you can pause and walk around a
frozen play.

If the scene is dark when the panel opens, the clock moves to mid-afternoon for
the duration and is put back on close. The stadium lights are emissive symbols —
they read as lit but cast no light — so after dark the replay would otherwise
happen in the dark.

Deep link: `?live` opens the gridiron replay and plays it and `?goal` the
football one; `?live=7.1` or `?goal=21.8` opens paused at that second, so a
particular moment can be linked to.

## The markings measure true

The gridiron is 109.728 x 48.768 m &mdash; 120 x 53&#8531; yards &mdash; so goal
line to goal line measures **exactly 100 yards (91.44 m)** with the app's own
measure tool. The pitch is 105 x 68 m, likewise regulation.

It was not always. The field was first sized to 113.40 x 50.40 m, taken from
measuring the grey slab in the capture. But the slab is the whole covered area,
not the field: stretching 120 yards of texture across it made a painted yard
0.945 m, and the field measured **103.3 yards** between the goal lines. The slab
is 130 x 76.6 m and still holds the corrected field comfortably &mdash; there is
simply a little more of it showing round the edge.

## Making it cheap enough to run

Animating forces the scene to redraw continuously. Idle, a SceneView renders on
demand; the moment a transform changes it has to draw everything again &mdash;
including a Gaussian splat that is expensive to fill. So the cost of a replay is
not the arithmetic, it is **how often the poses are rewritten**.

Three things follow from that:

- **Poses update at ~33 Hz, not 60.** Indistinguishable for figures a few pixels
  across, and it halves the redraws.
- **The rate adapts.** The tick smooths the observed frame interval, and if
  frames start taking much longer than 60 Hz allows it backs the pose rate off
  towards 15 Hz rather than piling on work a machine cannot absorb.
  `__play.health` reports the frame time and the rate it has settled on.
- **The transport readout updates at 10 Hz.** It only ever shows tenths, so
  sixty DOM writes a second bought nothing.

Separately, everything derivable from the data &mdash; each player's position in
local metres, their speed, heading and rate of turn &mdash; is computed once when
the play loads rather than re-derived from Catmull-Rom samples on every frame.
That took a pose from 0.073 ms to 0.048. It was never the bottleneck, but it is
free on a machine that is struggling.

## Getting close to a capture

Walking up to the hand-held captures does not work in a stock scene: past a
certain point the geometry is sliced away by an invisible plane a few metres in
front of the camera. The same thing happens in Scene Viewer on ArcGIS Online,
and it is deliberate. Depth precision depends on the ratio between the far and
the near clipping plane, so the renderer does not choose `near` freely - it
picks `far`, which has to reach the horizon, and derives `near` from it at a
fixed ratio. Measured here with `clipDistance.mode` on its default `"auto"`:

| camera distance | near | far | far / near |
|---|---|---|---|
| 2000 m | 10.2744 m | 205488 m | 2.0 x 10^4 |
| 500 m | 10.2952 m | 205904 m | 2.0 x 10^4 |
| 120 m | 10.3005 m | 206009 m | 2.0 x 10^4 |

`near` hardly moves however close the camera gets, and the ratio is pinned. With
the far plane around 206 km the near plane sits a little over 10 m out, so
anything nearer is simply not drawn.

`nearplane.js` spends the same precision budget differently. Near the ground it
pulls both planes towards the camera together, keeping the renderer's own
far:near ratio, so at eye height the near plane is about 12 cm and the far plane
about 6 km. It engages below roughly 124 m and hands back above roughly 198 m -
every slide in the tour sits well above that and is untouched.

What it measures is **camera altitude**, deliberately. An earlier version
measured the distance to `view.center`, the point under the middle of the
screen, which describes the thing being inspected far better - and made the zoom
judder. `view.center` comes from hit-testing the drawn scene, so moving the clip
planes changed it, which moved the clip planes: a loop running once per frame,
engaging at exactly the range where getting close matters. Altitude is an input
to rendering and never an output of it, so it cannot feed back.

The near plane is also quantised to octaves - nine distinct values across the
whole descent from 150 m to the ground, so the planes are rewritten about nine
times rather than on every frame - and the handover has hysteresis, so hovering
at the boundary cannot flip the far plane between 6 km and 206 km on alternate
frames.

The trade is real: below about 6 m altitude you gain the near ground and lose
scenery beyond 6 km. `CONFIG.clip` holds every number, `enabled: false` restores
stock behaviour, and `?clipdebug` puts a live readout on screen.

### The 4 m zoom floor

Clip planes are only half of the close-up problem, and the other half is not
fixable from here. The SDK clamps how near an interactive zoom may bring the
camera to the point it is zooming at - `minimumPoiDistance`, which its zoom
handler passes into every step. Measured on this build it is a flat 4 m and does
not move with anything:

| near plane | 8 m | 4 m | 1 m | 0.25 m | 0.0625 m |
|---|---|---|---|---|---|
| min POI | 4 m | 4 m | 4 m | 4 m | 4 m |

Writing to it is ignored: it is internal state, not part of
`SceneViewConstraints`. So the wheel stops the camera four metres short of
whatever it is pointed at while momentum keeps pushing, which reads as the view
fighting back. `?clipdebug` reports the live value.

`goTo` is not clamped, so a scripted approach can place the camera where the
wheel will not - that is the available route to a true walk-up view.

## Nothing here names a club

The venue is real and the passages of play are real, but nothing in the app
identifies a team. Kit is plain orange against plain white; the gridiron end
zones are plain navy; midfield carries an outline of a ball rather than a badge;
no player is named, in either replay. Team marks, uniform designs and club names
are trademarks, and the scene is meant to read as a venue rather than as one
club's home ground.

Captions name the **occasion** and not the teams — "Third quarter, 2017 season
opener", "First half, anonymised sample match". The football tracking is
anonymised at source, so there is nothing to withhold there; which fixture the
gridiron play comes from is recorded in `tools/build_play.py`, where a developer
needs it for provenance and no viewer sees it.

## How this was made

The **I** button opens a sheet describing the whole pipeline in four steps:
drone reality mapping with ArcGIS Reality, hand-held reality mapping with Pix4D
Catch, the Maps SDK components that bring it together, and how the two replays
were built — including which quantities are measured and which are not.

### The football goal

**G** replays a goal from a real match: a tackle won in midfield, eight passes,
a switch of play, a cross and a first-time finish — twenty-two seconds from
turnover to goal, with the real celebration afterwards.

The clip opens three seconds before that, on a goal kick, and those three
seconds are invented. Metrica records the ball only while it is in play, so the
measured passage begins on the tackle itself - everyone already moving, the ball
changing feet within a tenth of a second, too fast to read. `tools/kickoff.py`
puts a kick, a controlled touch and then the turnover in front of it, and writes
`meta.measuredFrom` so the boundary stays visible in the data. What it is built
from is real: the kick is taken by whichever defender is deepest at the tackle,
it is played to the man who actually gets dispossessed, and every player is
walked backwards from the position and velocity they genuinely have on the first
measured frame, so the join is continuous rather than a cut.

From the tackle on, **every position is measured**. The source is
[Metrica Sports' open sample data](https://github.com/metrica-sports/sample-data)
— 25 Hz tracking for all 22 players and the ball with synchronised events, on a
105 x 68 m pitch, resampled here to 10 Hz. It is anonymised at source, so no
player, team or competition is named in it. Their licence asks only that the
source be acknowledged, which the caption and the info sheet do.

This replaced a reconstruction of a famous historical goal, and the change was
worth making. No tracking data exists for any famous old match, so that version
had hand-authored touches with a team-shape model, a pressing model and a
velocity limiter behind them — a lot of machinery whose only job was to make
invented coordinates behave like real ones. All of it is gone. What is left is
an extraction.

Two quantities still are not measured, and both are stated in the app rather
than buried:

- **Ball height.** The source is 2D. Only a delivery the event data calls a
  cross, or a pass too long to be rolled, is given an arc, with the apex from
  its own hang time; everything else stays on the deck.
- **De-glitching.** Optical tracking drops and reacquires people, and the track
  jumps when it does — one player here crosses 9.6 m in 0.24 s. A velocity cap
  set *above* elite top speed removes the artefacts without touching genuine
  sprints. It affects 0.22% of samples, and the build prints the figure.

Opening it repaints the slab. The same 130 x 76.6 m grey slab that holds a
gridiron field also holds a full-size pitch (105 x 68 m), so each surface is its
own textured quad and switching is a cross-fade of layer opacity. Goals are
modelled from primitives at regulation size — 7.32 m between the posts, 2.44 m
to the underside of the bar — with the net as a translucent double-sided panel.
Closing the panel fades the gridiron back.

### The walk to the statues

One move in the show is flown rather than interpolated. Night Sky sits out to
the north-west and the statue plaza is due south, so the ordinary slide flight -
which interpolates the camera in x, y and z - cuts the corner and goes through
the stadium. No easing fixes that; the problem is the shape of the path, not its
pace.

`CONFIG.flyBetween` names the pair and gives the shape: waypoints in polar terms
- a bearing round the ground, a distance from the middle of it, a height above
the playing surface - driven frame by frame through a spline by the same
`flyLap` the opening lap uses. Interpolating a circle in those terms stays a
circle, which is exactly the property the straight line lacks. Nineteen seconds,
anticlockwise past the west stand, rising to 78 m and then down onto the plaza.

It buys three things, and the second is the one that is easy to miss:

  * **It stays outside.** Distance from the middle of the ground never drops
    below 190 m until the camera is round to the south and clear of the
    building, and the approach from there is a radial rather than a crossing.
  * **The statue captures get nineteen seconds to load.** They are the heaviest
    thing in the scene per square metre and the view lands close enough to see
    every tile, so arriving with them cold means watching a grey blob resolve.
    They come on at the top of the move; the stadium mesh waits until the camera
    has turned away, because it is opaque where the splat is not and would
    otherwise sit over the better reconstruction for the whole pass.
  * **The sun walks home.** See below.

Matched on both ends and only while the show is running. Arriving at the statues
from anywhere else, or stepping there by hand, gets the ordinary flight -
nineteen seconds is a shot when it arrives as part of something and an
unresponsive button when somebody has just pressed next.

`tools/flycheck.py` asserts the clearance against the camera the app actually
flies rather than against the numbers in the config, because a spline through
safe-looking waypoints can still bulge between them.

### Walking the sun home

The view after Night Sky has no clock of its own, so live time used to come back
in a single frame: the sun jumped most of a day, the sky went from stars to
whatever Denver is under, the floodlights went out and the slider's handle
teleported across its track — all on top of the calmest camera move in the show.

It is walked across the flight instead, and walked *forwards*. Live time is
behind midnight rather than ahead of it, so the short way is backwards, and a
sun that runs backwards reads as a fault however smoothly it does it. Going
forward gives a sunrise: the sky pales over the west stand while the camera
comes round it, the floodlights drop out as the sun clears the horizon, and the
move lands in daylight at the time it really is at the venue. The walk arrives a
day ahead of the true instant and the hand-back to the live clock steps that day
off, which is invisible — the same time of day is the same sun.

Three bugs sat behind this and all three are worth knowing about, because each
one produced a *plausible* wrong answer rather than an obvious one:

  * **The warm-up left the scene's authored date on the lighting.** Applying a
    slide installs its environment, date included, and the scene is authored on
    a fixed afternoon. The rail could afford to be careless - `tickClock` puts
    it right within thirty seconds and nothing has looked at it - but the
    warm-up runs before the first tick, so whatever it left was what the app was
    holding when the show started. `warmUp` now makes the same `matchLighting`
    stamp the rail does.
  * **The time slider kept the day it was built with.** Built from that stale
    date, every instant the rail set afterwards fell outside its extent, the
    widget clamped it back inside, and the watch read the clamp as a hand on the
    handle: `manual` latched on and live time was lost for the session. It read
    as nothing worse than the light looking a bit odd, because a wrong
    declination is not a wrong clock face. Measured: 165 days.
  * **The handle only ever clamped.** The track is one day long and the walk
    crosses midnight, so the handle parked against the edge and stayed there
    while the readout above it went on counting. `sliderOwner` now moves the
    day under the handle.

### Holding on the replays

The slideshow stops on each of the two replay views. Every other view is a
place - you arrive, you look, it moves on - and these two are an event: the
passage runs out to its end, and the moment it does is the moment somebody
wants to scrub back through it, read the diagram, walk round the frozen last
frame or take a seat in the stand and watch it again. So the show holds until
the passage has actually finished, waits a beat on the celebration, and then
hands itself back with the play button asking to be pressed. Pressing it
carries on from where the show left off. Which views these are is not written
down: it is any view whose `opens` names a play, which is the same test that
decides the passage has to run to the end at all, so the two cannot drift.

Both replays share one **Live action** button in the rail, which opens out into
the two codes. Controls: play/pause, restart, and a scrub bar with the moments
of the play marked on it, and a three-way camera picker - Fan Perspective,
Broadcast and Player Highlight. Only the last of the three holds the camera;
between moves the view is yours, so you can pause and walk around a frozen play.

Deep link: `?live` opens the gridiron replay and `?goal` the football one;
`?live=7.1` or `?goal=25.1` opens paused at that second.

## What it does

| Feature | Notes |
|---|---|
| Cinematic intro | Title card with a progress bar. Entry is enabled as soon as the view is ready — it deliberately does *not* wait on `view.updating`, because splat and integrated-mesh layers stream continuously and that flag may never settle |
| Views | Two arrows, a play button and the current title, under the app title. The title is also a button: it drops the whole list of the scene's slides, so any view is one press away rather than a walk through the ones between. Drives `slide.applyTo()` with a 2.6 s eased flight. The show stands down on each of the two replay views once its passage has run out — see the note on the slideshow below |
| Captures panel | Two peer groups — the splat and the meshes — sharing one column grid. The mesh header is a tri-state master (all / none / mixed), showing a count only while the group is split. Every switch mirrors its layer, so slides that change visibility keep them honest. Opens on the splat alone |
| Analysis | Distance, area, volume and elevation profile, segmented in one docked panel |
| Time of day | A `TimeSlider` scrubbing one full day and driving the sun, with play/loop and a shadows toggle — see below |
| Live weather & clock | Real conditions drive `environment.weather`; the sun tracks the actual time in the stadium's timezone, with day/night from true sunrise/sunset and stars after dark — see below |
| Jumbotron | A lit panel over the south video board, where the splat reconstructs badly — see below |
| Cleared chrome | `ui: { components: [] }` — every control is bespoke |
| Keyboard | `←` `→` views · `H` reset · `M` analysis · `T` time of day · `C` copy camera · `U` hide interface |
| Reduced motion | Honours `prefers-reduced-motion` |

## Live weather and time of day

The SDK's `Weather` widget **only sets** conditions — there is no real-time feed
in it (`realTime`, `fetchWeather`, `autoUpdate` and `location` do not exist in
5.0.19). So the app fetches the real observation and drives the scene from it.

**Conditions are the scene's graphics, not just a readout.** The WMO weather
code selects a `SunnyWeather` / `CloudyWeather` / `RainyWeather` /
`SnowyWeather` / `FoggyWeather`, with `cloudCover` taken from the real cloud
percentage and `precipitation` scaled from millimetres. Overcast in Denver
renders overcast.

**Time of day is driven by the clock, in the stadium's timezone.**

- `lighting.date` is set to `new Date()` and re-set every 30 s, so shadows creep
  in real time instead of jumping every fetch. A `Date` is an absolute instant,
  so the sun is correct no matter where the page is opened from.
- `lighting.displayUTCOffset` comes from the API's `utc_offset_seconds`, and the
  clock readout is formatted into the API's IANA zone (`America/Denver`).
- **Day or night comes from the real sunrise and sunset** for that date and
  place, not a guessed hour, so it flips at the right moment and tracks through
  the year. After dark the chip cools its border and the mark switches to a
  moon.
- The chip shows the next solar event — sunrise while it is dark, otherwise
  today's sunset, otherwise tomorrow's sunrise (hence `forecast_days=2`).
- `starsEnabled` is on, so night actually looks like night.

### Driving time of day by hand

The ☀ tool (or `T`) opens a scrubber along the bottom edge: one full day,
midnight-to-midnight in the stadium's timezone, 10-minute stops, with play and
loop so the sun sweeps across the bowl.

**`TimeSlider` does not normally do this.** Bound to a view it drives
`view.timeExtent` to filter time-aware layers and never touches lighting. It is
constructed here deliberately *without* a `view`, so it has no side effects, and
its instant is copied onto `environment.lighting.date` instead.

Moving it takes ownership of the sun: `tickClock` stops advancing the date, the
weather chip's badge switches from **LIVE** to **MANUAL**, and the chip's clock
and day/night icon follow the *scene's* time rather than the wall clock. The
**Live** button hands control back. Programmatic slider moves are tagged by
timestamp so they are not mistaken for a user drag — `reactiveUtils.watch` fires
asynchronously, so a flag cleared on the next line would not work.

The panel also carries a **shadows** toggle, driving
`lighting.directShadowsEnabled`. It sits with the time control because direct
shadows are part of the sun model, and they are what makes moving the slider
legible — at low sun the stands throw shadows right across the field.

### The web scene fights you for the sky

This cost two rounds of debugging, so it is worth stating plainly. The web scene
carries an **authored environment** in `initialState.environment`:

```json
"lighting": { "type": "sun", "datetime": 1773601206000, "displayUTCOffset": -7 },
"weather":  { "type": "cloudy", "cloudCover": 0.25 }
```

That timestamp is **2026-03-15 12:00 Denver — midday**. It is applied while the
scene loads, *after* the `SceneView` constructor runs, so setting `lighting.date`
in the constructor alone is not enough: the scene overwrites it moments later.

Worse, **every one of the seven slides carries the same environment**, so
changing view would snap the sun and the weather back to that midday state.

Two fixes, both app-side — the web scene is left exactly as authored:

- `ownSky(view)` re-asserts date, UTC offset, weather, stars and atmosphere
  immediately after `view.when()`.
- `Slide.environment` is **non-nullable**, so it cannot be stripped up front —
  `applyTo()` always pushes the authored sky. `ownSky()` is therefore called
  again 60 ms into each flight and once more when it lands.

### Nothing about the sky waits on the network

The first build set the sun only after the weather response arrived, and that
request was queued behind `scene.load()`, `view.when()` and an awaited
jumbotron build — so a fresh load sat in the web scene's authored *daylight*
for several seconds before snapping to night. Three changes fixed it:

- **`lighting.date` and `displayUTCOffset` are set in the `SceneView`
  constructor**, so the sky is at the right time of day on the very first
  rendered frame. Neither needs the network: a `Date` is an absolute instant,
  and the UTC offset is computed locally from the IANA zone with
  `utcOffsetHours()` (verified against DST both ways and half-hour zones).
- **The conditions request starts before `scene.load()`**, in parallel with the
  scene, and `startWeather()` reuses that in-flight promise rather than issuing
  a second request.
- **The jumbotron is no longer awaited.** It fetches a logo and probes ground
  elevation; the panel appearing a moment late is better than holding the view.

Only the *conditions* — cloud, precipitation, temperature and the sunrise and
sunset times — still wait on the response, and they arrive as a refinement
rather than as the difference between day and night.

**[Open-Meteo](https://open-meteo.com/)** supplies all of it — keyless, and it
sends `access-control-allow-origin: *`, so it works straight from the browser.
Refreshed every 10 minutes; if the request fails the chip hides itself and the
scene keeps whatever the web scene was authored with.

One subtlety worth keeping: with `timezone=auto`, Open-Meteo returns sunrise and
sunset as **local wall-clock strings with no offset** (`2026-08-21T19:48`).
Parsing those directly would interpret them in the *viewer's* timezone. They are
stamped with the site's offset first so they become absolute instants.

Swap the provider by editing `applyWeather()` — only the URL and the field names
are provider-specific.

## Jumbotron

The south video board is the worst artifact in the capture. It is large, dark
and self-lit, so the splat smears it, and the drone mesh bakes in whatever the
screen happened to be showing that day (colour test panels and advertising).
`jumbotron.js` covers it with a black, emissive quad carrying the Esri mark.

Getting this right took three passes, and both failures are worth recording.

**1. Wrong vertical datum — the panel was 17.8 m underground.**
The reference tileset's tile transforms are ECEF, so measuring off it yields an
*ellipsoidal* height. But the scene's layers declare gravity-related heights —
the integrated mesh is `vcsWkid 5773` (EGM96) — and the geoid separation at this
site is -17.8 m. The panel rendered inside the stands, invisible.

Confirmed independently: converting the mesh's declared z-range to ellipsoidal
puts its top at 1626.97 m against the splat's 1627.68 m, agreeing to **0.71 m**.

`resolveZ()` no longer assumes. It probes `ground.queryElevation()` at the board
and compares against the ground beneath it, which is known in **both** frames
(1586.41 EGM96 / 1568.61 ellipsoidal). Those are 17.8 m apart, so the test
cannot go wrong, and it logs which frame it chose.

**2. Too small, and behind the structure.**
Sizing the panel to the splat's *reconstruction failure* was the wrong instinct:
that recess measures 24.9 x 12.0 m, but the board face is **67.24 x 21.96 m**,
measured in-app with the measurement tool. Two intermediate guesses (26 m, then
59 m) were both short. The face turns out to match the structure's full extent
in the local frame, E -34..+34.

Depth was worse. The RANSAC plane fitted to the bezel evaluates to N = -109.96,
but the board's *frontmost* returns reach N = -104.67 — so a panel 1.5 m proud
of the fitted plane still sat 3.8 m behind the face, and the drone mesh covered
it completely.

**3. Yaw was 2.5 degrees out.**
The rotation was fitted to the bezel shell and came out at +2.33 deg. Fitting
instead to the board's *outer face profile* — its closest approach per column —
gives a flat plane at N = -105.87 +/- 0.35 m across all 68 m, with a normal
heading of just **+0.17 deg**, i.e. essentially due north.

2.5 deg of error tilts a 70 m panel by **3.06 m** end to end. At E -34 it cleared
the face by 0.15 m, so local bumps punched through; at E +34 it floated 3.14 m
proud. Correcting the yaw gives a uniform 1.70 m clearance at both ends.

**4. Flush does not work either.**
Dropping the panel level with the face let the splat bleed through: gaussians
are volumetric, so any centred ahead of the plane smear across the panel at
some zoom levels. The panel is therefore held slightly proud, via a `standoff`
applied along the outward normal at run time — `lat`/`lon` in the config are
the *flush* position, and `standoff` is the one number to change if anything
bleeds through or it starts to read as floating.

### Current placement

| | |
|---|---|
| Centre | 39.74289797, -105.02011326 (flush on the face plane; `standoff` lifts it 1.7 m) |
| Height | 1619.15 m EGM96 / 1601.35 m ellipsoidal |
| Size | 70.0 x 22.6 m, covering E -34.5..35.5 and 25.9..48.5 m above ground |
| Rotation | -0.17 deg about local up (the face is very nearly due north) |
| Face | flat `#000`, Esri mark at 66% width, aspect preserved |

Built with `Mesh.createPlane(..., { facing: "north" })`, using
`MeshMaterialMetallicRoughness` with the texture on **both** `colorTexture` and
`emissiveTexture` so the mark stays legible whatever the sun is doing — the
board faces north and is in shadow most of the day. `doubleSided: false` culls
it when viewed from behind, so it does not hang over the car park.

It is shown whenever the splat **or** the Reality Mesh is visible; both contain
the bad board. The two hand-held Pix4D meshes do not cover it.

Swap the mark via `CONFIG.jumbotron.logo` — any CORS-clean image URL works, and
`MeshTexture` also accepts a `<video>` element if you ever want it animated.

### Tuning

Load with **`?tune=1`** for a placement HUD.

| Key | Effect |
|---|---|
| `i` / `k` | height +/-0.25 m |
| `j` / `l` | rotation +/-0.25 deg |
| `w` `a` `s` `d` | move +/-0.25 m |
| `[` / `]` | width +/-0.5 m |
| `-` / `=` | height +/-0.25 m |
| `p` | print the config to the console |

Paste the printed block back into `CONFIG.jumbotron`.

## Configuration

Everything adjustable is at the top of `app.js`:

```js
const CONFIG = {
  webSceneId: "2ecd0214d1c940fca2789d0146069786",
  splat:  { /* the one Gaussian splat — matched on layer title */ },
  meshes: [ /* the three meshes, grouped beneath it */ ],
  flyDuration: 2600,
  site: { lat: 39.7439, lon: -105.0201 },
  credit: { /* which slides credit Pix4D Catch as well */ },
  weatherRefreshMs: 600000
};
```

`splat` and `meshes` match on **layer title**. Rename a layer in the web scene
and the switch quietly disappears — update the title here to match.

## Implementation notes

**Pinned to `/5.0/`**, which currently resolves to 5.0.19. `@arcgis/core`'s
latest is 5.1.20; move the imports to a newer folder when you want it — they
are plain URLs in `app.js`.

**`esriConfig.assetsPath`** must point at the CDN when loading ESM this way, or
widget icons and workers 404.

**`slide.applyTo(view, options)`** forwards its options straight to
`view.goTo()`, so `duration`, `easing` and `maxDuration` are honoured even
though they are not Slide's own properties.

**The app is still driven by the web scene.** Layers, slides, ground and
basemap all come from `2ecd0214d1c940fca2789d0146069786` and are picked up on
reload. What the app overrides at run time — and never writes back — is the
environment, the opening layer visibility, and the jumbotron panel, which is a
client-side `GraphicsLayer` that exists only in the app.

**Layer visibility is watched, not assumed** — applying a slide rewrites layer
visibility, so the switches subscribe with `reactiveUtils.watch` rather than
tracking their own state.

**Volume is an Analysis, not a widget.** The SDK has no `VolumeMeasurement3D`
— only `analysis/VolumeMeasurementAnalysis`, which takes a polygon. The app
sketches one with `SketchViewModel`, hands the geometry to the analysis and adds
it to `view.analyses`; the analysis renders its own cut/fill labels into the
scene, so there is no panel readout to populate. Sketching re-arms after each
polygon, so several volumes can be measured in one session; Clear removes them
all from `view.analyses`.

**The elevation profile samples two lines** — `ElevationProfileLineView`, which
follows whatever is actually drawn and so picks up the splat and the meshes, and
`ElevationProfileLineGround` for bare terrain. Reading one against the other is
the point.

**Measurement widgets are destroyed, not detached.** Setting `container = null`
leaves the measurement's analysis on the view, so the drawn geometry would
linger after the panel closed. Switching mode or closing calls `destroy()`.
The widgets have no `clearMeasurement` in 5.x — the reset is
`viewModel.start()`, which is what the widget's own "New measurement" button
calls.

**The credit line follows the layers, not a view number.** Both products are
named whenever a Pix4D Catch capture is actually on screen, read from those
layers' own visibility. It used to be a threshold - "from view 3 onward" - which
broke silently the first time a slide was inserted ahead of the hand-held views:
every number after it moved, and the line began crediting Pix4D over shots that
are drone data alone. Watching the layers cannot drift that way, and it follows
the capture panel and a replay's staging as well as the views rail.

## Not verified

Every SDK module path and API option was confirmed against the 5.0.19 source
and the Open-Meteo response was checked live, but the app has **not been opened
in a browser here**. Give it a look before showing it to anyone; the intro
timing and the flight speed in particular are worth tuning to taste.

## Attribution

Built by **Brian Connolly**, vibe coding with Claude.

No licence file is included, so default copyright applies: the code is
readable but not licensed for reuse. `NOTICE` lists the third-party material,
which carries its own terms either way.

**The tracking data is not in this repository.** Both sources are public, and
both are published without a licence file - so there is nothing that says a
derived copy may be redistributed, and nothing that says it may not. Rather than
guess, the play files are built from the originals on your own machine:

- NFL Big Data Bowl, 2017 release - <https://github.com/nfl-football-ops/Big-Data-Bowl>
- Metrica Sports open sample data - <https://github.com/metrica-sports/sample-data>

Metrica's terms ask that the source be acknowledged when the data is used
publicly, which the replay caption and the info sheet both do.

Nobody is named. The Big Data Bowl release is per-player and carried real names
and squad numbers through the extraction; `tools/anonymise.py` drops them as the
last step of the build, and the renderer never reads them. Positions stay, since
"WR" is a job rather than a person.

The night sky is NASA/Goddard SVS **Deep Star Maps 2020**, public domain. The
video board fetches an Esri logo at runtime - a trademark, not licensed by this
repository; point `CONFIG.jumbotron.logo` elsewhere for your own build.

The venue is real, but nothing here identifies a club: the painted surfaces are
generated by the scripts in `tools/`, and the kit is plain.
