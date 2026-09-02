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

#### How much the lights bloom

`environment.lighting.glow` — what the Daylight widget calls "Glow effect" — is
a `{ intensity }` on both `SunLighting` and `VirtualLighting`, clamped by the
SDK to 0–1. It acts on emissive material rather than on light sources, so it
reaches the car park lamps and the jumbotron as well as the roof floodlights.

Slides 4 and 5 are authored with `0.3`. The app uses **0.5**, and the number was
chosen by looking rather than by rounding: at 0.3 the rim still reads as a line
of separate lamps; at 0.75 the west rim fuses into one unbroken molten band and
the jumbotron's lettering starts to bloom; at 1.0 the Esri mark on the board
washes out completely and every car park lamp becomes the same featureless dot.
0.5 is the most bloom that still leaves individual fixtures countable and the
board legible.

**It is written on every tick, not on the day/night crossing**, because two
other things write the whole lighting object and would otherwise win quietly.
Applying a slide installs that slide's authored environment — so arriving at
Stadium at Night would drag the glow down to 0.3 for the length of the flight
and have it corrected a moment later, a flicker on the one view where the glow
is the point. And `setLights` replaces `lighting` outright when the floodlights
come on, which drops the glow with it. `matchLighting` writes the app's value
onto the slide before `applyTo`, the same courtesy it already extends to the
date and the UTC offset.

The tick is `CONFIG.clockTickMs`, which is **30 seconds** — worth knowing before
testing this, because a probe that waits four seconds for a day/night change
sees nothing and reads as a bug in the app.


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

### Powered by Esri

Bottom right, which is the one corner nothing else uses: the weather chip has
the left, the tools the top right, the docks the middle. Small caps at the
weight of the faintest text in the app, no panel behind it — a soft dark halo
holds it against whatever the sky is doing, the same trick the title uses. It
goes with the rest of the interface when the HUD is hidden, opens in its own tab
so a stray click during a demo cannot take the scene away, and is not shown on a
phone, where the bottom edge is already carrying the weather chip and whichever
dock is open.

Its class is `credit`, not `esri`: the stylesheet already carries a dozen
`.esri-*` overrides for the SDK's own widgets, and a bare `.esri` sitting among
them reads as one of those. A class selector matches exactly so the two could
never have collided — the confusion would have been entirely for the reader.

### The numbers on the replay

While a passage runs the panel reads out who has the ball and how fast they are
going, who is nearest and whether that gap is opening or closing. It is
`js/stats.js`, computed once when the play loads — a few thousand differences
over an array already in memory, cheaper than a frame of rendering, which is why
scrubbing is as smooth as playing.

Read off the 75-yard touchdown it comes out as the play itself: the centre has
the ball pre-snap at 0.0 mph, the quarterback takes it and drops back with a
tackle closing, the ball goes up at 47 mph and belongs to nobody, the receiver
catches it at 20.9 mph and pulls away from the free safety, then slows into the
end zone. Top speed 21.0 mph — which is where a real NFL tracking release puts a
fast receiver, and the check asserts that range rather than the exact figure.

Three decisions worth recording:

  * **Possession is gated on the ball's height, not on event names.** The feeds
    label different things — the gridiron marks `pass_forward` and
    `pass_arrived`, the football `cross` — so a table of phase names per feed is
    a table a new play can fall outside of. Height needs no table. Above 2 m the
    ball is in the air and nobody is carrying it, and measured across all six
    passages that is exactly right: the handoff play never leaves 1.05 m and
    possession correctly never lapses, while the deep pass and the cross both
    reach 8.1 m and correctly go unclaimed while they are up.
  * **Separations are in the feed's own unit** — yards for a gridiron, metres
    for a pitch. Reporting one as the other is wrong by ten per cent and looks
    fine, which is why the check asserts the unit.
  * **Only the scaling is needed, not the rotation.** Positions arrive in the
    feed's space and are scaled onto the marked surface; rotation preserves
    distance, and a separation is a distance.

#### Reading the placards

