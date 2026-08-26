/**
 * Sports Venue Digital Twin — reality mapping explorer
 * ArcGIS Maps SDK for JavaScript 5.x, loaded as ES modules from the CDN.
 * No build step: the scene is public, so there is nothing to authenticate.
 */

import esriConfig from "https://js.arcgis.com/5.0/@arcgis/core/config.js";
import WebScene from "https://js.arcgis.com/5.0/@arcgis/core/WebScene.js";
import SceneView from "https://js.arcgis.com/5.0/@arcgis/core/views/SceneView.js";
import * as reactiveUtils from "https://js.arcgis.com/5.0/@arcgis/core/core/reactiveUtils.js";
import { manageNearPlane } from "./nearplane.js";
import SunnyWeather from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/environment/SunnyWeather.js";
import CloudyWeather from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/environment/CloudyWeather.js";
import RainyWeather from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/environment/RainyWeather.js";
import SnowyWeather from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/environment/SnowyWeather.js";
import FoggyWeather from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/environment/FoggyWeather.js";
import { addJumbotron, attachTuner } from "./jumbotron.js";
import { addMilkyWay, sunAltitudeDeg } from "./milkyway.js";
import { addSurfaces } from "./field.js";

/**
 * The tool widgets, fetched the first time somebody opens a tool.
 *
 * These are the deepest imports in the app by a distance - the measurement
 * widgets alone drag in the symbol and unit graphs - and on a first load none
 * of it is on screen or reachable: the panels start closed. Imported at the top
 * of this file they sat on the critical path anyway, and because the CDN serves
 * one HTTP request per module, the cost is not the 2.9 MB but the depth of the
 * waterfall: several hundred round trips before the first frame.
 *
 * Kept as a promise so a second click while the first is still in flight waits
 * on the same request instead of starting another.
 */
let measureKit = null;
const loadMeasureKit = () => (measureKit ??= Promise.all([
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/DirectLineMeasurement3D.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/AreaMeasurement3D.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/ElevationProfile.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/ElevationProfile/ElevationProfileLineGround.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/ElevationProfile/ElevationProfileLineView.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/analysis/VolumeMeasurementAnalysis.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/Sketch/SketchViewModel.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/layers/GraphicsLayer.js")
]).then(([d, a, ep, epg, epv, vma, svm, gl]) => ({
  DirectLineMeasurement3D: d.default,
  AreaMeasurement3D: a.default,
  ElevationProfile: ep.default,
  ElevationProfileLineGround: epg.default,
  ElevationProfileLineView: epv.default,
  VolumeMeasurementAnalysis: vma.default,
  SketchViewModel: svm.default,
  GraphicsLayer: gl.default
})));

let timeKit = null;
const loadTimeKit = () => (timeKit ??= Promise.all([
  import("https://js.arcgis.com/5.0/@arcgis/core/widgets/TimeSlider.js"),
  import("https://js.arcgis.com/5.0/@arcgis/core/time/TimeExtent.js")
]).then(([ts, te]) => ({ TimeSlider: ts.default, TimeExtent: te.default })));
import Camera from "https://js.arcgis.com/5.0/@arcgis/core/Camera.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";
import { styleLights } from "./lights.js";
import { addPlay, broadcastCamera } from "./play.js";
import { sectionCamera, sections, ringOf, sectionPlan, RINGS } from "./seats.js";
import { flyLap } from "./flyin.js";
import { dressSelects } from "./selectmenu.js";

// Widget icons, workers and localisation are fetched relative to this path.
esriConfig.assetsPath = "https://js.arcgis.com/5.0/@arcgis/core/assets";

const CONFIG = {
  webSceneId: "2ecd0214d1c940fca2789d0146069786",

  // Capture groups, rendered in order. Each gets a tri-state master switch and
  // a child row per layer. `title` matches the web scene's layer title; add a
  // new splat or mesh by adding a line here.
  // `open: true` means the group is visible when the app opens.
  // The captures, and what is on screen when. `open` is how the app opens -
  // the drone splat alone, which is the wide establishing shot. `live` is what
  // a replay wants, which is the opposite: from a seat inside the bowl the
  // splat reads worse than the mesh, and the saved views for the two fan
  // perspectives are authored the same way.
  groups: [
    {
      label: "Splats", open: true, live: false,
      layers: [
        { title: "Gaussian Splat", label: "Stadium", kind: "Drone" }
        // { title: "Statues Splat", label: "Statues", kind: "Handheld" },
        // { title: "Horses Splat",  label: "Horses",  kind: "Handheld" },
      ]
    },
    {
      // `live` may be set per layer as well as per group. A replay is watched
      // from inside the bowl and the two hand-held captures are out on the
      // concourse, so they are never once in shot - and an integrated mesh
      // costs the same whether or not it is in front of the camera. Leaving
      // them on carried a couple of hundred textures into the heaviest moment
      // the app has, which is a phone's whole budget spent on something nobody
      // can see.
      label: "Meshes", open: false, live: true,
      layers: [
        { title: "3D Mesh",               label: "Stadium",          kind: "Drone" },
        { title: "Broncos Stampede",      label: "Broncos Stampede", kind: "Handheld", live: false },
        { title: "Bronco Alumni Statues", label: "Alumni Statues",   kind: "Handheld", live: false }
      ]
    }
  ],

  // What has to be in the browser's cache before Explore unlocks.
  //
  // The hand-held meshes are far the slowest thing here: four integrated mesh
  // services, and not one byte of them is touched until a viewer reaches view
  // 5, because every mesh starts switched off. So the wait lands squarely on
  // the views that show them off. Measured cold, views 5 to 8 pull 152 MB
  // between them and each takes 5 to 11 seconds to settle on a fast desktop
  // connection.
  //
  // Loading them behind the curtain moves that wait to where a viewer is
  // already waiting, and it holds: a view that has been loaded once costs 6%
  // of its first visit to come back to. Everything here is a ceiling rather
  // than a target - whatever is warm when the budget runs out is what a viewer
  // gets, and entry is never held up beyond hardCapMs.
  preload: {
    enabled: true,
    // Named, not numbered, for the same reason CONFIG.views is: a slide added
    // or deleted in the web scene shifts every position after it, and this
    // would quietly start warming the wrong views. Between them these three
    // cover all the hand-held captures and the combined view.
    // Matched loosely - see slidesNamed - because these are fragments of slide
    // titles rather than the whole of them. Two of these three stopped matching
    // when the scene was retitled and nothing said so: the views went on
    // working, they were simply never warmed, and the only symptom was that the
    // hand-held captures were slow again.
    views: ["Pix4DCatch", "Broncos Alumni", "Built with ArcGIS"],
    // How many of those must be warm before Explore opens. The rest are warmed
    // behind a curtain that is only still up because nobody has clicked yet,
    // and are abandoned the moment somebody does - warming means moving the
    // camera, and after the click that would be on screen. 1 buys the view a
    // viewer reaches first, which is also the dearest, for about seven seconds.
    beforeUnlock: 1,
    perViewMs: 11000,     // no single view may hold the curtain longer
    budgetMs: 24000,      // nor all of them together
    // Long enough for view 1 to look finished, and no longer. Measured from
    // the moment the view is ready, which is about three seconds in: at six
    // more the stadium is fully formed and the jumbotron lettering is legible,
    // and the remaining thirty megabytes are the scene sharpening itself -
    // which it does perfectly well with somebody already looking at it.
    firstViewMs: 6000,
    settleMs: 900,        // "loaded" is this long with nothing left in flight
    hardCapMs: 60000      // whatever goes wrong, entry unlocks by here
  },

  // Nothing that plays itself starts the instant a flight lands. The camera
  // arrives before the scene does - tiles are still coming in, the surface is
  // still cross-fading - and a replay or a sun sweep beginning into that reads
  // as the app tripping over itself. So an arrival waits for the view to go
  // quiet, and gives up waiting at maxMs so a scene that never settles still
  // gets its animation.
  arrival: { quietMs: 500, maxMs: 3000 },

  flyDuration: 2600,

  // One lap of the ground before the first replay.
  //
  // Named by the view it lands on, not by a number, for the reason CONFIG.views
  // is. It runs only when the slideshow is running and only when arriving there
  // from the view immediately before, so stepping through by hand still cuts
  // straight to the seat.
  //
  // `legs` are waypoints, not a path: a single flight between two distant
  // cameras interpolates the route as well as the ends, and the arc it picked
  // sagged through the terrain. Each leg is somewhere the camera is known to be
  // able to stand - a bearing clockwise from north, a distance from the middle
  // of the field, a height above the playing surface - so nothing between them
  // can end up underground. Everything stays outside 260 m, which is clear of
  // the roof.
  //
  // `swap` is the useful half. The mesh the replay needs is switched on as the
  // lap begins with its opacity at nothing, so it streams for the whole turn
  // without anybody watching it arrive, and is faded up over the splat on the
  // last leg. The cut from splat to mesh at the seat becomes a dissolve, and
  // the seat is reached with the mesh already there.
  flyIn: {
    enabled: true,
    to: ["Gameday Experience (American Football)",
         "Fan Perspective (American Football)"],
    // Only the first time round. A lap is worth fifteen seconds once; on every
    // loop of a slideshow it is fifteen seconds of the same thing.
    once: true,
    // Waypoints on one path, not a list of flights.
    //
    // The camera is driven frame by frame through these - see flyin.js for why
    // - so they are shaping a single move rather than being places it stops.
    // Each is a bearing round the ground, a distance from the middle of it and
    // a height above the playing surface; the sweep runs the short way from
    // wherever the opening view left the camera round to the seat.
    //
    // It starts on the camera already in place and ends on the slide's own, so
    // neither end of the move needs a number here. It flies in through the side
    // of the building on the way to the seat, which is a thing a camera cannot
    // do and a drone shot does all the time.
    // Spaced evenly around the sweep, which matters more than where exactly
    // they are. The camera runs through the path on a uniform parameter, so a
    // segment twice as wide as its neighbour is covered at twice the speed -
    // and these were spaced for a shorter arc that ended at the old stand
    // camera. Left alone after the move to broadcast they read 45, 38, 14 and
    // 67 degrees, and the last one was the lurch at the end.
    // Evenly spaced in every quantity, not just in bearing. Spacing only the
    // bearings left the distance to close 20, 107, 102 and 15 metres across the
    // four quarters of the move - almost all of the approach happening in the
    // middle half of it, which reads as a rush rather than as an arrival.
    path: [
      { bearing: 34, out: 302, up: 68, tilt: 76 },
      { bearing: 353, out: 241, up: 76, tilt: 69 },
      { bearing: 312, out: 180, up: 83, tilt: 62 }
    ],
    ms: 12500,
    // The mesh is held back until the camera is through the roof.
    //
    // Warming it from the start of the move was the obvious thing and it looks
    // wrong: the mesh is opaque geometry and the splat is not, so while both are
    // on the mesh simply occludes it - and the stretch where that matters most
    // is the crossing, where the camera is inside the building and the mesh is
    // the weaker reconstruction of the two by some distance.
    //
    // So it comes on once the camera is inside, which is also the first moment
    // it would be fetching anything useful: the tiles it needs are the ones for
    // the seat, and those are only worth asking for from somewhere near it. It
    // then has the rest of the move, and the arrival wait after it, to arrive.
    swap: { on: "3D Mesh", onAtT: 0.82, off: "Gaussian Splat", offAtT: 0.94 }
  },

  // How long a view is held before the tour moves on, once the flight to it
  // has finished, and once it has finished loading - see slideSettle. The
  // flight itself is flyDuration on top of this.
  //
  // This is what the capture views get. The two replays and the night sky
  // name their own in CONFIG.views, because they are each holding for
  // something specific to finish.
  slideDwellMs: 6500,

  // When the dwell above starts counting.
  //
  // It used to start the moment the flight landed, which is right only if
  // the view has arrived as well as the camera. On a fast connection it very
  // nearly has. On a slow one it has not: the integrated meshes are still
  // streaming, and the slideshow was walking past a capture while the thing
  // it was captured to show was still drawing itself - so the viewer who
  // most needed the pause was the one who did not get it.
  //
  // So the dwell waits for the scene to stop fetching first. A fast
  // connection pays quietMs for the privilege and is otherwise unchanged;
  // a slow one is given exactly as long as it turns out to need. The cap is
  // there so a connection that never goes quiet cannot park the show
  // indefinitely - reaching it moves on regardless.
  slideSettle: { quietMs: 700, maxMs: 12000 },

  // What a view does when you arrive at it.
  //
  // Matched on the slide's own title, not its position. Numbering these was a
  // trap waiting to spring: deleting one slide from the web scene shifts every
  // one after it, and the night sky, the sun sweep and the two replays would
  // have quietly moved onto whichever views happened to inherit the numbers.
  // A title is what the author actually chose, and it survives reordering.
  //
  //   clock    force the site's local wall clock to this, and put it back on
  //            the way out, so a view authored for the dark is always dark
  //   sky      insist on a weather for as long as the view is on screen
  //   opens    a tool panel ("time", "measure") or a play key, on arrival
  //   dwellMs  how long the slideshow holds it, where the default is too short
  //
  // `dwellMs` matters for a view that exists to show something happening: hold
  // it for less than that thing takes and the show cuts away mid-way, which is
  // what it did to the sun walking down to midnight.
  //
  // A view whose `opens` names a play is flown to on the broadcast camera,
  // which is computed from the playing surface rather than saved on the slide -
  // see broadcastCamera in play.js. The slide's own camera is not used, so
  // renaming or re-saving these views cannot move where the replay begins.
  views: [
    // Both night views want their stars. An overcast ceiling hides them, and
    // whether it happens to be cloudy in Denver tonight should not decide
    // whether these two work.
    // `clockMs` walks the sun down instead of cutting to half ten. Arriving
    // here from the football, which runs on real time, the cut was the whole of
    // the afternoon in one frame - the flight starts and the world is already
    // dark. Walked instead, it reads as dusk falling while the camera moves.
    //
    // How far it has to walk depends entirely on when somebody opens the app,
    // which is the one thing here that is not fixed: at two in the afternoon it
    // is eight hours of sun in four seconds, and at nine in the evening it is
    // barely one. The duration is held constant rather than the rate, because a
    // constant rate would mean a thirty-second sunset at midday.
    { title: "Stadium at Night", clock: "22:30", clockMs: 4200, sky: "sunny" },
    // Arrives at half ten, then walks the sun down towards midnight. "24:00" is
    // the end of the local day, not the start of it. The stop is deliberately
    // shorter than the sweep - a viewer watches the stars travel a stretch of
    // sky, not the whole walk.
    { title: "Night Sky", clock: "22:30", sky: "sunny",
      opens: "time", sweepTo: "24:00", sweepMs: 26000, dwellMs: 7500 },
    // Long enough for the replay each one starts, which is why these are not
    // the same number: the gridiron pass runs 19.7 s and the football goal
    // 37.5. Both allow for the pause before a replay begins - see
    // CONFIG.arrival - and a moment on the celebration afterwards.
    // Two names each, newest first. A title is what the author chose and they
    // are still choosing; listing the previous one costs nothing and means a
    // rename in the scene does not quietly take the replay, the opening pass
    // and the dwell with it.
    { title: ["Gameday Experience (American Football)",
              "Fan Perspective (American Football)"],
      // Sized for the replay alone. The opening pass runs before this one and
      // takes twelve seconds of its own, so the two together were holding this
      // view for the better part of a minute.
      opens: "gridiron", dwellMs: 16000 },
    { title: ["Gameday Experience (Football)", "Fan Perspective (Football)"],
      opens: "football", dwellMs: 44000 }
  ],


  // Opening camera. The web scene's own initial viewpoint is used when this is
  // null. Press C in the running app to print the current camera, then paste it
  // here — this is app-side only and does not touch the web scene.
  home: null,


  // Empower Field at Mile High — used for the live weather lookup.
  site: { lat: 39.7439, lon: -105.0201, tz: "America/Denver" },

  // Layers shown only after dark, driven by the same clock as the sky — so they
  // follow the time slider as well as live time. Matched on layer title; the
  // first one found wins, so several spellings can be listed.
  nightLayers: {
    titles: ["Mile High Stadium Lights", "MileHigh_StadiumLights_v2",
             "Stadium Lights", "Mile High - Stadium Lights"],
    // Sun altitude at which they switch on. -0.83 is geometric sunset; a few
    // degrees lower matches when it actually looks dark.
    sunBelowDeg: -3,
    // Which fixtures belong to the ground rather than to the street.
    //
    // The layer types every light: roof floodlights and aisle step lights are
    // the stadium's own and go out with the switch, while parking poles and
    // plaza lamps are the car park's and stay lit whatever is happening inside
    // - nobody turns the car park off because the game has finished.
    //
    // Matched on the layer's own `category` field, so a fixture type added
    // later is lit by default rather than silently switched.
    switched: ["Roof floodlight", "Aisle step light"],
    categoryField: "category",
    // And the altitude at which the *scene* is lit artificially, which is a
    // different question and a much earlier moment. A bowl shades its own field
    // long before the sun is down - the stands are sixty metres of it - so a
    // ground has its floodlights up while the sky outside is still bright.
    // Six degrees is roughly half an hour before sunset here.
    litBelowDeg: 6
  },

  // The field was covered when the site was captured, so it renders as a grey
  // slab in both the splat and the mesh. Measured off the splat: the slab is
  // 130 x 76.6 m, long axis 0.59 deg east of north. A regulation field is laid
  // on it, 8 cm proud so it wins the depth test without floating.
  field: {
    enabled: true,
    lat: 39.74392969,
    lon: -105.02011614,
    // Top of the splat's field cloud (p92), not its modal height - gaussians
    // have volume, so the visible surface sits above the point centres.
    z: 1582.53,              // EGM96 / gravity-related
    zEllipsoidal: 1564.73,
    // Raised clear of both captures. The splat's field cloud reaches ~1.8 m
    // above its modal height and the mesh sits higher still, so this is the one
    // number to tune. Settled at 1.8 by eye - 2.6 cleared both but read as
    // floating. Try a value live with __field.setLift(1.4), which returns the
    // resulting z.
    lift: 1.8,
    groundEgm96: 1582.05,    // measured ground beneath the field, both ways
    groundEllipsoidal: 1564.25,
    rotation: -0.59,         // degrees about local up, to meet the measured axis
    // Two painted surfaces on the one slab, cross-faded between. The slab is
    // 130 x 76.6 m, which holds either. `depth` is the long axis, north-south.
    default: "gridiron",
    surfaces: {
      // Regulation, so that the markings measure true in the app: 120 yd end
      // line to end line and 53 1/3 yd across, which is 109.728 x 48.768 m and
      // the 2.25:1 aspect the texture is drawn at. Goal line to goal line then
      // comes out at exactly 100 yd (91.44 m).
      //
      // This was 113.40 x 50.40, taken from measuring the grey slab in-app. But
      // the slab is the whole covered area, not the field: sizing the texture to
      // it stretched every yard to 0.945 m, so the field measured 103.3 yd
      // between the goal lines. The slab is 130 x 76.6 m and still holds this
      // comfortably - there is simply a little more of it showing round the edge.
      gridiron: { width: 48.768, depth: 109.728, texture: "./assets/field.jpg" },
      // A full-size pitch at the top of the permitted range, with an apron of
      // grass around it as a real ground has.
      //
      // `width`/`depth` are the painted slab; `play` is the marked pitch inside
      // it. The two have to be told apart or everything that measures itself
      // against the surface stretches to fill the apron - players would stand
      // eight metres wide of their own markings and the goals would sit four
      // metres behind the goal line.
      pitch: {
        width: 74.00, depth: 113.00, texture: "./assets/pitch.jpg",
        play: { width: 68.00, depth: 105.00 }
      }
    }
  },

  // Passages of play replayed on the slab. Each entry names its data file; the
  // file itself declares its coordinate space and which surface it needs.
  //
  // Both are driven by real tracking: the gridiron play from the NFL's own
  // public 10 Hz release, the football goal from Metrica Sports' open 25 Hz
  // sample data (anonymised at source, resampled to 10). Each file records its
  // own provenance in `meta`, and the caption is written from that, so a play
  // can never describe itself as measured when it is not.
  //
  // The two flip flags decide which way a play runs and which touchline is
  // which. They depend on how the texture landed on the quad, so they are set
  // by looking, not by derivation.
  play: {
    enabled: true,
    // The replays on offer, grouped in the chooser by `sport` in the order they
    // appear here. `key` is the identity used everywhere else - by CONFIG.views
    // to open one on arrival at a saved view, by the ?live and ?goal deep
    // links, and by the fan camera to find the view it belongs to - so it is
    // the one field that must not be renamed lightly. `icon` names a symbol in
    // index.html; plays of one sport share it.
    plays: [
      { key: "gridiron", surface: "gridiron", sport: "American Football", icon: "ico-gridiron",
        label: "Deep pass", note: "75 yd touchdown", data: "./data/play.json" },
      { key: "gridiron-run", surface: "gridiron", sport: "American Football", icon: "ico-gridiron",
        label: "Run right", note: "21 yd touchdown", data: "./data/play_run.json" },
      { key: "gridiron-fg", surface: "gridiron", sport: "American Football", icon: "ico-gridiron",
        label: "Record field goal", note: "68 yd, modelled",
        data: "./data/play_fieldgoal.json" },
      { key: "football", surface: "pitch", sport: "Football", icon: "ico-football",
        label: "Turnover to goal", note: "Tackle to finish", data: "./data/soccer.json" },
      { key: "football-header", surface: "pitch", sport: "Football", icon: "ico-football",
        label: "Cross and header", note: "Won back, crossed",
        data: "./data/soccer_header.json" },
      { key: "football-counter", surface: "pitch", sport: "Football", icon: "ico-football",
        label: "Intercept and break", note: "The length of the pitch",
        data: "./data/soccer_counter.json" }
    ],
    flipAlong: false,
    flipAcross: false,
    speed: 1,
    // Broadcast camera: just past the touchline and well up, tracking the ball.
    // Distances in metres from the near touchline. `out` has to stay small:
    // the seating deck begins almost at the sideline, so anything beyond about
    // 12 m puts the camera inside the stand and the capture occludes the field.
    // Player Highlight: how far out past the touchline, how high, and how
    // lazily the aim follows the ball. `lag` is a time constant in seconds -
    // roughly how long the pan takes to cover most of the distance to the ball.
    // It used to be a fraction applied once per update, which only meant
    // anything while the update rate was fixed; see followLoop(). `settle` is
    // how long the swing in from wherever the camera already was takes.
    camera: { out: 4, up: 30, lag: 0.66, settle: 1.2 },
    // Where the view is taken to once, when the panel opens, so the surface is
    // actually on screen. `up` is metres above the turf - high enough to clear
    // the roof rim, since inside the bowl the capture's own geometry gets
    // between the camera and the grass. `fill` is the slant distance as a
    // fraction of the surface's length.
    //
    // These two trade against each other and the roof is the constraint. The
    // rim sits at 100-133 m radius and 36-49 m up, so the camera has to stay
    // inside 100 m horizontally or the catwalk and light towers get in front of
    // it - which rules out buying coverage by backing away. Coverage comes from
    // height instead. SceneView's fov is horizontal, so the slant distance
    // needed to frame the long axis is about length / (2 tan 27.5deg), and 1.35
    // leaves a little air at each end.
    frame: { up: 88, fill: 1.35 }
  },

  // Galactic band painted into the sky pixels, placed by real sidereal time.
  // `gain` 0.35 is a whisper, 0.7 restrained, 1.4 clear. Set enabled:false to
  // drop the whole render pass.
  // Getting close to a hand-held capture is the whole point of having one, and
  // by default the renderer will not let you: it fixes the near clipping plane
  // at far / 20000, which in this scene is a little over 10 m, so anything
  // nearer is sliced away. See nearplane.js for the measurements. Near the
  // ground the planes are pulled towards the camera together, keeping the
  // renderer's own far:near ratio so depth precision is unchanged; above about
  // 120 m the two agree and it hands back, so every slide is untouched.
  clip: {
    enabled: true,
    ground: 1582.5,    // plaza level, same datum as field.z - altitude is measured from here
    margin: 12,        // near sits at a twelfth of the height above the plaza
    near: 0.05,        // metres; never closer than this
    far: 6000,         // metres; never shorter than this, so the city stays in view
    release: 1.6,      // hysteresis: hand back to "auto" only well clear of the boundary
    maxRatio: 20000    // never spend more depth precision than the SDK does
  },

  milkyWay: { enabled: true, gain: 0.7, texture: "./assets/milkyway.jpg" },

  // The SDK's cloudCover is far heavier visually than the raw percentage
  // suggests - 1.0 is a solid lid that flattens the whole scene. Real cover is
  // compressed into `cap`, and only genuinely stormy conditions (thunderstorms,
  // or heavy precipitation) are allowed up towards `stormCap`.
  weather: { cloudCap: 0.55, stormCloudCap: 0.9, wetFloor: 0.4 },

  weatherRefreshMs: 10 * 60 * 1000,
  clockTickMs: 30 * 1000,   // sun + clock advance between fetches, no network

  // South video board. Both the splat and the drone mesh render it badly, so it
  // is covered with a black emissive panel. Geometry measured off the splat and
  // checked against in-app measurements; see the README for how it was derived.
  jumbotron: {
    lat: 39.74289797,
    lon: -105.02011326,
    // Two candidates, because the measurement and the scene disagree on datum:
    // the tileset's transforms are ECEF (ellipsoidal), while the scene's layers
    // declare gravity-related heights (the mesh is EGM96 / vcsWkid 5773). The
    // separation here is -17.8 m. resolveZ() probes the ground and picks.
    z: 1619.15,              // EGM96 / gravity-related
    zEllipsoidal: 1601.35,
    groundEgm96: 1586.41,    // measured ground beneath the board, both ways
    groundEllipsoidal: 1568.61,
    // Board face measured in-app at 67.24 x 21.96 m, plus a margin. That spans
    // the full structure (E -34..+34 in the local frame), with the top edge
    // stopping just under the EMPOWER FIELD signage band.
    width: 70.0,
    height: 22.6,
    // Yaw fitted to the board's own outer-face profile, which is flat and very
    // nearly due north (N = -105.87 +/- 0.35 m across all 68 m). An earlier
    // +2.33 here was fitted to the bezel shell and was 2.5 deg out, which tilts
    // a 70 m panel by 3 m end to end: one end punched through, the other floated.
    rotation: -0.17,         // degrees about local up, off north-facing
    // lat/lon above put the panel flush ON the fitted face plane. Flush is not
    // usable: the splat's gaussians are volumetric, so any centred in front of
    // the plane smear across the panel. This lifts it clear uniformly - the
    // clearance is now the same 1.70 m at both ends, and the worst local bump
    // on the face still passes 0.66 m behind it.
    standoff: 1.7,           // metres along the outward normal
    logo: "https://www.arcgis.com/sharing/rest/content/items/eae20c3d3d514423b9c91f135fdea468/data"
  }
};

