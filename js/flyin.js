/**
 * The shot that opens the show: one move from the wide view into the seat.
 *
 * The slideshow used to cut from the drone view straight into a stand, past the
 * two things the app exists to show - the splat, and the stadium itself. So on
 * pressing play the camera makes one pass around the ground and comes over the
 * rim into the seat.
 *
 * It is also a curtain, and that is the more useful half. The preload has to
 * stop the moment somebody clicks Explore, because warming a view means moving
 * the camera and after the click that would be on screen. Here the camera
 * movement *is* what is on screen: the drone mesh the replay needs comes on at
 * the start of the pass and streams for the whole of it, under a splat that
 * stays up until near the end. The seat is reached with the mesh already there.
 *
 * ## Smoothing, and why the timing alone is not enough
 *
 * The camera is placed from elapsed time, which is the only way a move of a
 * fixed length can also be a move of a fixed shape. The cost is that a frame
 * hitch becomes a jump: at 25 fps with occasional 170 ms gaps - which is what
 * this scene does while it is streaming - a strictly time-based camera moved
 * as much as 68 degrees a second in bursts against a mean of 10, and it read
 * as the whole pass being unstable rather than as the scene being busy.
 *
 * So the camera follows the timed target rather than being it. Each frame it
 * moves a proportion of the way there, and the proportion is computed from the
 * frame's own length so the lag is a duration rather than a number of frames.
 * A hitch then plays out over the next several frames instead of all at once.
 * The lag is small enough to be invisible against an eased move and is paid off
 * entirely by the end, where the camera is snapped onto the slide's own.
 *
 * ## Why this does not use goTo
 *
 * It did, once per waypoint, and the seams between them were audible as pauses.
 * A goTo animates to a target and *finishes*: it decelerates into every
 * waypoint and accelerates out of the next, so a path of six was six starts and
 * six stops, and cutting it to three only made three. There is no easing that
 * fixes it, because the stop is the end of an animation rather than a shape in
 * one.
 *
 * So the camera is driven here instead, one assignment per frame along a spline
 * through the waypoints, with a single ease across the whole move. It
 * accelerates once at the beginning and settles once at the end, and nothing in
 * between has a seam in it.
 *
 * The other thing it buys is the ending. A chain of flights cannot finish
 * inside the bowl - every approach that closes on a seat from outside crosses
 * the outer wall or threads the roof, which is what the earlier versions did.
 * Driving the path directly means it can rise over the rim and drop in through
 * the opening, and it can end on the slide's own camera exactly, so there is
 * nothing left to jump.
 *
 * The path is kept in polar terms - a bearing round the ground, a distance from
 * the middle of it, a height above the playing surface - because that is how
 * the shot is actually described, and because interpolating a circle in those
 * terms stays a circle. Interpolating the same move in x, y, z cuts the corner
 * and flies through the building.
 */
import Camera from "https://js.arcgis.com/5.0/@arcgis/core/Camera.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

// How far behind the timed target the camera is allowed to sit, in seconds.
// Long enough to swallow a dropped frame, short enough that the move still
// starts and stops when it is told to.
const LAG_S = 0.17;

