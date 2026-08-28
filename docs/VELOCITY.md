# Player analytics through ArcGIS Velocity

The replays in this app are real tracking — twenty-two people and a ball at
10 Hz, from the NFL Big Data Bowl and from Metrica Sports — but they are a
recording, and a recording is not a feed. This describes turning one into the
other: a simulator that plays a passage back on a clock, a Velocity pipeline
that derives speed, closing distance and possession from it, and a stream the
app can subscribe to.

**Nothing here is wired into the app yet.** What exists is the foundation: the
transform, the simulator, a local stand-in for the receiver, and a check that
holds the first two to the app's own arithmetic. The pipeline itself is a
configuration exercise in an org, and the two open questions at the end have to
be answered before it is worth doing.

---

## The one design decision that matters

**Analytics are keyed to `t` — seconds into the passage — not to the wall
clock.**

The app's replay is scrubbable. It can be paused, restarted, dragged to the
catch and dragged back. A stream is a wall clock and cannot be dragged. Key the
derived numbers to wall-clock time and they are correct only while nobody
touches the transport; the moment somebody does, the figures on screen belong to
a different instant than the players on screen. That is worse than showing
nothing, because it is wrong without looking wrong.

Keyed to `t`, the client holds observations by their place in the passage and
shows whichever matches its own playhead. Scrubbing works. Pausing works.
Network jitter stops mattering, because the stream can run *ahead* of real time
and fill a buffer.

The division of labour follows from it:

| | |
|---|---|
| **Positions** | stay local, 10 Hz, from `data/*.json` — the visual quality is not negotiable and a socket cannot improve it |
| **Derived analytics** | come from Velocity, keyed by `t` |
| **The clock** | belongs to the app, always |

`ts` is still sent and is still the wall clock, because Velocity wants a time
field of its own and the archive should record when a thing was observed. The
two are not interchangeable. **The client must read `t`.**

---

## What goes in

One JSON object per tracked thing per frame; a frame posts as one array of 23.

```json
{
  "play":    "gridiron",        
  "kind":    "player",          // player | ball
  "track":   "off-WR-2",        // stable within a play — see below
  "side":    "off",             // off | def | ball
  "pos":     "WR",
  "frame":   43,
  "t":       4.3,               // seconds into the passage — the sync key
  "ts":      "2026-08-28T08:12:03Z",
  "phase":   "pass_forward",    // the play event at or before this frame
  "lon":     -105.0203,
  "lat":     39.7441,
  "z":       0.0,               // metres above the surface; ball only
  "heading": 271.4              // compass degrees; players only
}
```

**`track` is synthesised, and has to be.** The feeds give a position label, and
position is not an identity: a gridiron play carries two tackles, two guards,
three receivers, two free safeties, two defensive tackles and three corners.
`side-pos-n` is stable across frames, survives the file being rebuilt, and still
means something on a chart, which an array index does not. Calculate Motion
Statistics cannot work without it.

**The ball is a track like any other.** Join Features needs something to join
the players *to*, and the ball's own speed is worth having — a throw and a
handoff are the same event to a possession rule and nothing alike to a
speedometer.

**Nothing derived is sent.** No speed, no distance, no possession. Computing
those here and shipping the answers would make the pipeline a file transfer with
extra steps; they are the entire reason Velocity is in the picture.

Volume: 23 tracks × 10 Hz = **230 events/sec**, ~4,500 per gridiron passage and
~8,600 per football one. Modest, but it is real capacity while it runs — this is
a demo feed to start and stop, not something to leave on.

---

## Feed

| | |
|---|---|
| Type | **HTTP Receiver** |
| Format | JSON, array or single object |
| Track field | `track` |
| Time field | `ts` |
| Geometry | `lon` / `lat`, WGS84 |

A receiver rather than a poller because the simulator is pushing on the
passage's own clock, and a poller would impose a second one.

---

## Analytics

Three tools, in this order. The first is the one that earns Velocity its place.

### 1. Calculate Motion Statistics → speed, acceleration