/**
 * UTC offset of an IANA zone, in hours, computed locally. The weather API also
 * reports this, but waiting for a network round trip to know where the sun is
 * would leave the scene in daylight until the request lands.
 */
function utcOffsetHours(tz, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(p.year, p.month - 1, p.day,
    p.hour === "24" ? 0 : p.hour, p.minute, p.second);
  // Not at.setMilliseconds(0): that mutates the caller's Date.
  return Math.round((asUTC - (at.getTime() - at.getMilliseconds())) / 36e5 * 4) / 4;
}

/**
 * The instant at which the wall clock in `tz` reads hh:mm, on whichever day
 * `at` falls on there. Two passes, because the offset depends on the instant:
 * on a clock-change day the first guess can land the wrong side of the change.
 */
function localInstant(tz, hh, mm, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(at).map((x) => [x.type, x.value]));
  const wall = Date.UTC(p.year, p.month - 1, p.day, hh, mm);
  let t = wall - utcOffsetHours(tz, new Date(wall)) * 36e5;
  t = wall - utcOffsetHours(tz, new Date(t)) * 36e5;
  return new Date(t);
}

const $ = (id) => document.getElementById(id);
const els = {
  intro: $("intro"), fill: $("loadfill"), msg: $("loadmsg"), enter: $("enter"),
  masthead: $("masthead"), captures: $("captures"),
  seatSheet: $("seatSheet"), seatSelect: $("seatSelect"), seatMap: $("seatMap"),
  playSeatLabel: $("playSeatLabel"), lightsBtn: $("lightsBtn"),
  seatWhere: $("seatWhere"), seatTake: $("seatTake"),
  seatPrev: $("seatPrev"), seatNext: $("seatNext"), playSeat: $("playSeat"),
  capturesBtn: $("capturesBtn"),
  captureGroups: $("captureGroups"),
  capturesToggle: $("capturesToggle"),
  rail: $("rail"), tour: $("tour"), prev: $("prev"), next: $("next"),
  tourPlay: $("tourPlay"), tourIcon: $("tourIcon"),
  idx: $("tourIdx"), title: $("tourTitle"),
  tools: $("tools"), home: $("home"), measure: $("measure"), hud: $("hud"),
  timeOfDay: $("timeOfDay"), tpanel: $("timePanel"), thost: $("timeHost"),
  tlive: $("timeLive"), tclose: $("timeClose"), treadout: $("timeReadout"),
  shadowToggle: $("shadowToggle"),
  mpanel: $("measurePanel"), mhost: $("measureHost"),
  mclear: $("measureClear"), mclose: $("measureClose"),
  info: $("info"), infoSheet: $("infoSheet"),
  live: $("live"), liveMenu: $("liveMenu"),
  ppanel: $("playPanel"), ptoggle: $("playToggle"),
  picon: $("playIcon"), pscrub: $("playScrub"), pmarks: $("playMarks"),
  pphase: $("playPhase"), pclock: $("playClock"), pcap: $("playCaption"),
  ppicks: $("playPicks"), pchalk: $("playChalk"),
  pcams: [...document.querySelectorAll("#playCams .camseg__b")],
  pclose: $("playClose"), prestart: $("playRestart"),
  precenter: $("playRecenter"),
  weather: $("weather"), wxIcon: $("wxIcon"), wxTemp: $("wxTemp"),
  wxDesc: $("wxDesc"), wxTime: $("wxTime"), wxSun: $("wxSun"),
  wxLive: $("wxLive"), wxPick: $("wxPick"), wxMenu: $("wxMenu"),
};

/**
 * The loading bar.
 *
 * Milestones arrive in a rush and then stop: the SDK, the scene and the view
 * are all in hand within about three seconds, and the ten seconds after that
 * are one long wait for geometry. Drawn literally that is a bar which fills
 * almost completely, freezes, and reads as a hang.
 *
 * So the bar is driven by time rather than by events, and mostly it is not
 * guessing: the two long stages have budgets - CONFIG.preload.firstViewMs and
 * perViewMs - and the bar simply spends them. Only the opening stretch, where
 * the SDK is loading and nothing can be timed, is a genuine invention, and it
 * eases off as it goes so it never arrives anywhere it has not earned.
 *
 * `shown` chases `goal` rather than being set to it, so a milestone landing
 * early glides in instead of jumping.
 */
const bar = (() => {
  let shown = 0, goal = 0, ramp = null, raf = null;

  const step = (now) => {
    raf = null;
    if (ramp) {
      const u = Math.min(1, (now - ramp.t0) / ramp.ms);
      // Ease out: the closer it gets to the end of a budget, the slower it
      // moves, so overrunning the budget looks like effort rather than a stall.
      const at = ramp.from + (ramp.to - ramp.from) * (1 - (1 - u) ** 2);
      // A ramp is already smooth, so it drives the bar directly. Chasing it as
      // well only makes the bar trail its own target, and the further behind it
      // falls the bigger the catch-up when a real milestone lands on top.
      shown = Math.max(shown, at);
      goal = Math.max(goal, at);
      if (u >= 1) ramp = null;
    }
    // Milestones do arrive as steps, and those are worth gliding.
    const gap = goal - shown;
    if (gap > 0.02) shown = Math.min(goal, shown + Math.max(0.05, gap * 0.06));
    els.fill.style.width = `${shown.toFixed(2)}%`;
    if (ramp || goal - shown > 0.02) raf = requestAnimationFrame(step);
  };
  const pump = () => { if (raf === null) raf = requestAnimationFrame(step); };

  return {
    /** A milestone actually reached. Never goes backwards. */
    to(pct) { goal = Math.max(goal, pct); pump(); },
    /**
     * Spend `ms` getting to `pct`, for a stage whose length is known. Always
     * from where the bar actually is - starting one anywhere else is what a
     * jump is.
     */
    over(pct, ms) {
      if (pct > shown) { ramp = { from: shown, to: pct, t0: performance.now(), ms }; pump(); }
    },
    /** Done: get there now, whatever a ramp had planned. */
    done() { ramp = null; goal = 100; pump(); }
  };
})();

function progress(pct, message) {
  if (pct >= 100) bar.done();
  else bar.to(pct);
  if (message) els.msg.textContent = message;
}

/**
 * Wait for the view to stop fetching - properly stopped, not merely between
 * requests.
 *
 * `view.updating` flickers false in the gaps between tiles, so `whenOnce` on it
 * returns almost immediately and means nothing. This wants it quiet for a
 * stretch before believing it, and gives up after `maxMs` either way: a
 * Gaussian splat and four integrated meshes keep refining level of detail for
 * as long as you let them, so "finished" is a judgement, not an event.
 */
function settle(view, maxMs, quietMs, aborted = () => false) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let quietSince = view.updating ? null : t0;
    const handle = reactiveUtils.watch(
      () => view.updating,
      (busy) => { quietSince = busy ? null : performance.now(); }
    );
    const tick = setInterval(() => {
      const now = performance.now();
      const still = quietSince !== null && now - quietSince >= quietMs;
      const stop = aborted();
      if (!still && !stop && now - t0 < maxMs) return;
      clearInterval(tick);
      handle.remove();
      resolve(stop ? "abandoned" : still ? "settled" : "capped");
    }, 120);
  });
}

/**
 * Load the expensive views while the curtain is still up.
 *
 * The curtain is the opportunity: nothing behind it is on screen, so the camera
 * can be put anywhere and the layers switched on without a viewer seeing any of
 * it. Applying a slide is what does the work - it turns on exactly the layers
 * that slide shows and puts the camera exactly where it wants it, which is
 * precisely the state whose tiles we want fetched.
 *
 * `restore` puts the app back to how it opens, because applying a slide
 * rewrites layer visibility and the lighting along with it.
 */
async function warmUp(view, slides, restore,
                      { aborted = () => false, onStart, afterEach } = {}) {
  const cfg = CONFIG.preload;
  if (!cfg.enabled || !slides.length) return;

  // Not on someone's phone plan. A viewer who never opens view 5 should not
  // have paid for it, and on a slow link this would hold the curtain shut for
  // the whole budget and warm almost nothing.
  const net = navigator.connection;
  if (net && (net.saveData || /^(slow-2g|2g|3g)$/.test(net.effectiveType || ""))) {
    console.info("[venue] preload skipped:", net.saveData ? "data saver" : net.effectiveType);
    return;
  }

  const home = view.camera.clone();
  onStart?.(home);
  const deadline = performance.now() + cfg.budgetMs;
  // Same title match the rail's own views use, so both agree what a name means.
  const wanted = cfg.views
    .map((t) => slideNamed(slides, t))
    .filter(Boolean);
  let done = 0;

  for (const slide of wanted) {
    if (aborted()) break;
    const left = deadline - performance.now();
    if (left < 2000) {
      console.info("[venue] preload out of budget after", done, "of", wanted.length);
      break;
    }
    // The message only - never the bar. Once the bar reads 100% and the button
    // is open, winding it back to 78% looks like the app has come undone. And
    // while the button is still locked - which is what beforeUnlock is for -
    // it must not claim to be ready.
    els.msg.textContent = els.enter.disabled ? "Loading…" : "Ready — still caching…";
    if (els.enter.disabled) bar.over(99, Math.min(left, cfg.perViewMs));
    const t0 = performance.now();
    // animate: false - this is a jump, not a flight. Nobody is watching, and a
    // 2.6 s easing per view would be most of the budget spent on nothing.
    await slide.applyTo(view, { animate: false }).catch(() => {});
    const how = await settle(view, Math.min(left, cfg.perViewMs), cfg.settleMs, aborted);
    console.info(`[venue] warmed "${slide.title?.text ?? "view"}" in `
      + `${Math.round(performance.now() - t0)} ms (${how})`);
    done++;
    afterEach?.(done);
  }

  // If the viewer let themselves in mid-warm, reveal() has already put the
  // camera and the layers back - touching either now would fight it.
  if (aborted()) {
    console.info("[venue] preload cut short:", done, "of", wanted.length, "views warmed");
    return;
  }
  view.camera = home;
  restore();
}

/** Flatten the scene's layer tree, including layers nested in group layers. */
function flatten(collection, out = []) {
  collection.forEach((layer) => {
    out.push(layer);
    if (layer.layers) flatten(layer.layers, out);
  });
  return out;
}

/**
 * A device that should not be handed a two-gigabyte memory budget.
 *
 * `qualityProfile` is not only about how the scene looks: it is what the SDK
 * sizes its own cache against. On high it reports a budget of about 1930 MB and
 * fills it, which is right on a desktop and is a phone's entire tab allowance -
 * measured walking to the live-action view, high leaves roughly 980 MB resident
 * between the heap and the scene, and medium roughly 660.
 *
 * That is the reset people were seeing on a phone: nothing leaks, the app is
 * simply given a budget the device does not have and spends it.
 *
 * The test matches the CSS breakpoint on purpose - the layout and the memory
 * budget should agree about what a phone is - with a nod to any machine that
 * admits to being short of memory.
 */
function modestDevice() {
  const small = matchMedia("(max-width: 780px), (max-height: 500px)").matches;
  const lean = (navigator.deviceMemory ?? 8) <= 4;
  return small || lean;
}

/**
 * Say which build this is, once, in the console.
 *
 * There are two of these hosted: this source served as it stands, and a bundled
 * copy built by tools/bundle.py. They are generated from the same files so they
 * cannot disagree about behaviour, but they are deployed separately and either
 * can be left behind. The bundler stamps the commit it built from into a meta
 * tag; served from source there is no tag, and that is the answer too.
 */
function announceBuild() {
  const stamp = document.querySelector('meta[name="venue-build"]')?.content;
  console.info(`[venue] ${stamp ? `bundled build ${stamp}` : "served from source, SDK from the CDN"}`);
}

