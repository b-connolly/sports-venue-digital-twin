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

  const swap = spec.swap ?? null;
  const goingOut = swap ? layerNamed(swap.off) : null;
  const comingIn = swap ? layerNamed(swap.on) : null;
  const was = [goingOut, comingIn].filter(Boolean).map((l) => [l, l.visible]);
  const undo = () => was.forEach(([l, visible]) => { l.visible = visible; });

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
    if (comingIn && swap && (swap.onAtT ?? 0) <= 0) comingIn.visible = true;
    let offDone = false;
    let onDone = !!(comingIn && swap && (swap.onAtT ?? 0) <= 0);
    const t0 = performance.now();

    const frame = () => {
      if (aborted()) { undo(); done("abandoned"); return; }
      const raw = Math.min(1, (performance.now() - t0) / ms);

      if (swap && !onDone && raw >= (swap.onAtT ?? 0)) {
        if (comingIn) comingIn.visible = true;
        onDone = true;
      }
      if (swap && !offDone && raw >= (swap.offAtT ?? 1)) {
        if (goingOut) goingOut.visible = false;
        offDone = true;
      }

      // One ease across the whole move rather than one per leg. Smoothstep
      // leaves and arrives at a standstill and is flat out through the middle,
      // which is the shape a camera operator would give it.
      const u = raw * raw * (3 - 2 * raw);
      view.camera = cameraFrom(
        centre,
        along(bearing, u), along(out, u), along(up, u),
        along(tilt, u), along(heading, u)
      );

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
