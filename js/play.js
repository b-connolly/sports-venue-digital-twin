/**
 * Replayed passages of play, on whichever surface they need.
 *
 * Two are loaded: a gridiron touchdown and an association football team goal.
 * They run through identical code — the JSON declares its own coordinate space
 * and which painted surface it wants, and everything else follows from that.
 *
 * How much to trust the movement differs between them, and the data says which
 * is which via `meta.measured`:
 *
 *   measured: true   Every position comes from the league's own public tracking
 *                    release. Routes, closing speeds and pursuit angles are the
 *                    ones that actually happened.
 *   measured: false  Reconstructed from footage. The order of events and the
 *                    rhythm are faithful; the coordinates are authored.
 *
 * The one thing the SDK cannot do is play a skinned animation — glTF skinning
 * and keyframes are unsupported. What it does support, since 4.30, is cheap
 * per-frame rigid transforms on a Mesh. So each player is a single rigid figure
 * frozen mid-stride, and the running is implied by secondary motion instead: a
 * stride bob whose frequency follows actual speed, a forward pitch that follows
 * speed, and a roll into the turn that follows the actual rate of change of
 * heading. At the distance this scene is viewed from, those cues carry the
 * motion better than limb detail would.
 *
 * Every figure shares one MeshLocalVertexSpace origin at the centre of the
 * field, so a player position is just a translation in metres and no geodetic
 * maths happens per frame.
 */

import Graphic from "https://js.arcgis.com/5.0/@arcgis/core/Graphic.js";
import GraphicsLayer from "https://js.arcgis.com/5.0/@arcgis/core/layers/GraphicsLayer.js";
import SpatialReference from "https://js.arcgis.com/5.0/@arcgis/core/geometry/SpatialReference.js";
import MeshTransform from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshTransform.js";
import MeshSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/MeshSymbol3D.js";
import FillSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/FillSymbol3DLayer.js";
import { Builder, block, spheroid, finish, DEG } from "./meshkit.js";
import { addGoals } from "./goals.js";

/* --------------------------------------------------------------- the figure
 * 1.85 m tall, caught mid-stride: lead leg driving forward, trail leg extended
 * behind, arms counter-swinging. Built facing +y with the feet at z = 0.
 *
 * Two builds off the same skeleton. A gridiron player is helmeted, padded at
 * the shoulders and covered to the ankle; a footballer is bare-headed, in
 * shorts, with socks to the knee. The silhouettes read differently enough at
 * distance that nobody has to be told which sport they are watching.
 */
function figure(kit, origin, sr, code) {
  const b = Builder(5);            // 0 jersey 1 shorts 2 head 3 skin 4 socks
  const soccer = code === "football";

  // Limbs come in pairs, and the second of each pair hangs from the end of the
  // first. That end is worked out rather than typed, because typing it is what
  // went wrong: three of the four joints had been given a plausible height but
  // an x taken from nowhere, so both forearms hung off the centre of the body
  // at hip height - which read exactly as badly as it sounds - and the lead
  // shin floated a third of a metre from its own knee, on the wrong side.
  const limb = (px, py, pz, len, pitch) =>
    [px, py + len * Math.sin(pitch * DEG), pz - len * Math.cos(pitch * DEG)];

  // Legs: thigh, then shin off the knee. The shin is bare skin under a sock in
  // football, and trousered to the ankle in gridiron.
  const shin = soccer ? 4 : 1;
  // The footballer's thigh is shorter only because that is where his sock
  // starts, not because his leg is - so the shin makes the difference back.
  // Left as it was, the shorter thigh took the whole leg with it and the
  // figure stood a hand's breadth above the grass.
  const THIGH = soccer ? 0.34 : 0.50, SHIN = soccer ? 0.62 : 0.46, HIP = 0.92;
  for (const [hx, thighPitch, shinPitch] of [[-0.10, 28, -34], [0.10, -34, -6]]) {
    block(b, 1, hx, 0.00, HIP, THIGH, 0.17, 0.17, thighPitch);
    const [kx, ky, kz] = limb(hx, 0.00, HIP, THIGH, thighPitch);
    block(b, shin, kx, ky, kz, SHIN, 0.13, 0.13, shinPitch);
  }

  // Torso. Shoulder pads make the gridiron player noticeably wider up top.
  block(b, 0, 0.00, 0.02, 1.48, 0.56, soccer ? 0.40 : 0.46, soccer ? 0.22 : 0.26);

  // Arms bare in both codes. The gridiron player used to be sleeved to the
  // elbow, which is true of some of them and left two forearms and a sliver of
  // neck as the only skin on the whole figure - so a per-player skin tone was
  // invisible on him. Short sleeves are common enough in the NFL and put the
  // upper arm back on show.
  const upper = 3;
  const UPPER = 0.34, FORE = 0.30, SHOULDER = 1.44;
  for (const [sx, upperPitch, forePitch] of [[-0.24, 52, -46], [0.24, -44, 62]]) {
    block(b, upper, sx, 0.02, SHOULDER, UPPER, 0.12, 0.12, upperPitch);
    const [ex, ey, ez] = limb(sx, 0.02, SHOULDER, UPPER, upperPitch);
    block(b, 3, ex, ey, ez, FORE, 0.10, 0.10, forePitch);
  }

  block(b, 3, 0.00, 0.02, 1.56, 0.10, 0.15, 0.15);                          // neck
  if (soccer) spheroid(b, 2, 0, 0.02, 1.65, 0.105, 0.115, 0.125);           // head
  else spheroid(b, 2, 0, 0.03, 1.63, 0.135, 0.15, 0.14);                    // helmet

  return finish(b, [kit.jersey, kit.shorts, kit.head, kit.skin, kit.socks], origin, sr);
}