async function main() {
  announceBuild();
  progress(3, "Loading…");
  // The SDK is a thousand module requests deep and cannot report on itself, so
  // this stretch is the one that is invented - a slow drift that runs out of
  // road just as the scene usually lands.
  bar.over(30, 5000);

  // Fire the conditions request now, in parallel with the scene. It has nothing
  // to do with the scene loading, and queueing it behind the whole chain was
  // what left the sky in its authored state for several seconds.
  const conditions = fetchConditions().catch((err) => {
    console.warn("[venue] live weather unavailable:", err.message);
    return null;
  });

  const scene = new WebScene({ portalItem: { id: CONFIG.webSceneId } });
  const view = new SceneView({
    container: "viewDiv",
    map: scene,
    // ?q=low|medium|high overrides it, which is how the numbers above were
    // measured and how to check a device that still struggles.
    qualityProfile: new URLSearchParams(location.search).get("q")
      || (modestDevice() ? "medium" : "high"),
    ui: { components: [] },                 // all chrome is ours
    environment: {
      atmosphere: { quality: "high" },
      atmosphereEnabled: true,
      starsEnabled: true,               // only visible after dark, but free
      // Date and offset are set here rather than after the weather fetch, so the
      // sky is already at the right time of day on the first rendered frame.
      lighting: {
        type: "sun",
        date: new Date(),
        displayUTCOffset: utcOffsetHours(CONFIG.site.tz),
        directShadowsEnabled: true
      }
    }
  });

  try {
    await scene.load();
    bar.over(46, 2500);
    await view.when();
    manageNearPlane(view, CONFIG.clip);
    // A debugging handle, and only that - nothing in the app reads it, the same
    // way __play and __field are only there to be poked at from a console.
    window.__view = view;
    bar.over(56, 2000);
    // The web scene carries its own authored environment — a fixed
    // 2026-03-15 12:00 Denver, cloudy — and it is applied during load, which
    // overwrites what the SceneView constructor set. Re-assert ours here, the
    // moment the view is ready, so the sky is never the authored midday.
    ownSky(view);
  } catch (err) {
    // Esri errors carry name/details rather than a useful toString, so unpack
    // them — "[object Object]" in the console is no help to anyone.
    const detail = [err?.name, err?.message, err?.details && JSON.stringify(err.details)]
      .filter(Boolean).join(" · ");
    els.msg.textContent = "Could not load the scene.";
    console.error("[venue] scene load failed:", detail || err, err);
    return;
  }

  // The view exists from here, but existing is not the same as being worth
  // looking at: at this point the scene has streamed almost nothing, and
  // handing over now is what made Explore unlock into a half-built stadium.
  // Entry is unlocked further down, once there is something behind the curtain.
  // Everything below is enhancement and is guarded - a failure in any one
  // feature must not leave the curtain stuck.
  bar.over(62, 1500);
  const unlock = () => {
    if (!els.enter.disabled) return;
    els.enter.disabled = false;
    els.enter.classList.add("ready");
    els.enter.focus({ preventScroll: true });
  };
  // The one promise that cannot be broken. Whatever fails, hangs or never
  // settles below, the button opens by here.
  setTimeout(unlock, CONFIG.preload.hardCapMs);

  // Set before the UI appears, so it is also what the Home button returns to.
  if (CONFIG.home) {
    try { view.camera = CONFIG.home; }
    catch (err) { console.warn("[venue] bad CONFIG.home camera:", err.message); }
  }

  const layers = flatten(scene.layers);
  const captures = buildCaptures(layers);

  // Open on the drone splat alone: splat on, all three meshes off — which also
  // keeps the mesh group's switch fully off rather than in its mixed state.
  // The scene's first slide saves both Pix4D meshes as visible, and applyTo()
  // rewrites visibility as it runs, so this has to be re-asserted afterwards.
  const captureState = (which) => {
    captures.clear();                 // this is the app choosing, not the viewer
    captures.groups.forEach(({ group, rows }) => {
      // A layer may answer for itself; otherwise its group answers for it.
      rows.forEach((c) => { c.layer.visible = !!(c[which] ?? group[which]); });
    });
  };
  const openingState = () => captureState("open");
  const replayState = () => captureState("live");
  openingState();

  // The board is reconstructed badly in both the splat and the drone mesh, so
  // the panel follows either of them — not the splat alone. The two hand-held
  // Pix4D meshes do not cover the board, so they do not count.
  // Not awaited: it fetches the logo and probes ground elevation, and the panel
  // appearing a moment late is far better than holding up the whole view.
  addJumbotron(view, CONFIG.jumbotron).then((jumbo) => {
    // Layers that actually contain the video board. Kept as titles so adding a
    // statues or horses splat later does not accidentally trigger the panel.
    const carriers = ["Gaussian Splat", "3D Mesh"]
      .map((t) => layers.find((l) => l.title === t))
      .filter(Boolean);
    if (carriers.length) {
      const sync = () => { jumbo.layer.visible = carriers.some((l) => l.visible); };
      carriers.forEach((l) => reactiveUtils.watch(() => l.visible, sync));
      sync();
    }
    if (new URLSearchParams(location.search).has("tune")) attachTuner(jumbo);
  }).catch((err) => console.warn("[venue] jumbotron unavailable:", err.message));

  // Layers that should only appear after dark.
  const nightLayers = layers.filter((l) =>
    CONFIG.nightLayers.titles.some((t) => t.toLowerCase() === (l.title || "").toLowerCase()));
  if (nightLayers.length) {
    console.info("[venue] night-only layers:", nightLayers.map((l) => l.title).join(", "));
    sky.nightLayers = nightLayers;
    try { styleLights(nightLayers); }
    catch (err) { console.warn("[venue] light styling failed:", err.message); }
    tickClock(view);          // set them correctly now, not in 30 seconds
  } else {
    console.info("[venue] no night-only layer found; titles searched:",
      CONFIG.nightLayers.titles.join(" | "));
  }

  // Painted playing surfaces over the grey slab. Kept as a promise: the live
  // action panel needs the handle, and it is built before this resolves.
  const surfaces = CONFIG.field.enabled
    ? addSurfaces(view, CONFIG.field)
        .then((f) => {
          window.__field = f;
          // The seating model, for standing in a section and looking. Nothing
          // in the app reads this; it is how the ring numbers get checked
          // against the building they are supposed to describe.
          window.__seats = {
            list: sections,
            camera: (n) => sectionCamera(CONFIG, n, f.z),
            go: (n) => {
              const c = sectionCamera(CONFIG, n, f.z);
              return c ? view.goTo(c, { duration: 900 }).catch(() => {}) : null;
            }
          };
          return f;
        })
        .catch((err) => {
          console.warn("[venue] surfaces unavailable:", err.message);
          return null;
        })
    : Promise.resolve(null);

  // A custom render pass; if it fails for any reason the scene is unaffected.
  if (CONFIG.milkyWay.enabled) {
    addMilkyWay(view, CONFIG.milkyWay)
      .then((mw) => { window.__milkyway = mw; })
      .catch((err) => console.warn("[venue] milky way unavailable:", err.message));
  }

  const slides = scene.presentation?.slides?.toArray?.() ?? [];

  bindViews(slides);
  const tour = buildTour(view, slides, captures);

  // Never gate entry on `view.updating`. Gaussian splat and integrated mesh
  // layers stream continuously and level-of-detail keeps refining, so that flag
  // may never settle — the scene is meant to be flown while it sharpens.
  // Let the bar finish on its own if streaming happens to quieten down, but cap
  // the wait so the label never sits at "streaming" indefinitely.
  // Hand over as soon as the first view is real, and go on filling the cache
  // for as long as the curtain happens to stay up.
  //
  // The order matters. Warming first meant a viewer waited half a minute for
  // views they had not asked for yet, which is the wrong way round: nobody
  // reaches view 5 in the first few seconds. So view 1 is made good, the button
  // opens, and the expensive views are warmed behind a curtain that is now only
  // up because the viewer has not clicked yet. Whatever finishes, finishes.
  //
  // It cannot continue past the click. The SDK fetches what the camera can see
  // and nothing else - switching the meshes on at view 1 fetches none of their
  // detail, because at that height there is none to fetch - so warming means
  // moving the camera, and once the curtain is up that would be on screen.
  const deepLinked = ["view", "live", "goal"]
    .some((k) => new URLSearchParams(location.search).has(k));

  // Set while a warm-up has the camera parked somewhere else; reveal() reads it.
  let warmHome = null;
  const entered = () => els.intro.classList.contains("gone");

  let opened = false;
  const openTheDoor = () => {
    if (opened) return;
    opened = true;
    progress(100, "Ready");
    unlock();
  };

  (async () => {
    if (deepLinked) return;
    // Real, not guessed: this is exactly how long the wait is allowed to be.
    bar.over(90, CONFIG.preload.firstViewMs);
    await settle(view, CONFIG.preload.firstViewMs, CONFIG.preload.settleMs, entered);
    if (CONFIG.preload.beforeUnlock <= 0) openTheDoor();
    await warmUp(view, slides, () => { openingState(); tickClock(view); }, {
      // Nobody can be inside before the door opens, so until then the warm-up
      // runs to completion; after it, the first click ends it.
      aborted: () => opened && entered(),
      onStart: (home) => { warmHome = home; },
      afterEach: (done) => { if (done >= CONFIG.preload.beforeUnlock) openTheDoor(); }
    });
    warmHome = null;
    openTheDoor();                       // fewer views than asked for, or none
    if (!entered()) els.msg.textContent = "Ready";
  })().catch((err) => {
    console.warn("[venue] preload skipped:", err.message);
    openTheDoor();
  });

  const reveal = () => {
    // A warm-up may have the camera at another view with its layers switched
    // on. Put both back now, in the same frame the curtain starts lifting -
    // a frame later and the viewer sees somebody else's view slide away.
    if (warmHome) {
      view.camera = warmHome;
      warmHome = null;
      openingState();
      tickClock(view);
    }
    els.intro.classList.add("gone");
    [els.masthead, els.tour, els.captures, els.tools, els.weather]
      .forEach((el, i) => setTimeout(() => el.classList.remove("hidden"), 200 * i));
    if (tour.count && !CONFIG.home) {
      // applyTo() rewrites layer visibility from the slide as it starts, so
      // re-assert straight after, and again next frame in case it settles late.
      tour.go(0);
      openingState();
      tickClock(view);
      requestAnimationFrame(() => { openingState(); tickClock(view); });
    }
  };
  els.enter.addEventListener("click", reveal, { once: true });

  const tools = wireTools(view, surfaces,
    { captureDefaults: openingState, replayDefaults: replayState, slides, tour });

  // Some views open something when you reach them: the night view brings up the
  // time slider, the two stand views start their replay. One panel at a time,
  // exactly as the toolbar buttons enforce it - two docks would sit on top of
  // each other.
  let autoOpened = null;              // what a view opened, so a plain view can shut it
  const shut = { play: () => tools.liveAction.close(),
                 time: () => tools.timeOfDay.close(),
                 measure: () => tools.measure.close() };
  // Each arrival takes a ticket. Anything waiting on an older one has been
  // overtaken - the viewer moved on before the scene settled - and drops its
  // animation rather than starting it over the top of the next view.
  let arrivals = 0;
  const settledArrival = async () => {
    const mine = ++arrivals;
    await settle(view, CONFIG.arrival.maxMs, CONFIG.arrival.quietMs,
                 () => mine !== arrivals);
    return mine === arrivals;
  };

  tour.onArrive((n) => {
    const opens = viewAt(n)?.opens;
    if (!opens) {
      // Arriving somewhere ordinary puts away whatever a staged view opened.
      // Left alone the replay plays on and its pitch stays painted over the
      // field while you are looking at something else entirely. Only what this
      // handler opened is closed, so a panel opened by hand is left alone.
      if (autoOpened) { shut[autoOpened](); autoOpened = null; }
      return;
    }
    const play = CONFIG.play.plays.find((p) => p.key === opens);
    if (play) {
      tools.measure.close();
      tools.timeOfDay.close();
      autoOpened = "play";
      // No reframing: the flight has already landed on the broadcast camera,
      // so the replay opens on it rather than moving again on arrival.
      // The panel opens at once so the arrival is acknowledged; only the play
      // itself waits, sitting at its first frame until the scene is still.
      tools.liveAction.open({ key: play.key, frame: false, cam: "broadcast" })
        .then(async (p) => { if (p && await settledArrival()) p.start(); })
        .catch(() => {});
      return;
    }
    tools.liveAction.close();
    if (opens === "time") {
      tools.measure.close();
      autoOpened = "time";
      const v = viewAt(n);
      // This one does not wait. A replay is a burst of movement that a
      // half-loaded scene spoils, but the sun sweep is a slow ramp - it is not
      // spoiled by tiles still arriving, and holding it back only ate the front
      // of the very thing the view exists to show.
      tools.timeOfDay.open();
      if (v.sweepTo) tools.timeOfDay.sweep(v.sweepTo, v.sweepMs);
    }
    else if (opens === "measure") { tools.timeOfDay.close(); tools.measure.open(); autoOpened = "measure"; }
    else console.warn(`[venue] view ${n} opens "${opens}", which is nothing`);
  });
  wireKeys(view, tour, tools);

  // Deep link. ?live opens the replay straight away and plays it; ?live=7.1
  // opens it paused at that second, so a particular moment - the catch, the
  // score - can be linked to directly.
  const deep = new URLSearchParams(location.search);
  if (deep.has("view")) {
    // ?view=3 opens straight on that saved view, for linking to one of them.
    reveal();
    const n = parseInt(deep.get("view"), 10);
    if (isFinite(n)) setTimeout(() => tour.go(n - 1), 1200);
  }
  for (const [param, key] of [["live", "gridiron"], ["goal", "football"]]) {
    if (!deep.has(param)) continue;
    reveal();
    tools.liveAction.open({ key, frame: !deep.has("view") }).then((play) => {
      if (!play) return;
      const at = parseFloat(deep.get(param));
      if (isFinite(at) && at > 0) play.seek(at);
      else settledArrival().then((ours) => { if (ours) play.start(); });
    }).catch(() => {});
    break;
  }
  startWeather(view, conditions);
}

/* ------------------------------------------------------------- captures */
/** Mirror a layer's visibility onto a button, and toggle it on click. */
function bindToggle(btn, layer, chosen) {
  btn.type = "button";
  btn.classList.toggle("on", !!layer.visible);
  btn.setAttribute("aria-pressed", String(!!layer.visible));
  btn.addEventListener("click", () => {
    layer.visible = !layer.visible;
    chosen.set(layer, layer.visible);
  });
  // Slides also change visibility, so mirror the layer rather than assume.
  reactiveUtils.watch(() => layer.visible, (vis) => {
    btn.classList.toggle("on", !!vis);
    btn.setAttribute("aria-pressed", String(!!vis));
  });
}

/**
 * The capture list, and the viewer's choices in it.
 *
 * Slides carry their own layer visibility and rewrite it wholesale when they
 * are applied, which is right for a saved view and wrong for the person who
 * just switched a mesh on: their choice vanished the next time the camera
 * moved to a view, and with the slideshow running that looked like the panel
 * being broken. So anything toggled here is remembered, and put back after a
 * slide lands. Only deliberate clicks are recorded - visibility the app sets
 * for itself, such as staging a replay, resets the memory instead.
 */
function buildCaptures(layers) {
  const found = [];
  const chosen = new Map();

  CONFIG.groups.forEach((group) => {
    const rows = group.layers
      .map((c) => ({ ...c, layer: layers.find((l) => l.title === c.title) }))
      .filter((c) => c.layer);
    if (!rows.length) return;                 // group absent from the scene

    const head = document.createElement("button");
    head.className = "grp";
    head.type = "button";
    head.innerHTML =
      '<span class="grp__label"></span>' +
      '<span class="grp__n"></span>' +
      '<span class="grp__sw" aria-hidden="true"></span>';
    head.querySelector(".grp__label").textContent = group.label;
    const count = head.querySelector(".grp__n");

    const list = document.createElement("div");
    list.className = "captures__list";

    rows.forEach((c) => {
      const btn = document.createElement("button");
      btn.className = "cap";
      btn.innerHTML =
        '<span class="cap__dot"></span>' +
        '<span class="cap__name"></span>' +
        '<span class="cap__kind"></span>';
      btn.querySelector(".cap__name").textContent = c.label;
      btn.querySelector(".cap__kind").textContent = c.kind;
      bindToggle(btn, c.layer, chosen);
      list.appendChild(btn);
    });

    els.captureGroups.appendChild(head);
    els.captureGroups.appendChild(list);
    wireGroup(head, count, group, rows, chosen);
    found.push({ group, rows });
  });

  if (!found.length) els.captures.style.display = "none";
  return {
    groups: found,
    /** Put the viewer's own choices back over whatever a slide just applied. */
    restore() { chosen.forEach((vis, layer) => { layer.visible = vis; }); },
    /** Forget them - the app is deliberately setting the scene itself now. */
    clear() { chosen.clear(); }
  };
}

/** Master switch over one group: all-on, all-off, or mixed. */
function wireGroup(head, count, group, rows, chosen) {
  const sync = () => {
    const on = rows.filter((c) => c.layer.visible).length;
    const all = on === rows.length;
    head.classList.toggle("on", all);
    head.classList.toggle("mixed", on > 0 && !all);
    head.setAttribute("aria-pressed", String(all));
    head.title = all ? `Hide all ${group.label.toLowerCase()}` : `Show all ${group.label.toLowerCase()}`;
    // A bare count adds nothing when the switch already says all-on or all-off;
    // the fraction only earns its place while the group is split. A single-layer
    // group never needs one at all.
    count.textContent = (on > 0 && !all) ? `${on} / ${rows.length}` : "";
  };

  head.addEventListener("click", () => {
    // Anything short of all-on turns everything on; only all-on turns them off,
    // so a mixed selection resolves upward rather than wiping the group.
    const target = !rows.every((c) => c.layer.visible);
    rows.forEach((c) => { c.layer.visible = target; chosen.set(c.layer, target); });
  });

  rows.forEach((c) => reactiveUtils.watch(() => c.layer.visible, sync));
  sync();
}

/* ----------------------------------------------------- views (bookmarks) */
/**
 * Anything that drives the camera continuously registers here. Applying a saved
 * view releases it first, so a bookmark always wins: otherwise the replay's
 * broadcast camera rewrites view.camera every frame and the slide flight is
 * cancelled the instant it starts — the layers switch, but the camera never
 * arrives, which looks exactly like broken navigation.
 */
let cameraOwner = null;
function releaseCamera() { if (cameraOwner) cameraOwner(); }

/**
 * Make a slide's lighting agree with what is already on screen, so applying it
 * changes nothing about the sky.
 *
 * Every slide carries the scene's authored environment - a fixed midday - and
 * applyTo animates the view's lighting towards it during the flight, which
 * flashed the live sky back to noon on every navigation.
 *
 * The previous fix for that was to set `slide.environment = null`. It did stop
 * the flash, and it also silently broke navigation for months: Slide's
 * _applyViewpoint reads `this.environment.lighting` *before* it calls goTo, so a
 * null environment threw on that line and the camera never moved. Layer
 * visibility is applied by a separate task, which is why the slides still
 * appeared to half-work - the layers changed and the view stayed put.
 *
 * Matching instead of removing keeps applyTo on its normal path. The lighting
 * animation still runs; it just interpolates from the current value to the same
 * value. tickClock reasserts the truth immediately afterwards regardless.
 */
/**
 * Make a slide agree with the sky before it is applied.
 *
 * Applying a slide applies its authored environment along with its camera, so
 * anything the app has since decided about the light has to be written onto the
 * slide first or the flight undoes it.
 *
 * The offset matters as much as the date and is easier to miss. These slides
 * were authored at -7, the site is on -6 half the year, and the sun is placed
 * from both - so with the date held fixed at half past ten the sun still swung
 * an hour back as each slide landed and an hour forward as the app corrected
 * it. Same instant, different sky, twice per arrival. Two of the slides carry
 * no offset at all, which is worse: that hands the sun to whatever timezone the
 * viewer's machine happens to be in.
 */
function matchLighting(slide) {
  const now = slide?.environment?.lighting;
  const live = viewRef?.environment?.lighting;
  if (!now || !live) return;
  try {
    // The app's clock, which is not always the sun's. With the floodlights on
    // there is no sun and no date to read, and a slide left holding its own
    // would arrive carrying whatever afternoon the scene was authored at.
    const when = sky.lit ? sky.date : live.date;
    if (when) now.date = when;
    if (live.displayUTCOffset != null) now.displayUTCOffset = live.displayUTCOffset;
    if (live.type === now.type) now.directShadowsEnabled = live.directShadowsEnabled;
  } catch (err) {
    console.warn("[venue] could not match slide lighting:", err.message);
  }
}

/**
 * Which view number each entry in CONFIG.views turned out to be.
 *
 * Filled once, from the slides the web scene actually has. An entry that
 * matches nothing is a title that has been renamed or a slide that has been
 * deleted, and one that matches several is a title too vague to be an
 * identifier - both say so rather than silently attaching to the wrong view.
 */
const viewSpecs = new Map();

/**
 * The one slide whose title matches, or nothing.
 *
 * Exact first, then a prefix, so a spec can name "Night Sky" and reach "Night
 * Sky (Drone Capture)" without repeating the parenthetical. Anything that
 * matches more than one slide is too vague to be an identifier and is refused
 * rather than guessed at.
 */
/**
 * Every slide a title matches, in order.
 *
 * `title` may be one string or a list of them, and the first name that matches
 * anything wins. That is the same courtesy CONFIG.nightLayers extends to layer
 * names, and for the same reason: these titles are written by hand in a web
 * scene that somebody is still editing, and a rename should cost a line of
 * config rather than a silently dead feature.
 */
function slidesNamed(slides, title) {
  for (const want of [title].flat()) {
    const w = (want || "").trim().toLowerCase();
    if (!w) continue;
    const hits = slides.filter((sl) => {
      const t = (sl.title?.text || "").trim().toLowerCase();
      return t === w || t.startsWith(w);
    });
    if (hits.length) return hits;
    // Last resort: anywhere in the title. "Pix4DCatch" should still find
    // "Combine Handheld Captures using Pix4DCatch", which neither an exact
    // match nor a prefix will.
    const loose = slides.filter((sl) =>
      (sl.title?.text || "").trim().toLowerCase().includes(w));
    if (loose.length) return loose;
  }
  return [];
}