/** Catmull-Rom through p1 and p2, with p0 and p3 setting the tangents. */
function spline(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1
    + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** One field of the path, sampled at u in [0, 1] across the whole move. */
function along(values, u) {
  const n = values.length - 1;
  const x = Math.min(Math.max(u, 0), 1) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const at = (k) => values[Math.min(Math.max(k, 0), n)];
  return spline(at(i - 1), at(i), at(i + 1), at(i + 2), x - i);
}

/** Where a camera sits, in the terms the path is written in. */
function toPolar(camera, centre) {
  const p = camera.position;
  const east = (p.longitude - centre.lon)
    * M_PER_DEG_LON * Math.cos((centre.lat * Math.PI) / 180);
  const north = (p.latitude - centre.lat) * M_PER_DEG_LAT;
  return {
    bearing: (Math.atan2(east, north) * 180) / Math.PI,
    out: Math.hypot(east, north),
    up: p.z - centre.z,
    tilt: camera.tilt,
    heading: camera.heading
  };
}

function cameraFrom(centre, bearing, out, up, tilt, heading) {
  const rad = (bearing * Math.PI) / 180;
  return new Camera({
    position: new Point({
      longitude: centre.lon + (out * Math.sin(rad))
        / (M_PER_DEG_LON * Math.cos((centre.lat * Math.PI) / 180)),
      latitude: centre.lat + (out * Math.cos(rad)) / M_PER_DEG_LAT,
      z: centre.z + up,
      spatialReference: { wkid: 4326 }
    }),
    heading: ((heading % 360) + 360) % 360,
    tilt
  });
}

/** One title, several, or none, always as a list. */
function names(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Bring `to` within half a turn of `from`, so a sweep never goes the long way. */
function nearest(from, to) {
  let d = to - from;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return from + d;
}

/**
 * Fly the shot.
 *
 * @param {object} view          the SceneView
 * @param {object} spec          CONFIG.flyIn
 * @param {object} centre        { lat, lon, z } of the playing surface
 * @param {Function} layerNamed  title -> layer, or undefined
 * @param {Function} aborted     true once the viewer has taken over
 * @param {object} landOn        the camera to finish on - the slide's own
 * @returns {Promise<string>}    "flown", or "abandoned" if it was cut short
 */
export function flyLap(view, spec, centre, layerNamed, aborted, landOn) {
  const via = spec.path ?? [];
  if (!via.length || !landOn) return Promise.resolve("abandoned");

  /**
   * Layers switched at points along the move.
   *
   * A list rather than one on and one off, because the two flights this drives
   * want different things at different moments and the single pair could only
   * express one of them. The opening lap has one swap - mesh on, splat off,
   * both near the end. The walk round to the statues has three, and the reason
   * they are not one is the whole point of warming: the statue captures are off
   * to the south of everything the camera passes and can come on immediately,
   * where the stadium mesh is opaque and would sit over the splat for the whole
   * sweep if it did.
   *
   * Each step names a fraction of the move and the layers to show or hide at
   * it. Everything touched is put back if the move is abandoned.
   */
  const steps = (Array.isArray(spec.swap) ? spec.swap : [spec.swap])
    .filter(Boolean)
    .map((st) => ({
      at: st.at ?? st.onAtT ?? st.offAtT ?? 1,
      on: names(st.on).map(layerNamed).filter(Boolean),
      off: names(st.off).map(layerNamed).filter(Boolean),
      done: false
    }))
    .sort((a, b) => a.at - b.at);
  const was = new Map();
  for (const st of steps) {
    for (const l of [...st.on, ...st.off]) {
      if (!was.has(l)) was.set(l, l.visible);
    }
  }
  const undo = () => was.forEach((visible, l) => { l.visible = visible; });

  // Start where the camera already is, finish on the slide's own camera, and
  // and take the written waypoints in between. Bearings are unwrapped as they
  // are added so the sweep goes the short way round and keeps going that way.
  const here = toPolar(view.camera, centre);
  const there = toPolar(landOn, centre);
  const keys = [here, ...via, there];
  const bearing = [];
  const heading = [];
  for (let i = 0; i < keys.length; i++) {
    const b = i === 0 ? keys[0].bearing : nearest(bearing[i - 1], keys[i].bearing);
    bearing.push(b);
    // A waypoint that names no heading looks at the middle of the ground, which
    // is what keeps the stadium framed for the whole move.
    const h = keys[i].heading ?? (b + 180);
    heading.push(i === 0 ? h : nearest(heading[i - 1], h));
  }
  const out = keys.map((k) => k.out);
  const up = keys.map((k) => k.up);
  const tilt = keys.map((k) => k.tilt);

  const ms = spec.ms ?? 16000;

  return new Promise((done) => {
    const apply = (st) => {
      st.done = true;
      for (const l of st.on) l.visible = true;
      for (const l of st.off) l.visible = false;
    };
    // Anything due at the very start happens before the first frame rather
    // than on it, so a layer asked for at t=0 begins streaming as the move does
    // rather than a frame into it.
    for (const st of steps) if (st.at <= 0) apply(st);
    const t0 = performance.now();

    // What the camera is actually showing, as against where the clock says it
    // should be. Seeded on the first frame so the move starts where it starts.
    let shown = null;
    let last = performance.now();

    const frame = () => {
      if (aborted()) { undo(); done("abandoned"); return; }
      const now = performance.now();
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const raw = Math.min(1, (now - t0) / ms);

      for (const st of steps) if (!st.done && raw >= st.at) apply(st);

      // One ease across the whole move rather than one per leg. Smoothstep
      // leaves and arrives at a standstill and is flat out through the middle,
      // which is the shape a camera operator would give it.
      const u = raw * raw * (3 - 2 * raw);
      const want = [along(bearing, u), along(out, u), along(up, u),
                    along(tilt, u), along(heading, u)];
      if (!shown) shown = want.slice();
      // Exponential, and computed from this frame's own length rather than a
      // fixed step: a long frame catches up more, so the lag stays a duration
      // instead of drifting with the frame rate.
      const k = 1 - Math.exp(-dt / LAG_S);
      for (let i = 0; i < want.length; i++) {
        shown[i] += (want[i] - shown[i]) * k;
      }
      view.camera = cameraFrom(centre, shown[0], shown[1], shown[2],
                               shown[3], shown[4]);

      if (raw >= 1) {
        // Land on the slide's own camera exactly, so whatever follows has
        // nothing left to move.
        view.camera = landOn;
        done("flown");
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}