/** A prolate spheroid for gridiron, a sphere for football. */
function ballMeshFor(code, radius, origin, sr) {
  const b = Builder(1);
  if (code === "football") {
    spheroid(b, 0, 0, 0, 0, radius, radius, radius, 14, 9);
    return finish(b, [[246, 246, 244]], origin, sr);
  }
  spheroid(b, 0, 0, 0, 0, 0.085, 0.145, 0.085, 12, 8);
  return finish(b, [[122, 74, 44]], origin, sr);
}

/* ------------------------------------------------------------------- rotate
 * MeshTransform carries a single axis and angle, so heading, pitch and roll are
 * composed as quaternions and converted once.
 */
function quatAxis(ax, ay, az, deg) {
  const h = deg * DEG / 2, s = Math.sin(h);
  return [ax * s, ay * s, az * s, Math.cos(h)];
}
function qmul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
  ];
}
function toAxisAngle(q) {
  const w = Math.min(1, Math.max(-1, q[3]));
  const s = Math.sqrt(1 - w * w);
  if (s < 1e-6) return { axis: [0, 0, 1], angle: 0 };
  return { axis: [q[0] / s, q[1] / s, q[2] / s], angle: (2 * Math.acos(w)) / DEG };
}

/* ----------------------------------------------------------------- sampling
 * The source is 10 Hz; the screen is 60. Catmull-Rom keeps the interpolation
 * smooth without overshooting into a slide.
 */
function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}
function sample(arr, f) {
  const n = arr.length, i = Math.max(0, Math.min(n - 1, Math.floor(f))), t = f - i;
  const g = (k) => arr[Math.max(0, Math.min(n - 1, k))];
  return catmull(g(i - 1), g(i), g(i + 1), g(i + 2), t);
}

/* ------------------------------------------------------------------ mapping
 * The play declares its own coordinate space — 120 x 53.333 yards for the
 * gridiron, 105 x 68 metres for the pitch — and that space is mapped onto the
 * painted surface it belongs to. Mapping onto the texture rather than onto
 * regulation dimensions is what keeps players standing on the painted lines.
 */
function mapper(cfg, dims) {
  const th = (cfg.field.rotation || 0) * DEG, ct = Math.cos(th), st = Math.sin(th);
  const sA = cfg.play.flipAlong ? -1 : 1, sX = cfg.play.flipAcross ? -1 : 1;
  // Good to a few centimetres over a field-sized patch, which is all the
  // camera needs — the meshes themselves never leave the metric local frame.
  const mPerLat = 111320, mPerLon = 111320 * Math.cos(cfg.field.lat * DEG);
  return {
    toLonLat(e, n) {
      return [cfg.field.lon + e / mPerLon, cfg.field.lat + n / mPerLat];
    },
    /** play space -> [east, north] metres from the field centre */
    toEN(x, y) {
      const along = (x / dims.length - 0.5) * dims.depth * sA;
      const across = (y / dims.width - 0.5) * dims.acrossM * sX;
      return [across * ct - along * st, across * st + along * ct];
    },
    /**
     * Play heading -> rotation about up.
     *
     * Both feeds write `dir` as atan2(along, across) in degrees: zero points
     * across the field, and the angle turns toward the goal line. So the
     * along-field component is the sine and the across-field component the
     * cosine, not the other way round. Having them the wrong way round is a
     * reflection rather than a rotation, and it left every player facing
     * between 60 and 160 degrees off the way he was running.
     */
    heading(dir) {
      const a = dir * DEG;
      const along = Math.sin(a) * sA, across = Math.cos(a) * sX;
      const e = across * ct - along * st, n = across * st + along * ct;
      return Math.atan2(-e, n) / DEG;
    }
  };
}