/** The single slide a title matches, or null if it is not exactly one. */
function slideNamed(slides, title) {
  const hits = slidesNamed(slides, title);
  if (hits.length === 1) return hits[0];
  console.warn(`[venue] "${[title].flat()[0]}" matches ${hits.length} slides`);
  return hits[0] ?? null;
}

/**
 * Which slide each entry in CONFIG.views is talking about.
 *
 * Two views may legitimately name the same title - a scene can have two slides
 * called the same thing, and this one does: both replays live on a slide called
 * "Gameday Experience". Where that happens they are taken in the order they are
 * written, first entry to first slide, so the pair still binds.
 *
 * That is a fallback and not a feature. It depends on the two slides staying in
 * the order the config lists them, which nothing enforces, so it says so loudly
 * enough to be worth fixing in the scene: two slides that behave differently
 * should be called different things.
 */
function bindViews(slides) {
  viewSpecs.clear();
  const used = new Set();
  const missed = [];
  for (const spec of CONFIG.views ?? []) {
    const hits = slidesNamed(slides, spec.title)
      .filter((sl) => !used.has(sl));
    const hit = hits[0];
    if (!hit) { missed.push([spec.title].flat()[0]); continue; }
    used.add(hit);
    viewSpecs.set(slides.indexOf(hit) + 1, spec);
  }
  console.info("[venue] views bound:",
    [...viewSpecs].map(([n, v]) => `${n} ${[v.title].flat()[0]}`).join(" | ")
      || "none");
  if (missed.length) {
    // Loud, because everything these drive - the replays, the opening pass, the
    // night clock - simply does not happen when a title stops matching, and
    // nothing else about the app looks broken. This cost an afternoon once.
    console.error("[venue] no slide matches: " + missed.join(", ")
      + " — check CONFIG.views against the scene's slide titles");
  }
}

/** The entry for a view, as the rail numbers them. */
const viewAt = (n) => viewSpecs.get(n);

/**
 * Stops a sun sweep, set by whoever owns one. Leaving a view has to stand it
 * down *before* the flight rather than on arrival at the next one: a sweep
 * writes the lighting date every few frames, so for the whole two and a half
 * seconds of the flight it was overwriting the clock the new view had just
 * set, and the scene relit on every frame of it. That is the lurch on the way
 * out of the night view.
 */
let sweepOwner = () => {};

/**
 * Stands down whatever is currently driving the clock - a running sweep, and
 * the slider's own idea of the time - so that something else may set it.
 *
 * It stands them down and stops there. It used to go live as well, which read
 * naturally until goLive itself began calling it: goLive stood the drivers
 * down, the driver went live, going live stood the drivers down, and the stack
 * ran out. Standing down is the part every caller needs; deciding what the time
 * should be afterwards is the caller's business.
 */
let liveOwner = () => {};

/**
 * Move the time slider to an instant without taking the clock over.
 *
 * The slider and the lighting have to agree. A view that sets the clock, or
 * hands it back, changes the lighting directly and the slider knew nothing
 * about it - so after the sun sweep on the night view the panel read the live
 * time while its handle still sat at midnight where the sweep left it.
 *
 * That is not only untidy. The slider's own watch fires asynchronously and
 * treats any value it did not set itself as a hand on the control: it latches
 * `sky.manual` and writes its instant onto the lighting. A stale handle is
 * therefore a loaded gun - one late callback and the scene goes back to
 * midnight and stays there, because manual mode stops the clock correcting it.
 */
let sliderOwner = () => {};

let viewRef = null;

function buildTour(view, slides, captures) {
  viewRef = view;
  const count = slides.length;
  let current = -1;
  let moving = false;
  // Set while the opening lap is in the air; calling it cuts the lap short.
  let cutTheLap = null;
  let lapFlown = false;
  // Every move takes a ticket. A lap is long enough that a viewer will reach
  // for an arrow during it, and the move they interrupt has to know it no
  // longer owns the view - otherwise it lands, re-arms the dwell and announces
  // its arrival on top of the move that replaced it.
  let goTicket = 0;
  const lapTarget = CONFIG.flyIn?.enabled
    ? slides.indexOf(slideNamed(slides, CONFIG.flyIn.to))
    : -1;

  if (!count) {
    els.tour.style.display = "none";
    return { count: 0, go() {}, stop() {}, onArrive() {} };
  }

  /**
   * Playing the views in order. A timer rather than a fixed interval, re-armed
   * only once each flight has actually landed: the flight takes as long as it
   * takes, and a metronome would start the next one on top of the last.
   */
  let playing = false;
  let dwell = null;
  let clockWas = null;
  let arrive = null;
  // Where a flight should finish, when something other than the slide decides.
  // Registered from outside because it needs the playing surface, which is
  // probed at load rather than written down.
  let landing = null;

  /**
   * Put the sun where the view was authored for. Runs before the flight rather
   * than after it, so the sky is already right when the camera arrives instead
   * of changing under it once it lands.
   */
  function applyClock(idx, slide) {
    // The sky a view insists on, if any. Nothing to save and restore: `imposed`
    // is only ever set from here, so clearing it is enough to hand the weather
    // back to whatever the viewer or the feed had decided.
    const wantSky = viewAt(idx + 1)?.sky ?? null;
    if (wantSky !== sky.imposed) {
      sky.imposed = wantSky;
      paintSky(view);
    }
    const spec = viewAt(idx + 1);
    const want = spec?.clock;
    // A view that insists on a time needs a sun to put it on.
    if (want) setLights(view, false);
    stopFollowingLight();
    if (want) {
      const [hh, mm] = want.split(":").map(Number);
      if (!clockWas) {
        clockWas = { date: nowDate(view), manual: sky.manual };
      }
      sky.manual = true;                        // stop the live clock overwriting it
      const to = localInstant(sky.tz, hh, mm);
      // A view that wants the light walked rather than cut hands the time to
      // the slide and lets the flight carry it.
      //
      // applyTo animates the view's lighting towards the slide's - that is the
      // behaviour matchLighting exists to cancel, because normally it drags the
      // live sky back to the scene's authored midday. Here it is exactly what
      // is wanted, so the slide is stamped with the destination instead of with
      // the present and the animation is left to run. Camera and sun then move
      // on the same clock, which is the only way they stay in step: writing the
      // date from here at the same time means two animations driving one value,
      // and the flight's wins in bursts.
      const own = slide?.environment?.lighting;
      if (spec.clockMs > 0 && own) {
        own.date = to;
        if (sky.offsetHours != null) own.displayUTCOffset = sky.offsetHours;
        followLight(spec.clockMs);
        return;
      }
      view.environment.lighting.date = to;
    } else if (clockWas) {
      sky.manual = clockWas.manual;
      view.environment.lighting.date = clockWas.date;
      clockWas = null;
    } else {
      return;
    }
    // Puts the stadium lights on or off with it: tickClock decides that from
    // the sun's actual altitude, not from a stored sunset time.
    tickClock(view);
    // Last, once the date has settled either way: the handle follows the sun.
    sliderOwner(view.environment.lighting.date);
  }

  /**
   * Re-decide the stadium lights while the sun is being walked down.
   *
   * tickClock is what turns them on and off, from the sun's actual altitude,
   * and it normally runs on a thirty-second timer - which is the right interval
   * for a clock that advances a second at a time and far too slow for one
   * crossing eight hours in four. Applying the night slide switches the lights
   * on at the start of the flight, from the layer list the slide was saved
   * with, and without this nothing would disagree until the flight had landed:
   * floodlights on over an afternoon sky for the whole of the transition.
   *
   * Runs a little past the end so the last frame of the walk is judged too.
   */
  const LIGHT_STEP_MS = 150;
  let lightRaf = null;
  function stopFollowingLight() {
    if (lightRaf) cancelAnimationFrame(lightRaf);
    lightRaf = null;
  }
  function followLight(ms) {
    stopFollowingLight();
    const t0 = performance.now();
    let last = 0;
    const step = (now) => {
      if (now - last >= LIGHT_STEP_MS) { last = now; tickClock(view); }
      if (now - t0 < ms + 400) { lightRaf = requestAnimationFrame(step); return; }
      lightRaf = null;
      tickClock(view);
    };
    lightRaf = requestAnimationFrame(step);
  }

  /** How long to hold a view before moving on, in the slideshow. */
  function dwellFor(idx) {
    const v = viewAt(idx + 1);
    if (!v) return CONFIG.slideDwellMs;
    return v.dwellMs || CONFIG.slideDwellMs;
  }

  /**
   * A view that names its own dwell has already been told how long to hold,
   * and for a reason that has nothing to do with loading: the two replays are
   * sized to the passage they play, and the night sky to how far the stars
   * should travel before the show moves on.
   *
   * Those three must not wait for quiet, and not merely because it would be
   * redundant. Each of them keeps the view busy for as long as it runs - a
   * replay moves twenty-two people every frame, a sun sweep rewrites the
   * lighting every few - so the wait would never latch, would run to the cap
   * every time, and would add it to a duration somebody had already chosen.
   * The night sky was cut to seven and a half seconds deliberately; this
   * would quietly have put it back to twenty.
   */
  const drivesItsOwnShow = (v) => typeof v?.dwellMs === "number";

  // Each hold takes a ticket, because waiting for the scene to go quiet is
  // asynchronous and a viewer can press an arrow in the middle of it. Without
  // one, the old view's timer would land on the new view and march the show
  // on early.
  let dwellTicket = 0;

  function schedule() {
    clearTimeout(dwell);
    if (!playing) return;
    const mine = ++dwellTicket;
    const hold = dwellFor(current);
    const stale = () => !playing || dwellTicket !== mine;
    const start = () => {
      if (stale()) return;
      dwell = setTimeout(() => { if (!stale()) go(current + 1); }, hold);
    };
    if (drivesItsOwnShow(viewAt(current + 1))) { start(); return; }
    settle(view, CONFIG.slideSettle.maxMs, CONFIG.slideSettle.quietMs, stale)
      .then(start);
  }

  function setPlaying(on) {
    if (playing === on) return;
    playing = on;
    clearTimeout(dwell);
    els.tourPlay.classList.toggle("on", on);
    els.tourPlay.setAttribute("aria-pressed", String(on));
    els.tourPlay.setAttribute("aria-label", on ? "Stop playing the views" : "Play the views in order");
    els.tourPlay.title = on ? "Stop" : "Play the views in order";
    els.tourIcon.setAttribute("d", on ? PAUSE_D : PLAY_D);
    // Straight to the next one, so pressing play does something visible rather
    // than sitting on the current view for a few seconds first.
    if (on) go(current + 1);
  }

  async function go(i) {
    if (!count) return;
    // An ordinary flight is 2.6 s and interrupting one buys nothing but a
    // stutter, so those still latch. A lap is fifteen, and a viewer who reaches
    // for an arrow in the middle of one means it.
    if (cutTheLap) { cutTheLap(); cutTheLap = null; }
    else if (moving) return;
    const idx = (i + count) % count;
    const from = current;
    const mine = ++goTicket;
    moving = true;
    current = idx;
    paint();
    releaseCamera();
    sweepOwner();
    matchLighting(slides[idx]);
    // After matchLighting, not before: a walking clock has to keep stamping the
    // slide as it goes, and matchLighting would otherwise overwrite the first
    // stamp with the time the walk started from.
    applyClock(idx, slides[idx]);
    // The lap, where this is the move it was written for: the slideshow is
    // running, we are arriving at the view it names, and we are coming from the
    // one before it rather than jumping in from somewhere else.
    const lap = CONFIG.flyIn?.enabled && playing && idx === lapTarget
      && from === (idx - 1 + count) % count
      && !(CONFIG.flyIn.once && lapFlown);

    const MAX_FLIGHT = 6000;

    // Where this view should finish, when something other than the slide
    // decides - the two replay views land on the broadcast camera, which is
    // computed rather than saved.
    //
    // The slide is lent that camera for the duration of the flight and given
    // its own back afterwards. Lending is what keeps applyTo on its normal
    // path: it animates the camera towards whatever the slide holds, so with
    // the broadcast camera in there it flies straight to it, and the saved one
    // is never used for anything. Landing first and correcting afterwards was
    // the alternative and it shows - the flight arrives at the saved seat and
    // then jumps.
    //
    // This is the same move matchLighting makes for the sky, and for the same
    // reason: a slide is a set of instructions, and the app is entitled to
    // amend them on the way past as long as it puts them back.
    const landedOn = await landing?.(idx + 1);
    const seat = slides[idx].viewpoint;
    const savedCam = landedOn && seat ? seat.camera : null;
    if (landedOn && seat) seat.camera = landedOn;

    try {
      if (lap) {
        lapFlown = true;
        let cut = false;
        cutTheLap = () => { cut = true; };
        // Broadcast, not the slide's own camera. The saved view is a seat in
        // the stand, and arriving there means the replay opens on a fan camera
        // and then has to move again the moment anybody asks for the wide shot.
        // Landing on broadcast puts the pass and the replay in the same place.
        await flyLap(
          view, CONFIG.flyIn,
          { lat: CONFIG.field.lat, lon: CONFIG.field.lon, z: CONFIG.field.z },
          (title) => view.map.allLayers.find((l) => l.title === title),
          () => cut || goTicket !== mine,
          landedOn ?? slides[idx].viewpoint?.camera
        );
        cutTheLap = null;
      }
      // Bounded, because `moving` is a latch: if applyTo ever fails to settle -
      // a flight interrupted at the wrong moment, a tab backgrounded mid-
      // animation - the rail would be dead for the rest of the session, arrows
      // and all. The cap sits just past maxDuration, so it only ever fires when
      // something is genuinely stuck.
      await Promise.race([
        slides[idx].applyTo(view, {
          // The lap has already landed on this slide's camera, so there is
          // nothing left to fly; applyTo is only here to set the layers and the
          // environment the slide asks for.
          animate: !lap,
          // A view that walks its clock flies for as long as the walk takes -
          // the lighting animation is part of the flight, so the flight sets
          // its pace.
          duration: viewAt(idx + 1)?.clockMs || CONFIG.flyDuration,
          easing: "in-out-cubic",
          maxDuration: MAX_FLIGHT
        }),
        new Promise((done) => setTimeout(done, MAX_FLIGHT + 500))
      ]);
    } catch { /* interrupted by user navigation — harmless */ }
    finally { if (savedCam && seat) seat.camera = savedCam; }
    // Superseded while in the air: the move that replaced this one owns the
    // view, the latch and the dwell, and this one must not touch any of them.
    if (goTicket !== mine) return;
    // Belt and braces: applyTo has finished with the borrowed camera, and this
    // makes certain the view is exactly on it rather than a frame short.
    if (landedOn) view.camera = landedOn;
    // applyTo installs the slide's whole environment, lighting included, so a
    // lit scene is quietly handed back to the sun by any navigation - and to
    // the sun of whatever day the scene was saved on. Put the lights back.
    if (sky.lit && view.environment.lighting.type !== "virtual") {
      view.environment.lighting = { type: "virtual", directShadowsEnabled: false };
      tickClock(view);
    }
    // Insurance only: slide environments are nulled at load, so applyTo should
    // not have touched the sky. The slide's visibleLayers list predates the
    // lights layer though, so applying one switches it off - tickClock puts it
    // back according to the current sun position.
    ownSky(view);
    tickClock(view);
    // applyTo rewrote layer visibility from the slide; anything the viewer had
    // chosen for themselves goes back on top of it.
    captures?.restore();
    moving = false;
    schedule();
    // Last, and only once the flight has landed: whatever this view opens is
    // going to take the panel and possibly the camera, and it should not be
    // doing that while the camera is still flying.
    arrive?.(idx + 1);
  }

  function paint() {
    els.idx.textContent = `${String(current + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`;
    const name = slides[current]?.title?.text ?? "";
    els.title.textContent = name;
    // The title clamps at two lines; the tooltip is what carries a name long
    // enough to be cut, so nothing is unreachable.
    els.title.title = name;
  }

  // Stepping by hand does not stop the tour, it just resets the dwell - go()
  // re-arms the timer when it lands. Touching the camera does stop it, because
  // at that point the viewer plainly wants to look at something themselves.
  els.prev.addEventListener("click", () => go(current - 1));
  els.next.addEventListener("click", () => go(current + 1));
  els.tourPlay.addEventListener("click", () => setPlaying(!playing));
  reactiveUtils.watch(() => view.interacting, (busy) => { if (busy) setPlaying(false); });

  return {
    count, go,
    next: () => go(current + 1),
    prev: () => go(current - 1),
    stop: () => setPlaying(false),
    /** Called with the view number, 1-based, once a flight has landed. */
    onArrive(fn) { arrive = fn; },
    /**
     * Asked, with the view number, where a flight to it should finish. Return
     * null to use the slide's own camera.
     */
    onLanding(fn) { landing = fn; }
  };
}