The alumni statues carry engraved placards. They were photographed with a phone,
an optical character recognition model was run over the images, and the readings
were attached to boxes in a 3D object layer standing where the placards stand.
The layer's own fields say how: positions by *"least-squares intersection of rays
from all contributing views"*, poses by *"COLMAP bundle adjustment,
ICP-registered to mesh"*. That ray intersection is the image-space to
ground-space transform an oriented imagery data model carries; the imagery
itself is not published in this scene, so what is shown is the result rather
than the route.

Arriving at the staged view opens a card for one placard — Steve Atwater, read
at HIGH confidence with two of its lines unreadable, which is the whole story in
one record. It uses the same card as the player analytics, in the same column,
because it is the same kind of thing: a few figures about one object, read while
looking at something else.

**Which fields it shows is not decided in this code.** The layer carries a popup
configured in the web scene and `buildPlacard` reads that configuration, so the
card shows what somebody chose it should show, in their order, and changing it
is done where such things are normally done. A list written here would be a
second opinion that quietly goes stale.

#### Showing what it got wrong

Confidence is graded HIGH / MEDIUM / LOW / ILLEGIBLE and the pill is coloured to
match, because "HIGH" and "ILLEGIBLE" should not look alike on a card whose
point is that some of it worked and some did not. A field the reader could not
make out shows `ILLEGIBLE` in italic — marked, not hidden and not guessed.
Across the 36 placards the names include `TELU LACKSON`, `LERRESSA SESTEURAREST
CHAM` and several straight `ILLEGIBLE`s. It is the same handheld capture used to
build the mesh rather than a survey flown for the purpose, so not every photo is
looking at a placard. Showing that honestly is the exercise.

#### Why it cannot just query the layer

A 3D object scene layer has no query endpoint of its own — asking it returns
`scenelayer:query-not-available`, because the attributes live in the i3s node
binaries rather than behind a feature service. What *can* be asked is the layer
**view**: the features the renderer has actually loaded. Two consequences:

  * **`outFields` has to be set before the layer view builds.** Without it the
    query answers with the right number of features and every attribute `null`,
    which reads as a layer with no data rather than a layer whose data was never
    asked for. That cost an hour.
  * **It can only read placards that are on screen**, which is fine because the
    view it opens on is standing in front of them — and it is why the read is
    retried rather than attempted once. On a cold cache the camera arrives
    before the nodes do.

#### Marking the one being read, and silencing the other panel

The card names a placard. In the scene there are eighteen identical brass plates
in a row, so the card on its own leaves a viewer looking for which. The SDK's
popup solved that by highlighting whatever it described, and switching the popup
off would have taken the highlight with it — so the highlight is kept and the
popup is not.

The colour is not the SDK's. Its default highlight is cyan, which is a default
rather than anybody's choice, and this app already says *"this is the one you
are looking at"* in Broncos orange under the watched player. The placard mark
uses the same `#fb4f14` with a lighter halo, so the two marks mean one thing.

**The popup is switched off at the view, not per layer.** Doing it layer by
layer covers only the layers that exist at that moment: the basemap, the ground
and the four graphics layers the app adds later all sit outside `scene.layers`,
and a layer added to the web scene tomorrow would sit outside it too. One
`view.popupEnabled = false` cannot be got round by adding something. The
configuration is not wasted — `buildPlacard` still reads that popup to decide
which fields to show, so the scene's author still governs the card. It is
rendered by this app instead of by the widget.

Clicking is then the app's own: a hit test against the placard layer, the
attributes taken straight off the graphic it returns — no second query, so this
reaches placards a `where` clause could not. Clicking the open one closes it,
the same gesture the player card uses; clicking nothing closes it too.

### The right-hand column

Two panels live in it, and both were previously somewhere worse. It mirrors
`.rail` on the left and sits inboard of the tool strip.

**The player card** was pinned to the player it described, which was the obvious
way to say who it was about and the wrong one. On a pitch a hundred metres
across it sat squarely over the half of the move worth watching, and there is no
position for a card that is both next to a running man and out of the way of a
running man. So the field says *who* and the card says *what*.