/* ==========================================================================
 * Public entry point. `spec` carries the data URL and the height of the
 * playing surface, which the field module owns.
 */
export async function addPlay(view, cfg, spec) {
  const res = await fetch(spec.data);
  if (!res.ok) throw new Error(`play data ${res.status}`);
  const data = await res.json();

  const code = data.meta.sport === "football" ? "football" : "gridiron";
  const space = data.space ?? { length: 120, width: 53.333 };
  const surfaceKey = data.surface ?? "gridiron";
  const painted = cfg.field.surfaces[surfaceKey];
  // The marked area inside the painted one. A surface without an apron is its
  // own playing area, so this is the whole of it.
  const marked = painted.play ?? painted;
  const dims = {
    length: space.length, width: space.width,
    depth: marked.depth, acrossM: marked.width
  };

  const surface = spec.z;
  const origin = [cfg.field.lon, cfg.field.lat, surface];
  const sr = SpatialReference.WGS84;
  const map = mapper(cfg, dims);
  const HZ = data.meta.hz;
  const N = data.meta.frames;

  const layer = new GraphicsLayer({
    title: `Live action — ${surfaceKey}`,
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });

  // Generic kit. The passages of play are real; the uniforms are nobody's —
  // team marks and uniform designs are trademarks, the same reason neither
  // painted surface carries a club badge.
  // An even mix, spread widely enough to tell apart at the distance the field is
  // watched from - two tones a few shades apart just look like uneven lighting.
  const SKIN = [
    [236, 196, 168],
    [172, 118,  82],
    [ 88,  58,  44]
  ];

  const KIT = code === "football"
    ? {
        off: { jersey: [244, 244, 242], shorts: [244, 244, 242], head: [198, 152, 120], skin: [198, 152, 120], socks: [28, 40, 72] },
        def: { jersey: [251, 133, 20], shorts: [22, 26, 38], head: [178, 134, 104], skin: [178, 134, 104], socks: [22, 26, 38] }
      }
    : {
        off: { jersey: [251, 79, 20], shorts: [242, 240, 235], head: [12, 35, 64], skin: [198, 152, 120], socks: [242, 240, 235] },
        def: { jersey: [242, 240, 235], shorts: [30, 41, 59], head: [226, 226, 226], skin: [178, 134, 104], socks: [30, 41, 59] }
      };

  // Counted per side rather than across the whole list. Both files happen to be
  // written one team then the other, so a single running count would balance
  // them today - but that is a property of the build scripts, not something the
  // renderer should rely on. Counting each side separately gives every squad an
  // even spread whatever order the players arrive in.
  const seen = new Map();
  const nth = (side) => {
    const k = seen.get(side) ?? 0;
    seen.set(side, k + 1);
    return k;
  };

  const actors = data.players.map((p) => {
    // Skin is per player, not per team. It used to be one tone for each side,
    // which made it read as part of the strip - twenty-two people who all
    // happened to look alike. Cycling the palette rather than picking at random
    // keeps the mix even and keeps it identical on every load, so a screenshot
    // taken today matches one taken tomorrow.
    const tone = SKIN[nth(p.side) % SKIN.length];
    const base = KIT[p.side];
    // Bare heads take the tone; a helmet is the team's, and stays it.
    const kit = { ...base, skin: tone, head: code === "football" ? tone : base.head };
    const mesh = figure(kit, origin, sr, code);
    mesh.transform = new MeshTransform({
      translation: [0, 0, 0], rotationAxis: [0, 0, 1], rotationAngle: 0
    });
    layer.add(new Graphic({
      geometry: mesh,
      symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
    }));
    // Per source frame, once: where the player is in local metres, how fast,
    // which way they face and how quickly that is changing. poseAt then only
    // has to interpolate, instead of re-deriving all of it every render frame.
    const n = p.x.length;
    const pe = new Float32Array(n), pn = new Float32Array(n);
    const ph = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const en = map.toEN(p.x[i], p.y[i]);
      pe[i] = en[0]; pn[i] = en[1];
      ph[i] = map.heading(p.dir[i]);
    }
    const spd = new Float32Array(n), turn = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      const dt = (b - a) / HZ || 1;
      spd[i] = Math.hypot(pe[b] - pe[a], pn[b] - pn[a]) / dt;
      turn[i] = (((ph[b] - ph[a] + 540) % 360) - 180) / dt;
    }
    return {
      p, mesh, pe, pn, ph, spd, turn,
      seed: (p.x[0] * 7.13 + p.y[0] * 3.7) % 6.283
    };
  });

  const radius = data.ball.radius ?? 0.11;
  const ballMesh = ballMeshFor(code, radius, origin, sr);
  ballMesh.transform = new MeshTransform({
    translation: [0, 0, 0], rotationAxis: [0, 0, 1], rotationAngle: 0
  });
  layer.add(new Graphic({
    geometry: ballMesh,
    symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
  }));

  // Goals belong to the pitch, not to the play, but they only ever need to
  // exist while a pitch play is on screen — so they ride in the same layer.
  if (surfaceKey === "pitch") {
    addGoals(layer, {
      origin, sr,
      halfLength: marked.depth / 2,
      place: (along, across) => {
        const th = (cfg.field.rotation || 0) * DEG, ct = Math.cos(th), st = Math.sin(th);
        return [across * ct - along * st, across * st + along * ct];
      },
      heading: -(cfg.field.rotation || 0)
    });
  }

  view.map.add(layer);
  layer.visible = false;

  const DUR = (N - 1) / HZ;
  const listeners = new Set();
  let t = 0, running = false, raf = null, last = 0, ballEN = [0, 0, 0], spin = 0;
  const rate = cfg.play.speed || 1;
  const emit = () => listeners.forEach((fn) => fn({ t, dur: DUR, running }));

  /** Place every actor and the ball for a given time in seconds. */
  function poseAt(time) {
    const f = Math.max(0, Math.min(N - 1, time * HZ));
    const i = Math.min(N - 1, Math.floor(f));
    const j = Math.min(N - 1, i + 1);
    const u = f - i;

    for (const a of actors) {
      // Position keeps Catmull-Rom: at 10 Hz, straight lines between samples
      // show up as a visible kink every tenth of a second.
      const e = map.toEN(sample(a.p.x, f), sample(a.p.y, f));
      const spd = a.spd[i] + (a.spd[j] - a.spd[i]) * u;
      // Heading interpolates the short way round: the +540/%360/-180 dance maps
      // the difference into -180..180, or a player spins 350 degrees at 359->1.
      const head = a.ph[i] + ((((a.ph[j] - a.ph[i] + 540) % 360) - 180) * u);
      const turn = a.turn[i] + (a.turn[j] - a.turn[i]) * u;

      // Stride: a little over one cycle a second at a jog, rising with speed.
      // The bob is |sin| because both feet strike within one cycle, and the
      // seed keeps twenty-two players from marching in lockstep.
      const phase = time * (1.35 + spd * 0.22) * Math.PI * 2 + a.seed;
      const bob = Math.abs(Math.sin(phase)) * Math.min(0.075, 0.012 * spd);

      // Lean: forward with speed, and into the turn from the rate of change of
      // heading. Both capped, so a hard cut never tips anyone over.
      const pitch = Math.min(14, spd * 1.5);
      const roll = Math.max(-16, Math.min(16, -turn * 0.12 * Math.min(1, spd / 4)));

      const q = qmul(qmul(quatAxis(0, 0, 1, head), quatAxis(1, 0, 0, pitch)), quatAxis(0, 1, 0, roll));
      const aa = toAxisAngle(q);
      const tr = a.mesh.transform;
      tr.translation = [e[0], e[1], bob];
      tr.rotationAxis = aa.axis;
      tr.rotationAngle = aa.angle;
    }

    const b = map.toEN(sample(data.ball.x, f), sample(data.ball.y, f));
    const bz = sample(data.ball.z, f);
    const prev = ballEN;
    ballEN = [b[0], b[1], bz];
    const bt = ballMesh.transform;
    bt.translation = [b[0], b[1], bz];

    if (code === "football") {
      // A football rolls: it turns about the horizontal axis square to its
      // travel, through the distance covered divided by its radius.
      const dx = b[0] - prev[0], dy = b[1] - prev[1];
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) {
        spin = (spin + (dist / radius) / DEG) % 360;
        bt.rotationAxis = [dy / dist, -dx / dist, 0];
        bt.rotationAngle = spin;
      }
    } else {
      // A thrown ball spirals; a carried one just rides along.
      const thrown = f >= (data.events.pass_forward ?? Infinity)
                  && f <= (data.events.pass_arrived ?? -1);
      bt.rotationAxis = [0, 0, 1];
      bt.rotationAngle = thrown ? (time * 900) % 360 : 0;
    }
  }

  // Every transform written dirties the scene, and a dirty scene redraws
  // everything in it - including a Gaussian splat that is expensive to fill.
  // So the pose rate, not the arithmetic, is what costs: at 60 Hz the splat is
  // re-rendered sixty times a second for twenty-two figures a few pixels
  // across. 33 Hz is indistinguishable for this and halves the work. The
  // transport readout is slower still - it only ever shows tenths.
  const UI_MS = 100;
  const POSE_MIN = 30, POSE_MAX = 66;   // 33 Hz down to 15 Hz
  let poseMs = POSE_MIN, frameAvg = 16.7;
  let lastPose = 0, lastUi = 0;

  function tick(now) {
    if (!running) return;
    const dtMs = last ? now - last : 16.7;
    const dt = last ? dtMs / 1000 : 0;
    last = now;
    t += dt * rate;

    // Back off on a machine that cannot keep up. If frames are taking much
    // longer than 60 Hz allows, posing less often is what helps - the cost is
    // not the arithmetic but that a rewritten transform forces the whole scene,
    // splat included, to be drawn again. Smoothed, so one slow frame does not
    // swing it.
    frameAvg += (Math.min(dtMs, 200) - frameAvg) * 0.1;
    poseMs = frameAvg > 26 ? Math.min(POSE_MAX, poseMs + 2)
                           : Math.max(POSE_MIN, poseMs - 1);

    if (t >= DUR) { t = DUR; poseAt(t); running = false; raf = null; emit(); return; }
    if (now - lastPose >= poseMs) { lastPose = now; poseAt(t); }
    if (now - lastUi >= UI_MS) { lastUi = now; emit(); }
    raf = requestAnimationFrame(tick);
  }

  const api = {
    layer,
    data,
    surface: surfaceKey,
    duration: DUR,
    get time() { return t; },
    get running() { return running; },
    /** Smoothed frame interval and the pose rate it has settled on. */
    get health() { return { frameMs: frameAvg, poseMs, poseHz: 1000 / poseMs }; },
    onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Ball position as [east, north, up] metres from the field centre. */
    ballEN() { return ballEN; },
    /** Height of the playing surface, so a camera can work in absolute z. */
    surfaceZ: surface,
    toLonLat: map.toLonLat,
    /** Unit vector across the field, for placing a broadcast camera. */
    acrossAxis() {
      const a = map.toEN(space.length / 2, 0), c = map.toEN(space.length / 2, space.width);
      const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy) || 1;
      return [dx / L, dy / L];
    },
    halfWidth: marked.width / 2,
    depth: marked.depth,
    show(on) { layer.visible = !!on; if (on) poseAt(t); },
    seek(time) { t = Math.max(0, Math.min(DUR, time)); poseAt(t); emit(); },
    start() {
      if (running) return;
      if (t >= DUR) t = 0;
      layer.visible = true;
      running = true;
      last = 0;
      raf = requestAnimationFrame(tick);
      emit();
    },
    pause() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      emit();
    },
    stop() { api.pause(); t = 0; poseAt(0); emit(); },
    remove() { api.pause(); view.map.remove(layer); }
  };

  poseAt(0);
  console.info(`[Play] ${surfaceKey}: ${data.players.length} players, ${N} frames `
    + `(${DUR.toFixed(1)} s), ${data.meta.measured ? "tracked" : "reconstructed"}`);
  return api;
}