/* -------------------------------------------------------------- measure */
function buildMeasure(view) {
  // Only one widget exists at a time and it is destroyed on switch or close.
  // Merely detaching the container would leave the measurement's analysis on
  // the view, so the drawn geometry would linger after the panel closed.
  // Takes the kit rather than closing over imports, because the widgets are
  // not here yet when this file is parsed.
  const make = (M) => ({
    distance: () => new M.DirectLineMeasurement3D({ view }),
    area:     () => new M.AreaMeasurement3D({ view }),
    // Volume has no widget in the SDK — it is an Analysis driven by a polygon.
    // Handled separately in startVolume(), so this entry is a placeholder.
    volume:   () => null,
    // Ground gives the bare terrain; View samples whatever is actually drawn,
    // which is what picks up the splat and the meshes.
    // No visibleElements override: passing a partial object drops the members
    // left out of it, and omitting `sketchButton` leaves the widget with no way
    // to draw a profile at all. The defaults are what we want.
    profile:  () => new M.ElevationProfile({
      view,
      profiles: [
        new M.ElevationProfileLineView({ title: "Captures" }),
        new M.ElevationProfileLineGround({ title: "Terrain" })
      ]
    })
  });
  let active = null;     // mode key
  let M = null;          // the widgets, once fetched
  let modeToken = 0;     // so a second click cannot be overtaken by the first
  let widget = null;
  let sketch = null;
  let sketchLayer = null;
  const volumes = [];

  const seg = document.createElement("div");
  seg.className = "mseg";
  const buttons = {};
  for (const [key, label] of [["distance", "Distance"], ["area", "Area"],
                              ["volume", "Volume"], ["profile", "Profile"]]) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", () => setMode(key));
    seg.appendChild(b);
    buttons[key] = b;
  }
  els.mpanel.insertBefore(seg, els.mhost);

  const hint = document.createElement("p");
  hint.className = "dock__hint";
  // The widget prints its own step-by-step prompt; this only adds what is
  // specific to this scene.
  hint.textContent = "Points snap to the splat and mesh surfaces.";
  els.mpanel.insertBefore(hint, els.mhost);

  // The widget's unit lists are native selects, whose open menu the browser
  // paints on the light system scheme whatever the page declares. This swaps
  // each one for a drop-down we draw ourselves; see selectmenu.js.
  dressSelects(els.mhost);

  /**
   * A widget takes ownership of the element handed to it as `container`, and
   * destroy() removes that element from the DOM. Handing over the panel's own
   * host would therefore work exactly once — every later tool would render into
   * an orphaned node and show nothing. So each widget gets a fresh child.
   */
  function mountPoint() {
    const host = document.createElement("div");
    els.mhost.appendChild(host);
    return host;
  }

  function teardown() {
    widget?.destroy();          // also drops the analysis off the view
    widget = null;
    sketch?.cancel();
    sketch?.destroy();
    sketch = null;
    els.mhost.replaceChildren();   // clear anything destroy() left behind
  }

  async function setMode(key) {
    if (active === key && (widget || key === "volume")) return;
    teardown();
    active = key;
    Object.entries(buttons).forEach(([k, b]) => b.classList.toggle("on", k === key));
    // The profile widget prompts for itself, so the panel hint would just be
    // another line of text competing for height.
    hint.hidden = key === "profile";
    hint.textContent = key === "volume"
      ? "Draw a polygon over the area of interest."
      : "Points snap to the splat and mesh surfaces.";
    // Everything above is instant, so the panel responds to the click; only
    // the widget itself waits on the fetch, and only the first time.
    const token = ++modeToken;
    M = await loadMeasureKit();
    if (token !== modeToken) return;      // overtaken by a later click
    if (key === "volume") { startVolume(); return; }
    widget = make(M)[key]();
    widget.container = mountPoint();
    arm();
  }

  /**
   * Volume: sketch a polygon, then hand it to a VolumeMeasurementAnalysis.
   * The analysis renders its own cut/fill labels into the scene, so there is
   * no panel readout to populate.
   */
  function startVolume() {
    if (!sketchLayer) {
      sketchLayer = new M.GraphicsLayer({ listMode: "hide", elevationInfo: { mode: "absolute-height" } });
      view.map.add(sketchLayer);
    }
    sketch?.destroy();
    sketch = new M.SketchViewModel({
      view,
      layer: sketchLayer,
      polygonSymbol: {
        type: "polygon-3d",
        symbolLayers: [{ type: "fill", material: { color: [251, 79, 20, 0.22] },
                         outline: { color: [251, 79, 20, 0.9], size: "2px" } }]
      }
    });
    const out = mountPoint();
    out.className = "vol";

    sketch.on("create", (e) => {
      if (e.state !== "complete") return;
      const analysis = new M.VolumeMeasurementAnalysis({ geometry: e.graphic.geometry });
      view.analyses.add(analysis);
      volumes.push(analysis);
      sketchLayer.remove(e.graphic);       // the analysis draws its own footprint
      showVolume(analysis, out);
      sketch.create("polygon");            // re-arm for the next one
    });
    sketch.create("polygon");
  }

  /**
   * The analysis labels itself in the scene, but the panel should agree with
   * the other tools, so mirror its computed result here. `result` arrives
   * asynchronously once the GPU pass finishes, hence the watch.
   */
  async function showVolume(analysis, out) {
    const fmt = (label, m) => {
      if (!m || m.value == null) return "";
      const v = m.value >= 1000 ? Math.round(m.value).toLocaleString() : m.value.toFixed(1);
      const unit = (m.unit || "").replace("cubic-meters", "m³").replace("square-meters", "m²");
      return `<div class="vol__row"><span>${label}</span><b>${v} ${unit}</b></div>`;
    };
    try {
      const av = await view.whenAnalysisView(analysis);
      const paint = () => {
        const r = av.result;
        out.innerHTML = r
          ? fmt("Cut", r.cutVolume) + fmt("Fill", r.fillVolume) +
            fmt("Net", r.netVolume) + fmt("Area", r.area)
          : `<div class="vol__row"><span>Measuring…</span></div>`;
      };
      paint();
      reactiveUtils.watch(() => av.result, paint);
    } catch (err) {
      console.warn("[venue] volume result unavailable:", err.message);
    }
  }

  // The widget does not begin a measurement on mount — its "New measurement"
  // button calls viewModel.start(). Do the same on open and on mode switch so
  // the tool is live straight away instead of needing an extra click.
  /**
   * Put the active tool straight into drawing mode.
   *
   * All three widget tools expose `viewModel.start()`. ElevationProfile only
   * offers its sketch button once the view model leaves "disabled" (it waits on
   * an elevation source), so wait for that rather than calling start() into the
   * void — calling it too early is why Profile appeared dead.
   */
  function arm() {
    const w = widget;
    const vm = w?.viewModel;
    if (!vm?.start) return;
    const ready = "state" in vm
      ? reactiveUtils.whenOnce(() => vm.state && vm.state !== "disabled")
      : Promise.resolve();
    Promise.resolve(ready)
      .then(() => { if (widget === w) return vm.start(); })
      .catch(() => { /* superseded or unavailable — the widget's own button still works */ });
  }

  /**
   * Clear everything, not just the active tool. Volume analyses live on the
   * view and outlive a mode switch, so they have to be dropped whichever tool
   * happens to be selected — otherwise Clear looks broken from the other tabs.
   */
  function clear() {
    volumes.splice(0).forEach((a) => view.analyses.remove(a));
    sketchLayer?.removeAll();

    if (active === "volume") {
      sketch?.cancel();
      sketch?.create("polygon");        // re-arm so it stays usable
      return;
    }
    // ElevationProfile keeps its line until cleared, so drop it and immediately
    // re-arm — Clear should leave you ready to draw the next one, not idle.
    if (active === "profile") {
      widget?.viewModel?.clear?.();
      arm();
      return;
    }
    arm();
  }

  function open() {
    els.mpanel.hidden = false;
    els.measure.classList.add("active");
    setMode(active ?? "distance");
  }

  function close() {
    teardown();
    volumes.splice(0).forEach((a) => view.analyses.remove(a));
    sketchLayer?.removeAll();
    els.mpanel.hidden = true;
    els.measure.classList.remove("active");
  }

  els.mclear.addEventListener("click", clear);
  els.mclose.addEventListener("click", close);

  return { open, close, toggle: () => (els.mpanel.hidden ? open() : close()) };
}

/* ------------------------------------------------------- live  weather */
/**
 * The SDK's Weather widget only *sets* conditions — it has no live feed. So
 * fetch the real observation for the stadium and drive the scene from it:
 * conditions from the WMO code, and the sun from the actual clock.
 * Open-Meteo is keyless and CORS-open; if it fails the scene simply keeps
 * whatever the web scene was authored with.
 */
const WMO = [
  { max: 0,  kind: "sunny",  text: "Clear" },
  { max: 2,  kind: "sunny",  text: "Mostly clear" },
  { max: 3,  kind: "cloudy", text: "Overcast" },
  { max: 48, kind: "foggy",  text: "Fog" },
  { max: 57, kind: "rainy",  text: "Drizzle" },
  { max: 67, kind: "rainy",  text: "Rain" },
  { max: 77, kind: "snowy",  text: "Snow" },
  { max: 82, kind: "rainy",  text: "Showers" },
  { max: 86, kind: "snowy",  text: "Snow showers" },
  { max: 99, kind: "rainy",  text: "Thunderstorm" }
];
const ICON = { sunny: "☀", cloudy: "☁", rainy: "☂", snowy: "❄", foggy: "≋" };

/**
 * The weather a viewer can ask for, and what each one is made of.
 *
 * The live feed gives cloud cover and precipitation as measurements; a picked
 * sky has to invent both, so these are the numbers that make each one read as
 * itself. Snow lies: `snowCover` is what puts it on the ground rather than only
 * in the air, which is most of what makes a snowy stadium look snowy.
 */
const WEATHER_PICKS = [
  { kind: "sunny",  label: "Clear",  cloud: 0.04, precip: 0,    tempF: 74 },
  { kind: "cloudy", label: "Cloudy", cloud: 0.62, precip: 0,    tempF: 61 },
  { kind: "rainy",  label: "Rain",   cloud: 0.85, precip: 0.55, tempF: 54 },
  { kind: "snowy",  label: "Snow",   cloud: 0.80, precip: 0.55, tempF: 27 },
  { kind: "foggy",  label: "Fog",    cloud: 0.70, precip: 0,    tempF: 41 }
];

/** What a picked or imposed sky is called on the chip. */
const PICK_TEXT = Object.fromEntries(WEATHER_PICKS.map((p) => [p.kind, p.label]));
const NIGHT_ICON = { sunny: "☾", cloudy: "☁", rainy: "☂", snowy: "❄", foggy: "≋" };

function classify(code) {
  return WMO.find((w) => code <= w.max) ?? { kind: "cloudy", text: "Cloudy" };
}

// What the last fetch told us; the clock ticks against this between fetches.
const sky = {
  tz: CONFIG.site.tz, offsetHours: null, kind: "sunny",
  sunrise: null, sunset: null, nextRise: null, weather: null,
  nightLayers: null, wasNight: null,
  manual: false,           // true while the time slider is driving the sun
  // The floodlights: the scene lit artificially rather than by the sun.
  //
  // `lit` swaps the view onto virtual lighting, which is lit from the camera
  // and so has no sun in it at all - a dark sky over a bright field, which is
  // what a night game looks like. It cannot be done by moving the clock,
  // because a sun high enough to light the field also paints the sky blue.
  //
  // Virtual lighting carries no date, so while the lights are on the app keeps
  // its own in `date` and puts it back when they go off. That is the whole of
  // the bookkeeping, and it only works because the lights and the time tools
  // are mutually exclusive: opening the time panel, scrubbing the slider or
  // arriving at a view that names a clock all switch them off first. Nothing
  // writes the sun's date while there is no sun to write it to.
  lit: false,
  date: null,              // the app's own clock while the lights are on
  // Three ways the sky can be decided, in order of who wins. `imposed` is a
  // view insisting on something for as long as you are on it - the night view
  // wants its stars, and an overcast ceiling hides them whatever the weather
  // is really doing. `picked` is the viewer's own choice. Neither set, and the
  // scene shows what the venue is actually under.
  imposed: null,
  picked: null,
  live: null               // the last fetched conditions, to come back to
};

/**
 * Map real cloud cover onto the SDK's cloudCover.
 *
 * The two are not the same scale: 100% real cover is an overcast sky you can
 * still see the stadium under, whereas cloudCover 1.0 is an opaque ceiling.
 * So the real percentage is compressed into `cloudCap`, and only thunderstorms
 * or heavy precipitation are allowed to climb towards `stormCloudCap`.
 * WMO codes 95-99 are thunderstorms.
 */
function cloudCoverFor(kind, cloud, precip, code) {
  const { cloudCap, stormCloudCap, wetFloor } = CONFIG.weather;
  const stormy = code >= 95 || precip > 0.6;
  const base = cloud * cloudCap;
  if (stormy) return Math.min(stormCloudCap, Math.max(base, 0.72));
  // Rain and snow need enough cloud to be plausible, but not a lid.
  if (kind === "rainy" || kind === "snowy") return Math.max(base, wetFloor);
  return base;
}

function makeWeather(kind, cloud, precip, code = 0) {
  const cover = cloudCoverFor(kind, cloud, precip, code);
  switch (kind) {
    case "rainy": return new RainyWeather({ cloudCover: cover, precipitation: precip });
    case "snowy": return new SnowyWeather({ cloudCover: cover, precipitation: precip, snowCover: "enabled" });
    // Fog thickness should track how murky it actually is, not sit at a constant.
    case "foggy": return new FoggyWeather({ fogStrength: Math.min(0.6, 0.25 + cloud * 0.35) });
    case "cloudy": return new CloudyWeather({ cloudCover: cover });
    default: return new SunnyWeather({ cloudCover: cover });
  }
}

/** Network only — kept separate so it can be started before the scene loads. */
function fetchConditions() {
  const { lat, lon } = CONFIG.site;
  const url = "https://api.open-meteo.com/v1/forecast" +
    `?latitude=${lat}&longitude=${lon}` +
    "&current=temperature_2m,cloud_cover,precipitation,weather_code,is_day" +
    "&daily=sunrise,sunset&forecast_days=2&timezone=auto" +
    "&temperature_unit=fahrenheit";
  return fetch(url, { cache: "no-store" }).then((res) => {
    if (!res.ok) throw new Error(`weather ${res.status}`);
    return res.json();
  });
}

/** Apply a fetched payload to the scene and the chip. */
function applyConditions(view, data) {
  const now = data.current;
  const { kind, text } = classify(now.weather_code);
  const cloud = Math.min(1, Math.max(0, (now.cloud_cover ?? 0) / 100));
  // `precipitation` is millimetres in the last interval; the SDK wants 0–1.
  const precip = Math.min(1, Math.max(0.15, (now.precipitation ?? 0) / 2.5));

  sky.live = { kind, text, cloud, precip, code: now.weather_code,
               temp: Math.round(now.temperature_2m) };

  sky.tz = data.timezone ?? CONFIG.site.tz;
  sky.offsetHours = (data.utc_offset_seconds ?? 0) / 3600;
  sky.kind = kind;
  view.environment.lighting.displayUTCOffset = sky.offsetHours;

  // Open-Meteo returns sunrise/sunset as local wall-clock strings because of
  // `timezone=auto`, with no offset on them. Stamp the site's offset on so they
  // become absolute instants and compare correctly against `new Date()`.
  const day = data.daily ?? {};
  const stamp = (iso) => (iso ? new Date(`${iso}:00${offsetSuffix(sky.offsetHours)}`) : null);
  sky.sunrise = stamp(day.sunrise?.[0]);
  sky.sunset  = stamp(day.sunset?.[0]);
  sky.nextRise = stamp(day.sunrise?.[1]);

  els.weather.hidden = false;
  paintSky(view);
  tickClock(view);

  console.info(
    `[venue] ${text}, ${Math.round(now.temperature_2m)}°F, ` +
    `${now.cloud_cover}% cloud -> cover ${cloudCoverFor(kind, cloud, precip, now.weather_code).toFixed(2)} · ${sky.tz} (UTC${sky.offsetHours >= 0 ? "+" : ""}${sky.offsetHours}) · ` +
    `sunrise ${day.sunrise?.[0]?.slice(11)} sunset ${day.sunset?.[0]?.slice(11)}`
  );
}

/** "-06:00" / "+02:00" from a signed hour offset. */
function offsetSuffix(hours) {
  const sign = hours < 0 ? "-" : "+";
  const abs = Math.abs(hours);
  const hh = String(Math.floor(abs)).padStart(2, "0");
  const mm = String(Math.round((abs % 1) * 60)).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

const clockAt = (tz, opts) => new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts });

/**
 * Assert the app's own environment over whatever the web scene authored.
 * Called once the view is ready, and again if anything reapplies scene state.
 */
function ownSky(view) {
  const env = view.environment;
  env.atmosphereEnabled = true;
  env.starsEnabled = true;
  if (!sky.manual && !sky.lit) env.lighting.date = new Date();
  env.lighting.displayUTCOffset = sky.offsetHours ?? utcOffsetHours(CONFIG.site.tz);
  // Slides carry an authored weather too; put the live one back.
  if (sky.weather) env.weather = sky.weather;
}

/**
 * Advance the sun and the clock. A Date is an absolute instant, so this puts
 * the sun where it genuinely is over Denver regardless of the viewer's own
 * timezone; the readout is formatted into the stadium's zone to match.
 */
/**
 * Put the right sky on the scene and the right words on the chip.
 *
 * Called whenever any of the three inputs changes - a fetch landing, a viewer
 * picking, a view imposing - so there is one place that knows the order of
 * precedence and nowhere else that writes `environment.weather`.
 */
function paintSky(view) {
  const chosen = sky.imposed ?? sky.picked;
  const p = chosen && WEATHER_PICKS.find((w) => w.kind === chosen);
  if (p) {
    sky.kind = p.kind;
    sky.weather = makeWeather(p.kind, p.cloud, p.precip);
  } else if (sky.live) {
    sky.kind = sky.live.kind;
    sky.weather = makeWeather(sky.live.kind, sky.live.cloud, sky.live.precip, sky.live.code);
  } else {
    return;                                   // nothing known yet
  }
  view.environment.weather = sky.weather;

  // The temperature follows a sky the viewer picked, and does not follow one a
  // view imposed.
  //
  // Ninety-eight degrees beside falling snow is the one thing left on the chip
  // still claiming to be a measurement, and it contradicts everything around
  // it - the sky is already invented by then, so a reading that matches is no
  // more of a fiction than the snow is, and the unlit Live pip says as much.
  // A view imposing a sky is different: that is a framing decision about one
  // shot rather than a claim about the weather, and a clear night at the real
  // temperature does not contradict itself.
  const shown = sky.picked && !sky.imposed
    ? WEATHER_PICKS.find((w) => w.kind === sky.picked)?.tempF
    : sky.live?.temp;
  if (shown != null) els.wxTemp.textContent = `${shown}°F`;
  els.wxDesc.textContent = p ? PICK_TEXT[p.kind] : (sky.live?.text ?? "");
  for (const b of els.wxMenu.querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.kind === chosen);
  }
  paintLive();
}

/**
 * The Live control reads as pressed only when nothing has been overridden.
 *
 * The floodlights count as an override. They are not a time and not a weather,
 * but the chip's promise is "the conditions at the venue right now", and a
 * ground lit from the camera is not that. Left out of this the chip sat there
 * reading LIVE over an artificially lit scene - and, because the pill disables
 * itself when nothing is overridden, the one control that would have put the
 * sun back was the one control that could not be pressed.
 */
function paintLive() {
  const off = sky.manual || !!sky.picked || !!sky.imposed || sky.lit;
  els.wxLive.textContent = off ? "Live" : "Live";
  els.wxLive.classList.toggle("on", !off);
  els.weather.classList.toggle("manual", off);
  els.wxLive.disabled = !off;
  els.wxLive.title = off
    ? "Back to the conditions and the time at the venue right now"
    : "Showing the venue's live conditions";
}

/**
 * Turn the floodlights on or off.
 *
 * On, the view is lit from the camera instead of from the sun: the field is
 * bright and shadowless and the sky stays dark, which is what a floodlit ground
 * looks like. Measured on the field at half ten it is roughly four times as
 * bright as the sun leaves it, and the stars and the atmosphere are untouched.
 *
 * The date is carried across by hand because virtual lighting has none. Going
 * off, the sun is rebuilt from the app's clock rather than from the wall clock,
 * so a viewer who spent two minutes under the lights comes back to the time
 * they left rather than to now.
 */
function setLights(view, on) {
  if (!!on === sky.lit) return sky.lit;
  const env = view.environment;
  if (on) {
    sky.date = env.lighting.date ?? new Date();
    sky.lit = true;
    env.lighting = { type: "virtual", directShadowsEnabled: false };
  } else {
    sky.lit = false;
    env.lighting = {
      type: "sun",
      date: sky.date ?? new Date(),
      displayUTCOffset: sky.offsetHours ?? utcOffsetHours(CONFIG.site.tz),
      directShadowsEnabled: false
    };
  }
  tickClock(view);
  paintFixtures();
  els.lightsBtn?.classList.toggle("on", sky.lit);
  els.lightsBtn?.setAttribute("aria-pressed", String(sky.lit));
  return sky.lit;
}

/**
 * Show or hide the ground's own fixtures, leaving the street's alone.
 *
 * Only while the switch is on screen. Away from a replay there is nothing to
 * switch, and the stadium at night is supposed to be a lit stadium at night -
 * the rim of floodlights is the shot. So the filter is applied when the control
 * exists and is off, and lifted the rest of the time.
 */
function paintFixtures() {
  const spec = CONFIG.nightLayers;
  const off = spec.switched ?? [];
  if (!sky.nightLayers?.length || !off.length) return;
  const switchable = els.lightsBtn && !els.lightsBtn.hidden;
  const where = switchable && !sky.lit
    ? `${spec.categoryField} NOT IN (`
      + off.map((c) => `'${String(c).replace(/'/g, "''")}'`).join(", ") + ")"
    : null;
  for (const l of sky.nightLayers) {
    if ("definitionExpression" in l) l.definitionExpression = where;
  }
}

/**
 * What time the app thinks it is.
 *
 * Not always what the sun thinks. With the floodlights on the view carries
 * virtual lighting, which has no date at all, and reading one off it gives
 * null - so every caller that wanted "now" got the wall clock instead and
 * quietly lost whatever the viewer had set. One reader, so that cannot happen
 * in a place nobody thought to check.
 */
function nowDate(view) {
  return sky.lit
    ? (sky.date ?? new Date())
    : (view.environment.lighting.date ?? new Date());
}

/**
 * Hand the sky, the clock and the light back to the venue as it is right now.
 *
 * There were two of these - the weather chip's LIVE pill and the time panel's
 * own button - and they did different things. The panel's stood the floodlights
 * down and reset the slider; the chip's did neither, so pressing it left the
 * scene lit from the camera while claiming to show live conditions, and its
 * write to the sun's date landed on a lighting object that has none.
 *
 * They still differ, and should: the two buttons promise different things. The
 * chip offers "the conditions and the time at the venue right now" and hands
 * back the weather with the clock; the panel offers only to "resume tracking
 * the real clock", and a viewer who picked snow while scrubbing the afternoon
 * should keep their snow. That is what the weather option is for - the shared
 * part is the clock, the sun and the lights, which is where the bug was.
 */
function goLive(view, { weather = true } = {}) {
  setLights(view, false);
  if (weather) { sky.picked = null; sky.imposed = null; }
  sky.manual = false;
  liveOwner();                      // stand down a sweep, and the slider with it
  view.environment.lighting.date = new Date();
  if (weather) paintSky(view);
  tickClock(view);
}