Reads the last *n* observations of a track (`History Depth`) and returns speed,
acceleration, distance travelled, time since the previous observation, whether
the track is idling, and min/max/average/cumulative values across the window.

**Speed and acceleration are configuration, not code.** At 10 Hz a History Depth
of 3–5 smooths the sample noise without lagging a cut; worth tuning against a
change of direction rather than a straight run.

### 2. Join Features → distance to the ball, closing rate

Stateful. Join each player observation against the ball's latest-state feature
layer, then Calculate Field for the separation. Closing *rate* is the change in
that separation between observations.

*This is the part to prototype first.* The join is a cross-track operation and
the tool is documented around geofences and enrichment rather than
track-to-track distance; whether it is clean enough at 10 Hz, or wants the ball
buffered instead, is a question to answer with a small pipeline before building
on it.

### 3. Detect Incidents → possession change

Opens on a condition, emits `Started`, tracks it, emits `Ended` when it closes.
The natural formulation is *open* when a player's distance to the ball drops
below a threshold and `side == "off"`, *close* when it rises again.

Hardest of the three, because possession is cross-track state and the rule has
to survive a ball in flight — during a pass nobody is in possession, and a rule
that does not say so will hand the ball to whichever lineman is nearest to its
shadow. `phase` is carried on every observation for exactly this: `pass_forward`
through `pass_arrived` is a window where the answer should be "nobody".

---

## What comes out

| Output | Why |
|---|---|
| **Stream layer** | the live tick the app subscribes to |
| **Feature layer, all observations** | **the archive** — the real reason for any of this |
| **Feature layer, latest state** | so a cold-loaded client has something before the next tick |
| **Incidents** → layer or webhook | possession changes, closing distance under a yard |

The archive is the point worth defending. Everything on screen could be computed
in the browser from data already in memory, at perfect sync and with no
dependencies — and it should be, as the fallback. What a browser cannot do is
accumulate: every passage ever streamed lands in a feature layer, and *"show me
every snap where closing distance dropped under a yard"* becomes a query instead
of a wish.

**Stream layers do not persist.** Open the app cold and the screen is empty until
the next observation arrives. Pair every stream layer with the latest-state
feature layer, or the demo opens on nothing.

---

## Running it today, with no org

```
propy tools/mockreceiver.py                       # stands in for the receiver
propy tools/simulate_play.py --url http://127.0.0.1:8799/ --play gridiron
propy tools/simulate_play.py --out frames.json    # or just look at the events
propy tools/serve.py 8791 && propy tools/simcheck.py   # hold the port to the app
```

| File | |
|---|---|
| `tools/playfield.py` | the field transform, ported from `js/play.js` |
| `tools/simulate_play.py` | a passage, replayed on a clock, posted as events |
| `tools/mockreceiver.py` | a local HTTP Receiver, so none of this needs an org |
| `tools/simcheck.py` | proves the port still agrees with the app |

`simcheck` is not ceremony. The failure mode of a hand-ported coordinate
transform is silent: get the rotation, a flip or a surface dimension subtly
wrong and the simulator still emits twenty-three convincing tracks moving
convincingly about a field — just not *the* field. It would surface as a
geofence that never fires, three steps and one org away from the cause. So the
constants are checked against the running app rather than trusted, through the
app's own public surface, and both sports are exercised because they normalise
different units: yards on a 109.7 m field, metres on a 105 m pitch. Currently
exact to floating point.

---

## Open before it is worth building

1. **Can a Velocity output be shared to Everyone and consumed anonymously?**
   This app has no authentication and is served from three hosts. It could not be
   confirmed from the documentation. It is the difference between "works in the
   demo" and "works only when signed in", and it decides whether any of this
   reaches the app at all.

2. **Is the browser fallback the primary?** The honest answer is probably yes:
   compute the analytics client-side from the same JSON, ship that, and let
   Velocity be the archive, the incident engine and the deployment story rather
   than the source of what is on screen. That also gives a reference to check the
   pipeline against — *"these two agree"* is a better demonstration than either
   number alone.