**Analysis** was a 740 px dock along the bottom that could only be opened by
closing the replay — which made it useless for the one scene in this app worth
measuring. It now opens over a running passage. The four modes go two-by-two in
a 268 px column rather than four across; shrinking the type to fit one line
would have put a 9 px label on a control.

#### The ring on the field

An orange annulus, three centimetres above the surface, under whoever is being
watched. Built once out of quads by `meshkit.ring()` and moved by a
`MeshTransform` exactly as the players are — a ring whose geometry was rebuilt
sixty times a second would be the most expensive thing in the scene, for a shape
that never changes.

On the ground rather than over the head, because a marker above a player covers
the player and the players are the point. It reads off the same interpolated
position the actor was just placed at rather than sampling the tracking again: a
ring half a step behind the man in it looks like a bug in the data.

A mark on the ground is how sport has always done this, and for the reason that
applies here — it survives the thing it marks being behind somebody else, off
the edge of a close shot, or one of twenty-two.

#### Clicking a player

The strip answers *what is happening*; clicking somebody answers *what about
him*. The card pins to that player, follows him in 3D, and **stays** — through a
scrub, a camera move, and the rest of the passage. That persistence is the
feature rather than a detail: a readout that vanished when the play moved on
would be a tooltip, and a tooltip cannot answer "did he actually accelerate
after the catch", because by the time it has been read the moment is gone.

It shows speed, acceleration (labelled *Slowing* when negative — braking is half
of what a cut is), distance to the ball, ground covered, and the player's own top
speed for the passage. All from `stats.trackAt()`, the same source as the strip,
so a card two inches from the panel cannot disagree with it.

Three things worth recording:

  * **Player graphics carry attributes now.** A mesh in a graphics layer is
    otherwise anonymous — `hitTest` hands back a graphic with nothing on it to
    match against a row of tracking.
  * **The pick is forgiving.** From the broadcast camera a player is about four
    pixels across; a click aimed carefully at a receiver's chest landed two
    pixels off the mesh and selected nothing. So the exact hit test runs first —
    it is the one that respects occlusion, and a cornerback behind the west
    stand should not be selectable through it — and only if that finds nobody
    does the nearest player within 22 px get taken. Not more than 22, because
    clicking away has to keep meaning "none of them".
  * **The card is positioned from the mesh transform, not the tracking.**
    `playerEN()` reads where the renderer actually put him. The renderer
    interpolates between source frames; asking the data again at the same
    instant agrees to a few centimetres when nobody is moving and disagrees
    visibly during a sprint — which is exactly when somebody is watching.

It follows on its own rAF loop rather than on the transport's, because the
transport only ticks while a passage runs and the card has to hold its place
while the play is paused and the camera is moved around a frozen moment, which
is most of what anybody does with it.

#### Pointing at somebody, unattended

The slideshow has nobody clicking it. Left alone it played six passages of real
sport beside a panel of numbers nobody had asked a question of, and the one
thing a viewer would want — *which of these twenty-two is the story* — never got
pointed at. So while the show is running itself, the card comes up on its own.

Both halves come out of the play's own events rather than a table of who scores
in which file, which would be wrong the first time a passage is rebuilt:

  * **Who** — whoever has the ball at the scoring event (`touchdown`, `goal`,
    `field_goal`), walked backwards when nobody does. That is not an edge case,
    it is the field goal: the ball is through the posts and forty metres from
    the nearest human at the moment it counts. It reuses the possession already
    computed per frame, so it cannot disagree with what the panel says about the
    same instant. Measured, it resolves unambiguously in all five scoring
    passages — the nearest offensive player is between 0.05 and 0.73 m away.
  * **When** — the last *committing* event that still leaves time to watch:
    `pass_forward`, `handoff`, `cross`, `intercept`, `switch` and the like.
    Deliberately not the arrivals and outcomes, and deliberately not the snap.