/** Is it dark enough at the venue for the floodlights to be worth having? */
function afterDark(view) {
  return sunAltitudeDeg(nowDate(view), CONFIG.site.lat, CONFIG.site.lon)
    < CONFIG.nightLayers.litBelowDeg;
}

function tickClock(view) {
  // In manual mode the slider owns the date; only advance it when live. With
  // the floodlights on there is no sun to own it, so the app's own clock is
  // what advances and what everything below reads.
  if (!sky.manual && !sky.lit) view.environment.lighting.date = new Date();
  if (sky.lit && !sky.manual) sky.date = new Date();
  const now = nowDate(view);

  if (!sky.tz) return;
  const hhmm = clockAt(sky.tz, { hour: "numeric", minute: "2-digit" });
  els.wxTime.textContent = hhmm.format(now);
  els.treadout.textContent = clockAt(sky.tz,
    { weekday: "short", hour: "numeric", minute: "2-digit" }).format(now);
  paintLive();

  // Day or night from the sun's actual altitude, not the sunrise/sunset strings.
  // Those are only fetched for today, so they would be wrong the moment the time
  // slider is scrubbed to another date; altitude is correct for any instant.
  const sunAlt = sunAltitudeDeg(now, CONFIG.site.lat, CONFIG.site.lon);
  const night = sunAlt < CONFIG.nightLayers.sunBelowDeg;
  els.wxIcon.textContent = (night ? NIGHT_ICON : ICON)[sky.kind] ?? "☁";
  els.weather.classList.toggle("night", !!night);

  // Lights only after dark. Runs on every clock tick and on every time-slider
  // move, so it follows both live time and manual scrubbing. Asserted every
  // tick rather than only on transitions, because applying a slide rewrites
  // layer visibility and would otherwise leave them stuck until the next
  // sunrise or sunset. Setting an unchanged value is a no-op.
  // The floodlights follow the light, not just the switch: a replay left open
  // across sunrise should not still be lit from the camera at nine in the
  // morning, and the control should not still be offering it.
  if (els.lightsBtn && !els.lightsBtn.hidden) {
    const dark = sunAltitudeDeg(now, CONFIG.site.lat, CONFIG.site.lon)
      < CONFIG.nightLayers.litBelowDeg;
    if (!dark) {
      els.lightsBtn.hidden = true;
      if (sky.lit) setLights(view, false);
    }
  }
  if (sky.nightLayers) {
    sky.nightLayers.forEach((l) => { l.visible = night; });
    paintFixtures();
    if (night !== sky.wasNight) {
      sky.wasNight = night;
      console.info("[venue] lights", night ? "on" : "off",
        "(sun " + sunAlt.toFixed(1) + " deg)");
    }
  }

  // Whichever comes next: sunrise if it is still dark, otherwise today's
  // sunset, otherwise tomorrow's sunrise.
  let label = "", when = null;
  if (sky.sunrise && now < sky.sunrise) { label = "Sunrise"; when = sky.sunrise; }
  else if (sky.sunset && now < sky.sunset) { label = "Sunset"; when = sky.sunset; }
  else if (sky.nextRise) { label = "Sunrise"; when = sky.nextRise; }
  els.wxSun.textContent = when ? `${label} ${hhmm.format(when)}` : "";
}

/**
 * The weather picker, and the way back from it.
 *
 * Live is a control rather than a badge now: it was already telling you whether
 * the scene was showing real conditions, and the thing you want when it says no
 * is to get back, which is one press.
 */
function wireWeather(view) {
  const menu = (open) => {
    els.wxMenu.hidden = !open;
    els.wxPick.setAttribute("aria-expanded", String(!!open));
  };
  for (const p of WEATHER_PICKS) {
    const b = document.createElement("button");
    b.className = "toolmenu__item";
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.dataset.kind = p.kind;
    const ic = document.createElement("span");
    ic.className = "toolmenu__ico";
    ic.textContent = ICON[p.kind] ?? "☁";
    const tx = document.createElement("span");
    tx.textContent = p.label;
    b.append(ic, tx);
    b.addEventListener("click", () => {
      // Picking the one already showing puts it back to live, so the icon is
      // a toggle and not a one-way door.
      sky.picked = sky.picked === p.kind ? null : p.kind;
      menu(false);
      paintSky(view);
    });
    els.wxMenu.appendChild(b);
  }
  els.wxPick.addEventListener("click", () => menu(els.wxMenu.hidden));
  document.addEventListener("pointerdown", (e) => {
    if (els.wxMenu.hidden) return;
    if (els.wxMenu.contains(e.target) || els.wxPick.contains(e.target)) return;
    menu(false);
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.wxMenu.hidden) menu(false);
  });

  els.wxLive.addEventListener("click", () => { goLive(view); sliderOwner(new Date()); });
  paintLive();
}

function startWeather(view, inflight) {
  wireWeather(view);
  const apply = (data) => { if (data) applyConditions(view, data); };
  const run = () => fetchConditions().then(apply).catch((err) => {
    console.warn("[venue] live weather unavailable:", err.message);
    els.weather.hidden = true;      // no chip rather than a stale one
  });
  // Reuse the request started before the scene loaded rather than issuing a
  // second one; only fall back to a fresh fetch if that one failed.
  inflight.then((data) => (data ? apply(data) : run()));
  setInterval(run, CONFIG.weatherRefreshMs);
  // The sun advances on its own between fetches — no network cost, so shadows
  // creep in real time rather than jumping every ten minutes.
  setInterval(() => tickClock(view), CONFIG.clockTickMs);
}

/* ---------------------------------------------------------- time of day */
/**
 * A TimeSlider scrubbing one full day, driving the sun.
 *
 * Note this is *not* what TimeSlider normally does — bound to a view it filters
 * time-aware layers via `view.timeExtent` and never touches lighting. It is
 * deliberately constructed without a `view` so it has no side effects, and its
 * instant is copied onto `environment.lighting.date` instead.
 */
function buildTimeOfDay(view) {
  let slider = null;

  const dayBounds = () => {
    // Midnight-to-midnight of the day currently being shown, in site local time.
    const cur = nowDate(view);
    const p = Object.fromEntries(clockAt(sky.tz, {
      year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(cur).map((x) => [x.type, x.value]));
    const off = offsetSuffix(sky.offsetHours ?? utcOffsetHours(sky.tz));
    const start = new Date(`${p.year}-${p.month}-${p.day}T00:00:00${off}`);
    return [start, new Date(start.getTime() + 24 * 3600 * 1000)];
  };

  // Set when we move the slider ourselves, so the watch below can tell an
  // programmatic update apart from a user drag. reactiveUtils.watch fires
  // asynchronously, so a plain flag cleared on the next line would not work.
  let programmatic = null;
  let T = null;          // TimeSlider and TimeExtent, once fetched
  let making = null;     // the in-flight build, so open() cannot start two

  async function make() {
    T = await loadTimeKit();
    if (slider) return;
    const [start, end] = dayBounds();
    slider = new T.TimeSlider({
      container: els.thost,
      mode: "instant",
      fullTimeExtent: new T.TimeExtent({ start, end }),
      stops: { interval: { value: 10, unit: "minutes" } },
      // Five ticks, not a hundred and two. The default rules the whole track
      // and reads as texture rather than as a scale; a quarter of a day apart
      // is as fine as anybody needs to aim by, and the stops still snap to ten
      // minutes whatever the ticks say.
      tickConfigs: [{
        mode: "count",
        values: 5,
        labelsVisible: true,
        labelFormatFunction: (value) => clockAt(sky.tz, { hour: "numeric" })
          .format(new Date(value))
      }],
      timeExtent: new T.TimeExtent({
        start: view.environment.lighting.date, end: view.environment.lighting.date
      }),
      playRate: 90,
      loop: true,
      timeVisible: true
    });
    // Any movement of the slider takes ownership of the sun.
    reactiveUtils.watch(() => slider.timeExtent, (t) => {
      if (!t?.start) return;
      if (programmatic && Math.abs(t.start - programmatic) < 1000) { programmatic = null; return; }
      stopSweep();                            // a hand on the slider wins
      sky.manual = true;
      view.environment.lighting.date = t.start;
      tickClock(view);
    });
  }

  /**
   * Walk the sun forward to a wall-clock time and then put the panel away.
   *
   * The slider's own playback would do something like this, but it steps stop
   * to stop - ten minutes at a time - and the whole point here is to watch the
   * light go. So the lighting date is moved directly, ten times a second, and
   * the handle is dragged along behind it for show.
   */
  let sweepRaf = null;
  const STEP_MS = 100;

  function stopSweep() {
    if (sweepRaf) cancelAnimationFrame(sweepRaf);
    sweepRaf = null;
  }
  // So the rail can stand a sweep down as it leaves, before the next flight.
  sweepOwner = stopSweep;

  function sweep(toHHMM, ms) {
    open();
    stopSweep();
    const [hh, mm] = String(toHHMM).split(":").map(Number);
    const from = new Date(nowDate(view)).getTime();
    const to = localInstant(sky.tz, hh, mm, new Date(from)).getTime();
    if (!(to > from)) return;                 // already past it; nothing to do
    sky.manual = true;
    const t0 = performance.now();
    let wrote = 0;
    const frame = (now) => {
      const u = Math.min(1, (now - t0) / (ms || 24000));
      if (u === 1 || now - wrote >= STEP_MS) {
        wrote = now;
        const when = new Date(from + (to - from) * u);
        view.environment.lighting.date = when;
        if (slider) {
          programmatic = when;
          slider.timeExtent = new T.TimeExtent({ start: when, end: when });
        }
        tickClock(view);
      }
      if (u < 1) { sweepRaf = requestAnimationFrame(frame); return; }
      sweepRaf = null;
      close();
    };
    sweepRaf = requestAnimationFrame(frame);
  }

  function open() {
    // The clock cannot be driven while the floodlights are on, because there is
    // no sun to drive: virtual lighting carries no date. So the tool that owns
    // the clock takes the sun back before it opens.
    setLights(view, false);
    els.tpanel.hidden = false;
    els.timeOfDay.classList.add("active");
    if (!slider) (making ??= make());
  }
  function close() {
    stopSweep();
    els.tpanel.hidden = true;
    els.timeOfDay.classList.remove("active");
  }
  function live() {
    // The clock, not the weather: see goLive. goLive stands the sweep and the
    // slider down on the way past, so the handle below is being moved onto a
    // clock that has already been set rather than fighting one.
    goLive(view, { weather: false });
    const now = nowDate(view);
    if (slider) {
      const [start, end] = dayBounds();
      slider.fullTimeExtent = new T.TimeExtent({ start, end });
      programmatic = now;
      slider.timeExtent = new T.TimeExtent({ start: now, end: now });
    }
    tickClock(view);
  }
  // Only the standing-down. Whoever called is about to set the clock itself.
  liveOwner = () => {
    stopSweep();
    if (!slider) return;
    slider.viewModel?.stop?.();
  };
  // And the rail has to be able to move the handle without this reading it as
  // somebody grabbing the slider - hence `programmatic`, the same way live()
  // and the sweep do it.
  sliderOwner = (when) => {
    if (!slider || !when) return;
    programmatic = when;
    slider.timeExtent = new T.TimeExtent({ start: when, end: when });
  };

  // Direct shadows are part of the sun model, so this reads as a lighting
  // control and belongs beside the time scrubber rather than in a settings menu.
  const shadows = () => {
    const on = !view.environment.lighting.directShadowsEnabled;
    view.environment.lighting.directShadowsEnabled = on;
    els.shadowToggle.classList.toggle("on", on);
    els.shadowToggle.setAttribute("aria-pressed", String(on));
  };
  els.shadowToggle.addEventListener("click", shadows);
  els.shadowToggle.classList.toggle("on", !!view.environment.lighting.directShadowsEnabled);

  els.tlive.addEventListener("click", live);
  els.tclose.addEventListener("click", close);
  return { open, close, sweep, toggle: () => (els.tpanel.hidden ? open() : close()) };
}

/**
 * Print the current camera as a paste-ready CONFIG.home block, and put it on the
 * clipboard when the browser allows it. The only way to capture a viewpoint you
 * framed by hand without round-tripping through the web scene.
 */
function copyCamera(view) {
  const c = view.camera;
  const p = c.position;
  const block = {
    position: {
      longitude: +p.longitude.toFixed(8),
      latitude: +p.latitude.toFixed(8),
      z: +p.z.toFixed(2)
    },
    heading: +c.heading.toFixed(2),
    tilt: +c.tilt.toFixed(2)
  };
  const text = "home: " + JSON.stringify(block, null, 2).replace(/\n/g, "\n  ") + ",";
  console.log("[venue] paste into CONFIG:\n" + text);
  navigator.clipboard?.writeText(text).then(
    () => console.log("[venue] copied to clipboard"),
    () => {}
  );
  return block;
}

/* ---------------------------------------------------------------- tools */
/* --------------------------------------------------------------- live action
 * The transport for the replayed touchdown. The play itself is built lazily on
 * first open: it is twenty-three meshes, and there is no reason to pay for them
 * unless someone asks to see it.
 */
/**
 * A league play description names the passer and the receiver. The replay is
 * about the movement, not the individuals, and the
 * figures carry no names or numbers, so the caption should not either. Strips
 * the leading game clock and any initial-and-surname, including the "to" that
 * introduces the receiver, then recapitalises what is left.
 *
 * play.json keeps the original text; this only changes what is shown.
 */
function describe(text) {
  return String(text)
    .replace(/^\(\d+:\d+\)\s*/, "")
    // "deep right" is the offence's right, which is only meaningful if you know
    // which way they are going. From the touchline camera the play runs right to
    // left and the receiver drifts away from you, so the word contradicts what
    // is on screen without being wrong. Keep the depth, drop the side.
    .replace(/\b(deep|short)\s+(left|right|middle)\b/gi, "$1")
    .replace(/\s+to\s+[A-Z]\.[A-Za-z'’-]+/g, "")
    .replace(/[A-Z]\.[A-Za-z'’-]+\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/^(\(?[a-z])/, (c) => c.toUpperCase())
    .replace(/\)\s*([a-z])/, (m0, c) => `) ${c.toUpperCase()}`);
}

const PLAY_D = "M8 5.5v13l11-6.5z";
const PAUSE_D = "M8 5.5h3.2v13H8zM12.8 5.5H16v13h-3.2z";
/**
 * What each event in a play file is called on the timeline.
 *
 * Keyed by the event rather than by the sport, because plays of one sport do
 * not share a shape: a pass has a throw and a catch, a run has a handoff, a
 * field goal has neither and ends with a kick that is either good or not. The
 * marks a play shows are simply whichever of these it happens to carry, in the
 * order its own data puts them - so a new play needs an entry here only if it
 * brings an event none of the others have.
 */
const PHASE_LABELS = {
  // gridiron
  ball_snap: "Snap",
  pass_forward: "Throw",
  pass_outcome_caught: "Catch",
  handoff: "Handoff",
  field_goal_attempt: "Kick",
  field_goal: "Good",
  touchdown: "Touchdown",
  // football
  kick: "Goal kick",
  freekick: "Free kick",
  win: "Tackle",
  recover: "Won back",
  intercept: "Intercept",
  aerial: "Header",
  switch: "Switch",
  cross: "Cross",
  goal: "Goal",
  start: "Kick-off",
  // both
  celebration: "Celebration"
};

/**
 * What the caption says, and how far it commits. The gridiron play is measured
 * says which source it came from. A reconstruction, if one is ever added
 * again, says so instead of claiming measurement.
 * Neither names a player.
 */
function captionFor(m) {
  // The provenance sentence comes from the data, so a play can never describe
  // itself as measured when it is not, or credit the wrong source.
  const how = m.measured
    ? `Positions are measured, not invented: tracking for all 22 players and the `
      + `ball, from ${m.sourceShort}.`
    : "Reconstructed from footage — the order of events and the rhythm are "
      + "faithful, the positions are authored, not tracked.";
  // A play may be measured and still have had something done to it. The kick
  // is the case in point: every player is real and so is the strike, but no
  // long field goal exists in the tracking, so the distance and the flight are
  // computed. Saying "measured" and stopping there would be a half-truth, and
  // the app claims provenance too loudly elsewhere to be careless here.
  const mod = m.modelled;
  const made = mod
    ? `The ${mod.distanceYd} yard distance and the ball's flight are modelled: `
      + `a measured ${mod.measuredDistanceYd} yard attempt moved ${mod.movedYd} yd `
      + `downfield, struck at ${mod.launchMs} m/s and ${mod.launchDeg}°, `
      + `peaking at ${mod.apexM} m.`
    : "";
  // Nodes rather than a string of markup. Every value here comes out of a JSON
  // file, and a fork of this app will point it at its own; there is no reason
  // for a data file to be able to write HTML into the page.
  const out = document.createDocumentFragment();
  const lead = document.createElement("b");
  // `blurb` is a sentence written for a viewer. Without one the league's own
  // play description is tidied up instead, which is terse and full of trade
  // shorthand - fine for a developer, less so for someone watching.
  lead.textContent = m.blurb || describe(m.description);
  // The occasion is optional: a play that does not name one just moves on.
  const rest = [m.credit ? `${m.credit}.` : "", how, made, "Players and kit are generic."]
    .filter(Boolean).join(" ");
  out.append(lead, ` ${rest}`);
  return out;
}

function buildLiveAction(view, surfacesReady, stage, slides = []) {
  const loaded = new Map();          // key -> play
  let api = null, pending = null, active = null;
  // The viewer's answer about the diagram, kept across plays so it does not
  // have to be given again every time one is opened. Off to begin with: the
  // replay is the thing, and a diagram drawn over it on arrival is an answer to
  // a question nobody has asked yet - it reads as chrome the first time and as
  // clutter every time after. Asked for once, it stays on for the session.
  let chalkOn = false;
  let cam = null, scrubbing = false, restore = null, shown = false;
  let canDraw = false;           // this play has something worth drawing
  // Set once wireTools has built the chooser; Fan Perspective needs it and the
  // two are built in the other order.
  let seatsRef = null;
  let aim = null;                      // smoothed look-at point, local metres

  /** This play's events, in the order they happen, with their labels. */
  function phases() {
    const ev = api?.data.events;
    if (!ev) return [];
    return Object.entries(ev)
      .filter(([key]) => PHASE_LABELS[key])
      .sort((a, b) => a[1] - b[1])
      .map(([key]) => [key, PHASE_LABELS[key]]);
  }

  function drawMarks() {
    els.pmarks.textContent = "";
    const marks = [];
    for (const [key, label] of phases()) {
      const f = api.data.events[key];
      if (f == null) continue;
      const at = f / api.data.meta.hz;
      const i = document.createElement("i");
      i.style.left = `${(at / api.duration * 100).toFixed(2)}%`;
      i.dataset.at = at.toFixed(2);
      const b = document.createElement("b");
      b.textContent = label;
      i.appendChild(b);
      els.pmarks.appendChild(i);
      marks.push(i);
    }
    spaceMarks();
  }

  /**
   * Keep every label, and keep every label over its own tick.
   *
   * Two events close together - the goal kick and the tackle are 2.7 s apart at
   * the head of a 37 s clip - cannot both have a label centred on them, and
   * sliding them sideways to fit is what makes the bar read as a row of words
   * rather than as marks on a timeline. So a label that will not fit beside its
   * neighbour goes *above* it instead, where it can stay centred on the tick it
   * belongs to. Sliding is the fallback, for when even two rows are not enough.
   *
   * The ticks themselves are the record of when something happened and never
   * move, whatever the writing above them does.
   */
  function spaceMarks() {
    const track = els.pmarks.clientWidth;
    if (!track) return;                        // panel not laid out yet
    const PAD = 7;                             // px of air between two labels
    const EDGE = 1;                            // and between a label and the ends
    const items = [...els.pmarks.children].map((i) => {
      const b = i.firstElementChild;
      b.style.setProperty("--shift", "0px");
      b.style.setProperty("--row", "0");
      return { b, tick: i.offsetLeft, w: b.offsetWidth, row: 0 };
    });
    if (!items.length) return;

    // Which row each label goes on, judged on where it would like to sit.
    const rowEnd = [-Infinity, -Infinity];
    for (const m of items) {
      const left = m.tick - m.w / 2;
      m.row = left >= rowEnd[0] + PAD ? 0 : (left >= rowEnd[1] + PAD ? 1 : 0);
      rowEnd[m.row] = Math.max(rowEnd[m.row], left + m.w);
      m.b.style.setProperty("--row", String(m.row));
    }
    els.pmarks.classList.toggle("two", items.some((m) => m.row === 1));

    // Then each row is spaced on its own, because labels on different rows
    // cannot collide. Within a row, a crowded label hangs off the edge nearest
    // its tick rather than drifting away from it.
    for (const row of [0, 1]) {
      const line = items.filter((m) => m.row === row);
      if (!line.length) continue;
      const want = line.map((m) => m.tick - m.w / 2);
      for (let n = 1; n < line.length; n++) {
        if (want[n] < want[n - 1] + line[n - 1].w + PAD) {
          want[n - 1] = line[n - 1].tick - line[n - 1].w;   // hang off its right
          want[n] = line[n].tick;                            // and this off its left
        }
      }
      const rightward = () => {
        want[0] = Math.max(want[0], EDGE);
        for (let n = 1; n < line.length; n++) {
          want[n] = Math.max(want[n], want[n - 1] + line[n - 1].w + PAD);
        }
      };
      rightward();
      const last = line.length - 1;
      want[last] = Math.min(want[last], track - EDGE - line[last].w);
      for (let n = last - 1; n >= 0; n--) {
        want[n] = Math.min(want[n], want[n + 1] - PAD - line[n].w);
      }
      rightward();
      // The label is centred on the tick in CSS, so the shift is measured from
      // there rather than from its left edge.
      line.forEach((m, n) => {
        m.b.style.setProperty("--shift", `${(want[n] + m.w / 2 - m.tick).toFixed(1)}px`);
      });
    }
  }

  window.addEventListener("resize", () => { if (shown) spaceMarks(); });

  /** The most recent event at or before this moment. */
  function phaseAt(t) {
    let out = "";
    for (const [key, label] of phases()) {
      const f = api.data.events[key];
      if (f != null && t >= f / api.data.meta.hz - 0.001) out = label;
    }
    return out;
  }

  /**
   * Player Highlight: out past the touchline, up in the stand, panning to hold
   * the ball. The aim point is eased rather than the camera position, so the
   * pan lags the ball very slightly the way a real operator does. This is the
   * only one of the three that keeps hold of the camera, frame by frame.
   */
  function follow(dt) {
    if (!api || !shown) return;
    const b = api.ballEN();
    const u = api.acrossAxis();
    const c = CONFIG.play.camera;
    if (!aim) aim = [b[0], b[1], b[2]];
    // Framerate-independent easing. A fixed fraction per step means the pan
    // speed depends on how often the step happens, which is exactly how this
    // went wrong: it was driven off the panel's 10 Hz readout tick, so the
    // camera moved in ten visible jumps a second. Converting to a time constant
    // means the same pan whether the display runs at 60 Hz or 144.
    const k = 1 - Math.exp(-dt / c.lag);
    aim = [aim[0] + (b[0] - aim[0]) * k,
           aim[1] + (b[1] - aim[1]) * k,
           aim[2] + (b[2] - aim[2]) * k];

    const d = api.halfWidth + c.out;
    const ce = aim[0] - u[0] * d, cn = aim[1] - u[1] * d;
    const cz = api.surfaceZ + c.up;

    const dE = aim[0] - ce, dN = aim[1] - cn;
    const dz = cz - (api.surfaceZ + aim[2]);
    const ll = api.toLonLat(ce, cn);
    let lon = ll[0], lat = ll[1], z = cz;
    let heading = (Math.atan2(dE, dN) * 180) / Math.PI;
    let tilt = 90 - (Math.atan2(dz, Math.hypot(dE, dN)) * 180) / Math.PI;

    // Swing in rather than cut. Choosing this camera used to drop it straight
    // onto the touchline - a ninety metre jump in a single frame, which reads
    // as a jolt however smooth everything after it is. Fan and Broadcast both
    // arrive on an eased goTo, so this one should not be the odd one out.
    if (blend < 1 && from) {
      blend = Math.min(1, blend + dt / c.settle);
      const u = blend * blend * (3 - 2 * blend);          // smoothstep
      const turn = (a, b) => a + ((((b - a + 540) % 360) - 180) * u);
      lon = from.lon + (lon - from.lon) * u;
      lat = from.lat + (lat - from.lat) * u;
      z = from.z + (z - from.z) * u;
      heading = turn(from.heading, heading);
      tilt = from.tilt + (tilt - from.tilt) * u;
    }

    view.camera = new Camera({
      position: new Point({ longitude: lon, latitude: lat, z,
                            spatialReference: { wkid: 4326 } }),
      heading, tilt
    });
  }

  /**
   * Lighting a replay after dark used to mean moving the clock.
   *
   * The stadium lights are emissive symbols - they read as lit but cast no
   * light - so a replay at ten at night happened in the dark. The fix was to
   * put the clock to two in the afternoon for the duration and set it back
   * afterwards, which lit the field and also painted the sky blue: the one
   * thing it could not do was look like a floodlit ground.
   *
   * It had a second cost that was easy to miss, because it only appeared in the
   * evening. Restoring the clock on close ran after the next view had already
   * set its own, so leaving a replay for the night view put the clock back to
   * whatever it had been rather than to half ten, and the walk down to dusk
   * arrived at the wrong time of day.
   *
   * Both are gone. setLights() lights the scene from the camera instead of from
   * the sun, which is brighter than the noon trick managed and leaves the sky
   * where it was, and it never touches the clock at all.
   */

  /**
   * Broadcast: the whole field on screen from the touchline, which is where a
   * television camera would be cut from. One move, and then the camera is the
   * viewer's again - nothing holds it unless Player Highlight is chosen.
   */
  function frameField() {
    const to = broadcastCamera(CONFIG, api.surfaceKey, api.surfaceZ);
    if (!to) return Promise.resolve();
    return view.goTo(to, { duration: 1600, easing: "in-out-cubic" })
      .catch(() => {});
  }

  /**
   * Player Highlight runs on its own frame loop rather than on the transport's
   * readout tick. The ball's own position still only moves when the players are
   * posed - 15 to 33 Hz, whatever the machine can afford - but the aim is eased
   * towards it every frame, so a stepped target still produces a smooth pan.
   */
  /**
   * Player Highlight, and what happens when the viewer disagrees with it.
   *
   * The loop writes `view.camera` every frame, so a drag used to be undone
   * before it finished - the viewer pushed the camera and it sprang back, over
   * and over, which reads as the app fighting them. Now taking hold of the view
   * hands the camera over: the loop stops, the mode stays selected, and a
   * button offers the follow back. Nothing is forced.
   *
   * `released` is that state. It is not the same as switching the camera off -
   * the mode is still Player Highlight, and the timeline and the ball carry on
   * exactly as before; only who is holding the camera has changed.
   */
  let camRaf = null, camLast = 0, blend = 1, from = null, released = false;

  function showRecenter(on) {
    els.precenter.hidden = !on;
  }

  /** Hand the camera to the viewer, keeping the mode selected. */
  function release() {
    if (!camRaf || released) return;
    released = true;
    stopFollow();
    showRecenter(true);
  }

  // `interacting` is the viewer's own input and nothing else - a camera written
  // from script does not set it - so the follow loop cannot trip this itself.
  reactiveUtils.watch(() => view.interacting, (busy) => { if (busy) release(); });

  /** Take it back, easing in from wherever they left it. */
  function recenter() {
    if (cam !== "highlight") return;
    released = false;
    showRecenter(false);
    startFollow();
  }

  function followLoop(ts) {
    camRaf = requestAnimationFrame(followLoop);
    // Clamped: coming back to a backgrounded tab hands over one enormous frame,
    // and without a ceiling the camera would snap straight onto the ball.
    const dt = camLast ? Math.min(0.1, (ts - camLast) / 1000) : 1 / 60;
    camLast = ts;
    follow(dt);
  }
  function startFollow() {
    if (camRaf) return;
    released = false;
    showRecenter(false);
    camLast = 0;
    // Where the swing in starts from.
    const p = view.camera.position;
    from = { lon: p.longitude, lat: p.latitude, z: p.z,
             heading: view.camera.heading, tilt: view.camera.tilt };
    blend = 0;
    camRaf = requestAnimationFrame(followLoop);
  }
  function stopFollow() {
    if (camRaf) cancelAnimationFrame(camRaf);
    camRaf = null;
  }

  /** Out of the mode altogether: no loop, no button, no held state. */
  function dropFollow() {
    stopFollow();
    released = false;
    showRecenter(false);
  }

  /**
   * From the stand. Only the slide's camera is taken, never the slide itself:
   * applying one rewrites layer visibility, which would undo the staging the
   * replay just did and put the hand-held meshes back on top of the field.
   */
  /**
   * Fan Perspective is a question, not a camera.
   *
   * It used to fly to whichever saved view opened the play, which was a seat
   * somebody had picked once for everybody. Now it asks which seat - the sheet
   * comes up, the camera previews each section as it is stepped through, and
   * taking one closes the sheet and starts the play from there.
   *
   * The play is stopped while the choosing happens. Watching a replay run from
   * behind a dialog, from a camera that is being moved about underneath it, is
   * no way to see either.
   */
  function fanView() {
    api?.pause();
    seatsRef?.open(() => { if (cam === "fan") api?.start(); });
    return Promise.resolve();
  }

  const MOVE = { fan: fanView, broadcast: frameField, highlight: null };

  /**
   * Pick a camera. Two of the three are a single move and then the view is
   * yours again; Player Highlight is the one that keeps hold, so pressing it a
   * second time lets go and hands the camera back to wherever it was. The other
   * two have nothing to hand back to - they are a destination, not a loan.
   */
  function setCam(mode) {
    // Nothing to point at yet. The buttons are live while a replay loads, and
    // every one of these moves is worked out from the field the play is on.
    if (!api) return;
    const letGo = mode === "highlight" && cam === "highlight";
    cam = letGo ? null : mode;
    paintCams();
    if (letGo) { dropFollow(); return handBack(); }
    if (cam === "highlight") {
      restore = restore || view.camera.clone();
      aim = null;
      return startFollow();
    }
    dropFollow();
    restore = null;
    return MOVE[cam]?.();
  }

  function paintCams() {
    for (const b of els.pcams) {
      const on = b.dataset.cam === cam;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    paintFooter();
  }

  /**
   * The panel's two optional controls.
   *
   * Draw Play is offered wherever the play has something to draw, on any
   * camera: the diagram is worth having from a seat as much as from the
   * touchline, and gating it on the wide shot only meant it vanished the moment
   * anybody moved. It lives in the title bar, where there is room for it beside
   * the panel's own name.
   *
   * Choose Section belongs to Fan Perspective alone, because it is meaningless
   * anywhere else, and it carries the seat it would take you back to.
   */
  function paintFooter() {
    els.pchalk.hidden = !canDraw;
    els.playSeat.hidden = cam !== "fan";
    if (els.playSeatLabel) {
      const n = seatsRef?.section;
      els.playSeatLabel.textContent = n ? `Section ${n}` : "Choose section";
    }
    const draw = canDraw && chalkOn;
    api?.setChalk(draw);
    els.pchalk.setAttribute("aria-pressed", String(draw));
    els.pchalk.classList.toggle("on", draw);
  }

  /** Stand down whichever camera is in charge, without stealing the view back. */
  cameraOwner = () => {
    if (!cam) return;
    dropFollow();
    cam = null;
    paintCams();
    restore = null;
  };

  /** Return the camera to wherever the viewer had it before broadcast took it. */
  function handBack() {
    if (!restore) return;
    view.goTo(restore, { duration: 1000, easing: "in-out-cubic" }).catch(() => {});
    restore = null;
  }

  function paint(st) {
    if (!scrubbing) els.pscrub.value = String(st.t / st.dur);
    els.pclock.textContent = `${st.t.toFixed(1)}s`;
    els.picon.setAttribute("d", st.running ? PAUSE_D : PLAY_D);
    els.ptoggle.setAttribute("aria-label", st.running ? "Pause" : "Play");
    els.pphase.textContent = phaseAt(st.t);
    for (const i of els.pmarks.children) {
      i.classList.toggle("hit", st.t >= parseFloat(i.dataset.at) - 0.001);
    }
  }

  /**
   * Load a play the first time it is asked for, and keep it. Twenty-three
   * meshes apiece, so there is no reason to build the other one until someone
   * actually wants it.
   */
  async function ensure(key) {
    if (loaded.has(key)) return loaded.get(key);
    const spec = CONFIG.play.plays.find((x) => x.key === key);
    if (!spec) throw new Error("no play " + key);
    if (!pending) {
      els.pcap.textContent = "Loading…";
      pending = surfacesReady
        .then((surfaces) => {
          if (!surfaces) throw new Error("no playing surface");
          return addPlay(view, CONFIG, { data: spec.data, z: surfaces.z });
        })
        .then((p) => {
          loaded.set(key, p);
          p.onUpdate(paint);
          pending = null;
          return p;
        })
        .catch((err) => {
          // A fresh clone has no play data: it is built locally rather than
          // committed, because neither source publishes a licence. Say so,
          // rather than leaving a bare 404 for someone to interpret.
          els.pcap.textContent = /\b404\b/.test(err.message)
            ? "No replay data yet. It is built from the tracking sources rather "
              + "than shipped with the code — see tools/README.md."
            : `Unavailable: ${err.message}`;
          pending = null;
          throw err;
        });
    }
    return pending;
  }

  /**
   * Two chooser items, one per sport, built from the play list.
   *
   * Which passage of a sport is shown is not asked here. This menu answers
   * "which game", and the three American Football plays hanging off it made it
   * answer a question nobody had asked yet - you have to know what "Run right"
   * is before the choice means anything, and you only know that once you are
   * watching. So the passages live in the replay panel, next to the timeline
   * that explains them.
   */
  const sports = [];
  for (const spec of CONFIG.play.plays) {
    const found = sports.find((g) => g.sport === spec.sport);
    if (found) found.plays.push(spec);
    else sports.push({ sport: spec.sport, icon: spec.icon, plays: [spec] });
  }

  const sportButtons = new Map();
  function buildMenu() {
    els.liveMenu.textContent = "";
    for (const group of sports) {
      const b = document.createElement("button");
      b.className = "toolmenu__item";
      b.type = "button";
      b.setAttribute("role", "menuitem");
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
      use.setAttribute("href", `#${group.icon}`);
      svg.appendChild(use);
      const name = document.createElement("span");
      name.textContent = group.sport;
      b.append(svg, name);
      // Whichever of that sport's plays was last watched, so switching sports
      // and back returns you to where you were rather than to the top of a list.
      b.addEventListener("click", () => { onPick(); api2.toggle(lastOf(group)); });
      els.liveMenu.appendChild(b);
      sportButtons.set(group.sport, b);
    }
  }

  /** The sport a play belongs to, and that sport's group. */
  function groupOf(key) {
    return sports.find((g) => g.plays.some((p) => p.key === key));
  }

  // Remembered per sport, so the chooser reopens what you were last watching.
  const lastPlay = new Map();
  function lastOf(group) {
    return lastPlay.get(group.sport) ?? group.plays[0].key;
  }

  /**
   * The passages of whichever sport is open, as a row of buttons under the
   * transport. Hidden for a sport with only one, because a choice of one is
   * not a choice.
   */
  function buildPicks(key) {
    const group = groupOf(key);
    els.ppicks.textContent = "";
    els.ppicks.hidden = !group || group.plays.length < 2;
    if (els.ppicks.hidden) return;
    for (const spec of group.plays) {
      const b = document.createElement("button");
      b.className = "playseg__b";
      b.type = "button";
      b.setAttribute("aria-pressed", String(spec.key === key));
      b.classList.toggle("on", spec.key === key);
      if (spec.note) b.title = `${spec.label} — ${spec.note}`;
      const label = document.createElement("span");
      label.className = "playseg__label";
      label.textContent = spec.label;
      b.appendChild(label);
      if (spec.note) {
        const note = document.createElement("span");
        note.className = "playseg__note";
        note.textContent = spec.note;
        b.appendChild(note);
      }
      b.addEventListener("click", () => {
        if (spec.key === key) return;
        // Keep the camera: someone comparing two plays from the stand does not
        // want to be flown back to the touchline between them.
        api2.open({ key: spec.key, frame: false });
      });
      els.ppicks.appendChild(b);
    }
  }

  /** The sport button that should read as active for a play. */
  function button(key) { return sportButtons.get(groupOf(key)?.sport); }

  /** The first play of a sport, for the keyboard shortcuts and the deep links. */
  function firstOf(sport) {
    return CONFIG.play.plays.find((p) => p.sport === sport)?.key;
  }

  function menu(open) {
    els.liveMenu.hidden = !open;
    els.live.setAttribute("aria-expanded", String(!!open));
    els.live.classList.toggle("open", !!open);
  }

  // Run just before a replay is chosen from the chooser, so whoever owns the
  // other panels can shut them without this function having to know about them.
  let onPick = () => {};

  const api2 = {
    onPick(fn) { onPick = fn; },
    /** Hand over the seat chooser, which Fan Perspective defers to. */
    useSeats(s) { seatsRef = s; },
    /** The keyboard's way in, which is Fan Perspective's way in. */
    chooseSeat() { if (shown && api) setCam("fan"); },
    /** Redraw the optional controls, after something outside changed them. */
    repaint() { paintFooter(); },
    /** A play's own button closes it; any other switches over to it. */
    async toggle(key) {
      if (shown && active === key) { this.close(); return; }
      await this.open({ key });
    },
    /** The rail button just opens the chooser - or shuts an open replay. */
    group() {
      if (shown) { this.close(); return; }
      menu(els.liveMenu.hidden);
    },
    async open(opts) {
      const key = opts?.key ?? active ?? CONFIG.play.plays[0].key;
      els.ppanel.hidden = false;
      shown = true;

      let p;
      try { p = await ensure(key); } catch { return; }

      // After the data is in hand, not before: a failed load should not have
      // folded the panel away and switched the layers about for nothing.
      stage?.();

      // Put the other one away first, or both sets of players stand on the
      // same grass.
      for (const [k, other] of loaded) {
        if (k !== key) { other.pause(); other.show(false); }
      }
      api = p;
      active = key;
      // So the chooser reopens this sport where it was left, and the row of
      // passages under the transport marks the right one.
      lastPlay.set(groupOf(key)?.sport, key);
      buildPicks(key);
      // A route diagram is how American football is taught and drawn; football
      // is not, and eleven trails across a pitch would be noise rather than
      // notation. So the control only appears where it means something.
      // Offered where there is a play to draw, which is not the same as
      // "gridiron". A field goal is eleven men holding a line and one kicking:
      // nobody runs a route, so the diagram is twenty-two marks in a heap
      // around a snap and a hold, and it says less than the picture underneath
      // it does. The ball committing to somebody - a throw or a handoff - is
      // what makes a play worth drawing, so that is what is asked. Football
      // asks a different question, because it draws a different thing: not the
      // play but the goal, which needs the two men the file names for it.
      const ev = p.data.events ?? {};
      // Three different drawings, and a play qualifies for whichever it has
      // the makings of: routes where the ball is thrown or handed off, a flight
      // where it is kicked, a delivery and a finish where it is a goal.
      // The floodlights belong to the replay: it is the one part of the app
      // that is about watching something happen on the field, and the only one
      // that suffers for the field being dark. Switched on for you when it is
      // dark enough to matter, and yours to switch off.
      // Only after dark, and that is not a nicety. Virtual lighting replaces
      // the sun for the whole scene rather than for the ground - there is no
      // bounded light source in the SDK to put inside a stadium - so in
      // daylight it flattens the car parks, the trees and the interstate along
      // with the field, and lights a field that is already lit. Offered when it
      // is dark enough to be worth having and withdrawn when it is not.
      els.lightsBtn.hidden = !afterDark(view);
      if (afterDark(view) && !sky.lit) setLights(view, true);
      paintFixtures();
      canDraw = p.data.meta.sport === "gridiron"
        ? (ev.pass_forward != null || ev.handoff != null
           || ev.field_goal_attempt != null)
        : p.data.meta.assist != null;
      paintFooter();
      // A debugging handle, and only that - nothing in the app reads it.
      window.__play = p;

      for (const [sport, b] of sportButtons) {
        b.classList.toggle("active", sport === groupOf(key)?.sport);
      }
      els.live.classList.add("active");
      menu(false);
      els.pcap.replaceChildren(captionFor(p.data.meta));
      drawMarks();

      // Repaint the slab as whichever surface this play is played on.
      const surfaces = await surfacesReady;
      if (surfaces) await surfaces.use(p.surface);


      aim = null;
      api.show(true);
      api.seek(0);
      // Broadcast is the opening view, so the button says so rather than the
      // panel opening with nothing selected on a camera it had just moved.
      // Only if nobody got there first: loading the other sport takes a second
      // or two, and a viewer who picks a camera during it should keep it.
      if (opts?.cam) { cam = opts.cam; paintCams(); }
      else if (opts?.frame !== false && !cam) { cam = "broadcast"; paintCams(); await frameField(); }
      else paintCams();
      return p;
    },
    close() {
      shown = false;
      // The lights come down with the replay that raised them. A scene left lit
      // from the camera after the thing that needed it has gone is how a viewer
      // ends up wondering why the sun has stopped moving.
      els.lightsBtn.hidden = true;
      setLights(view, false);
      paintFixtures();

      els.ppanel.hidden = true;
      for (const b of sportButtons.values()) b.classList.remove("active");
      els.live.classList.remove("active");
      menu(false);
      if (api) { api.pause(); api.show(false); }
      // Back to whatever the field is normally painted as.
      surfacesReady.then((s) => s?.use(CONFIG.field.default)).catch(() => {});
      handBack();
      dropFollow();
      cam = null;
      paintCams();
    },
    wire() {
      els.ptoggle.addEventListener("click", () => {
        if (!api) return;
        api.running ? api.pause() : api.start();
      });
      els.pscrub.addEventListener("pointerdown", () => { scrubbing = true; });
      els.pscrub.addEventListener("pointerup", () => { scrubbing = false; });
      els.pscrub.addEventListener("input", () => {
        if (!api) return;
        api.pause();
        api.seek(parseFloat(els.pscrub.value) * api.duration);
      });
      els.pchalk.addEventListener("click", () => {
        chalkOn = !chalkOn;
        paintFooter();
      });
      els.lightsBtn.addEventListener("click", () => setLights(view, !sky.lit));
      els.precenter.addEventListener("click", recenter);
      els.prestart.addEventListener("click", () => {
        if (!api) return;
        api.seek(0);
        api.start();
      });
      for (const b of els.pcams) {
        b.addEventListener("click", () => setCam(b.dataset.cam));
      }
      els.pclose.addEventListener("click", () => this.close());
      // Clicking away closes the flyout, the way a menu should.
      document.addEventListener("pointerdown", (e) => {
        if (els.liveMenu.hidden) return;
        if (els.liveMenu.contains(e.target) || els.live.contains(e.target)) return;
        menu(false);
      });
      window.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (!els.liveMenu.hidden) menu(false);
      });
    }
  };

  buildMenu();
  return api2;
}

/**
 * The view from a seat.
 *
 * Standalone, and open to a viewer whether or not a replay is running: the
 * question it answers - what would I see from there - is the one somebody
 * choosing a seat is actually asking, and it does not need a play to be
 * meaningful.
 *
 * While a replay *is* running it follows the ball, slowly. A seat does not
 * snap, and neither does a head: the aim eases towards the ball rather than
 * tracking it, so the camera drifts across the play a moment behind it. Chasing
 * it exactly is what makes a follow camera unwatchable, and from a fixed seat
 * it would be wrong as well as unpleasant - the one thing you cannot do from
 * row 20 is keep the ball centred.
 */
function buildSeats(view, surfacesReady, onTaken) {
  let at = null;                 // section currently chosen
  let follow = null;             // rAF handle while following the ball
  let aim = null;                // eased look-at point, in metres east/north
  let taken = null;              // called once a seat is chosen

  // Preview as you browse, commit when you take it. Stepping through the list
  // moves the camera so the choice is made by looking rather than by reading a
  // number, and the sheet stays up until the seat is taken.
  const open = (onTake) => {
    taken = onTake ?? null;
    els.seatSheet.hidden = false;
    if (at == null) at = sections()[0];
    goTo(at);
  };
  const close = () => { els.seatSheet.hidden = true; taken = null; };

  function stopFollow() {
    if (follow) cancelAnimationFrame(follow);
    follow = null;
    aim = null;
  }

  /**
   * Ease the heading towards wherever the ball is, from the seat we are in.
   *
   * The easing is on the *point looked at*, not on the angle, so the camera
   * turns quickly when the ball is close and barely at all when it is at the
   * far end - which is how a person in a seat behaves. Easing the angle
   * directly gives the opposite and looks like a turret.
   */
  const FOLLOW_K = 0.045;        // per frame, towards the ball
  let seat = null;               // the seat to resume following from
  let handedOver = false;        // the viewer has taken the camera

  /**
   * Give the camera up when the viewer reaches for it.
   *
   * Player Highlight has done this from the start and a seat has to as well:
   * a camera that keeps pulling back to the ball while somebody is trying to
   * look around is unusable, and from a fixed seat there is nowhere for them
   * to go. The same button offers it back - it says "recenter on the ball",
   * which is exactly what it does from a seat too.
   *
   * `interacting` is the viewer's own input and nothing else; a camera written
   * from script does not set it, so the follow cannot trip this itself.
   */
  reactiveUtils.watch(() => view.interacting, (busy) => {
    if (!busy || !follow) return;
    stopFollow();
    handedOver = true;
    els.precenter.hidden = false;
  });

  els.precenter.addEventListener("click", () => {
    // Shared with Player Highlight, which ignores the click unless it is the
    // camera in charge; this does the same from the other side.
    if (!handedOver || !seat) return;
    handedOver = false;
    els.precenter.hidden = true;
    startFollow(seat);
  });

  function startFollow(cam) {
    stopFollow();
    seat = cam;
    handedOver = false;
    els.precenter.hidden = true;
    const step = () => {
      const p = window.__play;
      const ball = p?.ballEN?.();
      // Stops when the play does, or when the chooser comes back up - the
      // camera should not still be drifting while somebody is picking a
      // different seat underneath it.
      if (!ball || !els.seatSheet.hidden) { follow = null; return; }
      // From the middle of the field, which is where the flight into the seat
      // left the camera pointing. Starting the ease at the ball instead makes
      // the first frame a jump of however far the ball happens to be from the
      // centre - measured at twenty-one degrees, in one sample, which is the
      // one thing a slow follow must never do.
      if (!aim) aim = [0, 0];
      aim = [aim[0] + (ball[0] - aim[0]) * FOLLOW_K,
             aim[1] + (ball[1] - aim[1]) * FOLLOW_K];
      const here = cam.position;
      const mPerLon = 111320 * Math.cos(CONFIG.field.lat * Math.PI / 180);
      const e = (here.longitude - CONFIG.field.lon) * mPerLon;
      const n = (here.latitude - CONFIG.field.lat) * 110540;
      const de = aim[0] - e, dn = aim[1] - n;
      const flat = Math.hypot(de, dn) || 1;
      view.camera = new Camera({
        position: here,
        heading: (Math.atan2(de, dn) * 180) / Math.PI,
        tilt: 90 - (Math.atan2(here.z - (window.__field?.z ?? here.z), flat) * 180) / Math.PI
      });
      follow = requestAnimationFrame(step);
    };
    follow = requestAnimationFrame(step);
  }

  async function goTo(section, { ms = 1500 } = {}) {
    const surfaces = await surfacesReady;
    if (!surfaces) return null;
    const cam = sectionCamera(CONFIG, section, surfaces.z);
    if (!cam) return null;
    at = section;
    els.seatSelect.value = String(section);
    paintMap();
    const ring = ringOf(section);
    els.seatWhere.textContent = ring ? `${ring.name} level` : "";
    stopFollow();
    try {
      await view.goTo(cam, { duration: ms, easing: "in-out-cubic" });
    } catch { /* the viewer took over mid-flight */ }
    return cam;
  }

  /** Settle into the chosen seat and start watching from it. */
  async function take() {
    // Held before closing, because closing is what forgets it. Reading it
    // afterwards is reading null, and the play sat still at the moment it was
    // supposed to start.
    const done = taken;
    const cam = await goTo(at, { ms: 1100 });
    close();
    if (cam && window.__play) startFollow(cam);
    // So the way back in reads "Section 117" rather than the invitation it
    // stopped being the moment a seat was chosen.
    onTaken?.();
    done?.();
  }

  const shift = (by) => {
    const all = sections();
    const i = all.indexOf(at);
    goTo(all[(Math.max(0, i) + by + all.length) % all.length]);
  };

  const SVG = "http://www.w3.org/2000/svg";
  const node = (name, attrs) => {
    const el = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };

  /**
   * The plan of the bowl.
   *
   * Drawn, not photographed. A picture of a seating chart would need keeping in
   * step with the ring table by hand, and would be wrong the moment either
   * changed; this comes out of the same numbers the cameras do, so a section in
   * the wrong place here is a section the camera also flies to the wrong place.
   *
   * The field is drawn properly - turf, end zones, yard lines, halfway - because
   * without something unmistakably a football field in the middle, a ring of
   * tiles gives a viewer nothing to take a bearing from.
   */
  function drawMap() {
    const plan = sectionPlan(CONFIG);
    const R = plan.reach;
    const svg = node("svg", {
      viewBox: `${-R} ${-R * 0.72} ${R * 2} ${R * 1.44}`,
      role: "group", "aria-label": "Plan of the seating bowl"
    });

    const f = plan.field;
    // End zones are the outer tenth or so at each end; the marked field runs
    // between them. Drawn as one block plus two, which is enough to read.
    svg.appendChild(node("rect", {
      class: "pitch", x: -f.along, y: -f.across,
      width: f.along * 2, height: f.across * 2, rx: 1
    }));
    const ez = f.along * 0.166;
    for (const sx of [-1, 1]) {
      svg.appendChild(node("rect", {
        class: "endzone", x: sx > 0 ? f.along - ez : -f.along,
        y: -f.across, width: ez, height: f.across * 2
      }));
    }
    for (let i = 1; i < 10; i++) {
      const x = -f.along + ez + ((f.along - ez) * 2 * i) / 10;
      svg.appendChild(node("line", {
        class: i === 5 ? "halfway" : "yard",
        x1: x, y1: -f.across, x2: x, y2: f.across
      }));
    }

    // One tile a section, turned to lie along its ring.
    for (const b of plan.blocks) {
      const g = node("g", {
        // Along is negated so the plan reads the way the printed seating map
        // does: north to the left, south to the right, east at the top. The
        // maths puts south on the left, which is correct and unfamiliar - and
        // this chart will be held up against the official one.
        transform: `translate(${(-b.along).toFixed(2)} ${(-b.across).toFixed(2)})`
                 + ` rotate(${(-b.turn).toFixed(2)})`
      });
      const tile = node("rect", {
        class: "sec", "data-section": b.section,
        x: -b.wide / 2, y: -b.deep / 2, width: b.wide, height: b.deep, rx: 2
      });
      tile.addEventListener("click", () => goTo(b.section));
      g.appendChild(tile);
      g.appendChild(Object.assign(node("text", {
        class: "seclabel", x: 0, y: 0,
        transform: `rotate(${b.turn.toFixed(2)})`
      }), { textContent: String(b.section) }));
      svg.appendChild(g);
    }
    els.seatMap.replaceChildren(svg);
  }

  /** Mark whichever tile is chosen. */
  function paintMap() {
    els.seatMap.querySelectorAll(".sec").forEach((t) => {
      t.classList.toggle("on", Number(t.dataset.section) === at);
    });
  }

  function build() {
    // Grouped by level. A hundred and thirty-five sections in one list is a
    // scroll rather than a choice, and the level is the first thing anybody
    // decides anyway - lower bowl, club, or somewhere up in the 500s.
    els.seatSelect.replaceChildren(...RINGS.map((ring) => {
      const g = document.createElement("optgroup");
      g.label = `${ring.name} level`;
      for (let i = 0; i < ring.count; i++) {
        const n = ring.first + i;
        const o = document.createElement("option");
        o.value = String(n);
        o.textContent = `Section ${n}`;
        g.appendChild(o);
      }
      return g;
    }));
    els.seatSelect.addEventListener("change", () =>
      goTo(parseInt(els.seatSelect.value, 10)));
    els.seatPrev.addEventListener("click", () => shift(-1));
    els.seatNext.addEventListener("click", () => shift(1));
    els.seatTake.addEventListener("click", take);
    drawMap();
    els.seatSheet.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) close();
    });
  }

  build();
  return {
    open, close,
    get section() { return at; },
    get choosing() { return !els.seatSheet.hidden; }
  };
}

function wireTools(view, surfacesReady,
                   { captureDefaults, replayDefaults, slides = [], tour } = {}) {
  const start = view.camera.clone();
  els.home.addEventListener("click", () =>
    view.goTo(start, { duration: 1800, easing: "in-out-cubic" }).catch(() => {}));

  // Collapsing the capture list is deliberately separate from hiding the
  // interface: that button takes everything away, and often the only thing in
  // the way is this one panel. The choice is remembered, because someone who
  // shuts it once is unlikely to want it back on the next load.
  const COLLAPSE_KEY = "venue.captures.collapsed";
  const setCollapsed = (on) => {
    els.captures.classList.toggle("collapsed", on);
    els.capturesToggle.setAttribute("aria-expanded", String(!on));
    els.capturesToggle.title = on ? "Show the capture list" : "Collapse the capture list";
  };
  let collapsed = false;
  try { collapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { /* private mode */ }
  setCollapsed(collapsed);
  els.capturesToggle.addEventListener("click", () => {
    collapsed = !collapsed;
    setCollapsed(collapsed);
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignore */ }
  });

  // Whether the panel is on screen at all, which is a different question
  // from whether its list is folded away - see the CSS for .stowed.
  //
  // Every switch in it controls a layer that the saved views already turn on
  // and off correctly as they arrive, so for a viewer following the tour it
  // can only disagree with the tour - and the way that disagreement showed
  // up in practice was somebody switching off a capture, not recognising
  // what had gone, and carrying on through a scene missing half of what it
  // was built to show.
  //
  // So it starts stowed on every load, and deliberately remembers nothing.
  // Remembering was tried and is wrong here: one curious click became a
  // panel that reopened itself for good, which is the state this was meant
  // to get rid of. The collapse above still remembers, because that is a
  // preference about a panel somebody has asked for; this is not a
  // preference, it is a door.
  const setStowed = (off) => {
    els.captures.classList.toggle("stowed", off);
    els.capturesBtn.classList.toggle("active", !off);
    els.capturesBtn.setAttribute("aria-pressed", String(!off));
    els.capturesBtn.title = off ? "Captures" : "Hide the captures";
  };
  let stowed = true;
  setStowed(true);
  els.capturesBtn.addEventListener("click", () => {
    stowed = !stowed;
    // Asking for the panel means asking to see the list. Anyone who left it
    // collapsed a session ago, or who had it folded away by a replay, would
    // otherwise get back a bare header and a panel that appeared to have
    // nothing in it.
    if (!stowed && collapsed) {
      collapsed = false;
      setCollapsed(false);
      try { localStorage.setItem(COLLAPSE_KEY, "0"); } catch { /* ignore */ }
    }
    setStowed(stowed);
  });

  // Starting a replay folds the list away, because it sits directly over the
  // near corner of the field. That is a nudge and not a preference, so it is
  // deliberately not written to storage - the next load still opens on whatever
  // the user last chose for themselves. `collapsed` is kept in step or the
  // toggle's first click afterwards would do nothing visible.
  const collapseCaptures = () => {
    if (collapsed) return;
    collapsed = true;
    setCollapsed(true);
  };

  const measure = buildMeasure(view);
  const timeOfDay = buildTimeOfDay(view);

  // What a replay wants on screen: the capture list out of the way, and the
  // meshes rather than the splat. A replay is watched from inside the bowl -
  // from a seat, from the touchline, from just above the ball - and at that
  // range the splat is the weaker of the two reconstructions, so the saved fan
  // views are authored with the meshes on and this matches them. It used to be
  // the other way round, chosen from the wide drone shot where the splat wins.
  const stage = () => {
    // A running slideshow and a replay both want the camera; the replay wins,
    // because starting one is the more deliberate act of the two.
    tour?.stop();
    collapseCaptures();
    replayDefaults?.();
  };
  const liveAction = buildLiveAction(view, surfacesReady, stage, slides);
  liveAction.wire();
  const seats = buildSeats(view, surfacesReady, () => liveAction.repaint());
  liveAction.useSeats(seats);
  // The way back to the chooser once a seat has been taken, next to Draw Play
  // where the other replay options are.
  els.playSeat.addEventListener("click", () => seats.open());

  // One panel at a time, and the outgoing one is properly torn down rather than
  // just hidden — a hidden measurement widget leaves its analysis on the view.
  els.measure.addEventListener("click", () => {
    timeOfDay.close(); liveAction.close(); measure.toggle();
  });
  els.timeOfDay.addEventListener("click", () => {
    measure.close(); liveAction.close(); timeOfDay.toggle();
  });
  els.live.addEventListener("click", () => {
    measure.close(); timeOfDay.close(); liveAction.group();
  });
  // The chooser's own items are wired where they are built; they only need the
  // other two panels shut on the way past.
  liveAction.onPick(() => { measure.close(); timeOfDay.close(); });

  // Where a flight to a replay view should finish: the broadcast camera for
  // whichever play that view opens. Awaited rather than computed inline because
  // the surface's height is probed at load; by the time anybody presses play it
  // has long since resolved, so nothing waits on it in practice.
  tour?.onLanding(async (n) => {
    const key = viewAt(n)?.opens;
    const play = CONFIG.play.plays.find((p) => p.key === key);
    if (!play?.surface) return null;
    const surfaces = await surfacesReady;
    if (!surfaces) return null;
    return broadcastCamera(CONFIG, play.surface, surfaces.z);
  });

  // How it was made. A sheet rather than a dock panel: four sections of prose
  // want a column, and the dock is a letterbox pinned to the bottom.
  const showInfo = (on) => {
    els.infoSheet.hidden = !on;
    els.info.classList.toggle("active", on);
    if (on) els.infoSheet.querySelector("#infoClose")?.focus();
  };
  els.info.addEventListener("click", () => showInfo(els.infoSheet.hidden));
  // Anything marked data-close dismisses it, scrim included.
  els.infoSheet.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) showInfo(false);
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.infoSheet.hidden) showInfo(false);
  });

  els.hud.addEventListener("click", () => document.body.classList.toggle("hud-off"));
  return { measure, timeOfDay, liveAction, seats };
}