That gives the throw on the deep pass (4.5 s), the handoff on the run (2.7 s),
the kick on the field goal, the switch of play on the football (20.2 s) and the
interception on both of the others — between 2.9 and 14.2 seconds of watching,
and never earlier than a sixth of the way into a passage.

**It never argues with a person.** Any click on a player, any dismissal, and the
show does not get another turn for that passage. And opening a passage starts
clean — which is not housekeeping: arriving at the view from `?live`, the
previous playback was already past its cue, so a card went up *during the
flight* and was still there when the passage restarted at zero. Precisely the
thing the cue exists to avoid.

#### Saying what they are

These are computed in a browser from a recording. They are not sensor readings
and the app must not let anybody think otherwise.

The strip carried a `DERIVED IN BROWSER` pill for a while, on the principle the
forecast pill follows — that a caveat belongs beside the number it qualifies.
It was removed: the replay panel is the busiest thing on screen, and the
explanation is a click away in the rail under **How this was made**, where
somebody would look for it anyway. The forecast pill stays, because there the
caveat qualifies a *single figure that would otherwise read as a measurement*;
here the whole panel is plainly a reading of a replay, and the caption under it
already says the positions are measured rather than invented.

What is asserted, then, is that the sheet still says it and is still reachable —
`tools/statscheck.py` opens it from the rail and checks the words, because a
promise about honesty that nothing checks is a promise that quietly stops being
true.

The distinction the copy is careful about: **the tracking is real and recorded,
the analysis is real and local, and neither is live.** Step 05 of the info sheet
says that in as many words, and names [ArcGIS Velocity](VELOCITY.md) as what a
venue would actually run — a live feed rather than a file, many games rather than
one passage, and the answers kept rather than recomputed. `tools/statscheck.py`
asserts all of it, because a promise about honesty that nothing checks is a
promise that quietly stops being true.

### A day that has not happened

Everything else this app shows is the world as it is or as it was: live weather,
the real sun, captures of a morning that has been and gone, replays of passages
that were actually played. None of it is a prediction, and a model that can only
show the present wearing a different light is a 3D model with a clock on it.

The clock was already scrubbable to any hour and the sun already followed it.
The weather did not — nine tomorrow morning showed tomorrow's sun under today's
sky — so the fetch now asks for a week of hourly alongside the current reading
it was already taking off the same endpoint. A week rather than a day because
of the question this is for: not "what is it like tomorrow" but "what is it like
at kickoff", and kickoff is a fixture on a calendar.

`conditionsAt(when)` answers with the live reading if the instant is now and the
forecast hour if it is not, in the same shape, so nothing downstream has to ask
which it has. Half an hour of slack around live, because the hourly series is
stamped on the hour and the observation is not, and inside that window the
measurement wins.

Three things are worth knowing:

  * **The day is stepped, not scrubbed.** The track stays one day long: a slider
    spanning a week would need dates on its ticks and would make the ordinary
    job — move the sun a couple of hours — a game of precision. `‹ ›` either
    side of the readout move the day, bounded by what is known. Forward, the
    forecast runs out. Back, there is no yesterday: the endpoint is a forecast
    service and this app does not fetch history. Both ends grey the button out
    rather than clamping silently.
  * **The chip says which it is.** A temperature offered as a measurement and
    one offered as a prediction must not look the same, or the app is quietly
    asserting something it does not know. `FORECAST · +3 D` sits beside the
    clock — beside the thing that has been moved — and the Live pip goes cold.
  * **The sky holds through a transit.** The sweep towards midnight and the walk
    home from it both cross most of a day in about twenty seconds. Following the
    forecast hour by hour through that would rebuild the sky sixteen times,
    each transition interrupting the last, and flash "forecast" across the chip
    during the calmest shot in the app. `sky.travelling` holds it; where the
    clock lands is a state somebody is actually looking at, and that is where
    the question is worth answering.

Assigning `environment.weather` is not free, so `paintSky` takes `ifChanged` and
the tick uses it — the sky is rebuilt only when the hour it lands in is a
different hour. Everything else still asks unconditionally, because the other
callers are putting the sky back after a slide installed its own.

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