/**
 * The keyboard shortcuts.
 *
 * `tools` is passed in rather than reached for. It used to be neither: the two
 * shortcuts that open a sport read a bare `tools`, which is not a variable in
 * this scope and so resolved to the toolbar div - because an element with an id
 * is also a property of window, and a lookup that should have failed loudly
 * found an HTMLDivElement instead. Every press of A or G threw on the missing
 * method, silently, and the tooltip on the rail button went on advertising
 * both.
 */
function wireKeys(view, tour, tools) {
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    switch (e.key) {
      case "ArrowRight": tour.next?.(); break;
      case "ArrowLeft":  tour.prev?.(); break;
      case "u": case "U": document.body.classList.toggle("hud-off"); break;
      case "m": case "M": els.measure.click(); break;
      case "t": case "T": els.timeOfDay.click(); break;
      case "i": case "I": els.info.click(); break;
      case "l": case "L": els.live.click(); break;
      // The first play of each sport. Which one that is follows CONFIG's
      // order, so it stays the shortcut to "the American Football one" even
      // once there are three of them.
      case "a": case "A": tools.liveAction.toggle("gridiron"); break;
      case "g": case "G": tools.liveAction.toggle("football"); break;
      case "h": case "H": els.home.click(); break;
      // Only where it means something. The chooser lives inside the replay
      // now, and opening it from anywhere else leaves a viewer sitting in a
      // stand with the panel still reading Broadcast and no way back to the
      // list - the control that reopens it is only shown in Fan Perspective.
      case "s": case "S": tools.liveAction.chooseSeat(); break;
      case "c": case "C": copyCamera(view); break;
    }
  });
}

main();
