/**
 * Jumbotron overlay.
 *
 * The Gaussian splat reconstructs the south video board badly: it is a large,
 * dark, textureless, self-lit surface, which is close to the worst case for
 * photogrammetry, so the solver pushed the geometry ~5 m behind the bezel and
 * smeared it. Measuring the splat directly (see README) the failed region is a
 * 24.9 x 12.0 m recess in an otherwise clean, near-vertical frame plane.
 *
 * So: cover it with a lit quad sitting just in front of the recess, on the
 * measured plane. Everything here is driven by CONFIG.jumbotron in app.js.
 */

import Mesh from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Mesh.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";
import Graphic from "https://js.arcgis.com/5.0/@arcgis/core/Graphic.js";
import GraphicsLayer from "https://js.arcgis.com/5.0/@arcgis/core/layers/GraphicsLayer.js";
import MeshTexture from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshTexture.js";
import MeshMaterialMetallicRoughness from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshMaterialMetallicRoughness.js";
import MeshSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/MeshSymbol3D.js";
import FillSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/FillSymbol3DLayer.js";

/** Load an image CORS-clean, so the canvas stays untainted for WebGL upload. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/**
 * Paint the board face: flat black with the mark centred on it.
 * Deliberately plain — the point is that the logo stays legible from any angle
 * and at any sun position, so there is no gradient, grid or bloom to compete
 * with it. Drawn at the panel's real aspect so the logo is never stretched.
 */
function paintBoard(logo, aspect) {
  const W = 2048;
  const H = Math.round(W / aspect);
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const g = cv.getContext("2d");

  g.fillStyle = "#000000";
  g.fillRect(0, 0, W, H);

  // the mark, centred, aspect preserved
  const lw = W * 0.66;
  const lh = lw * (logo.height / logo.width);
  g.drawImage(logo, (W - lw) / 2, (H - lh) / 2, lw, lh);

  return cv;
}

const M_PER_DEG_LAT = 111320;

/**
 * Decide which vertical datum the scene reads `Point.z` in.
 *
 * The splat tileset's tile transforms are ECEF, so measuring off it yields an
 * ellipsoidal height. The scene's own layers declare gravity-related heights
 * (the integrated mesh is EGM96, vcsWkid 5773) and the geoid separation here is
 * about -17.8 m — so picking the wrong one puts the panel 17.8 m off, which is
 * enough to bury it inside the stands.
 *
 * Rather than assume, ask the ground how high it is at this exact spot and see
 * which of the two known ground values it matches. The two candidates are ~18 m
 * apart, so the test is not close.
 */
async function resolveZ(view, cfg) {
  const probe = new Point({
    longitude: cfg.lon, latitude: cfg.lat,
    spatialReference: { wkid: 4326 }
  });
  try {
    const { geometry } = await view.map.ground.queryElevation(probe);
    const ground = geometry?.z;
    if (typeof ground !== "number" || !isFinite(ground)) throw new Error("no elevation");
    const dGravity = Math.abs(ground - cfg.groundEgm96);
    const dEllips = Math.abs(ground - cfg.groundEllipsoidal);
    const gravity = dGravity <= dEllips;
    console.info(
      `[venue] ground reads ${ground.toFixed(2)} m; ` +
      `EGM96 ground is ${cfg.groundEgm96.toFixed(2)}, ellipsoidal is ${cfg.groundEllipsoidal.toFixed(2)} ` +
      `-> using ${gravity ? "gravity-related" : "ellipsoidal"} z`
    );
    return gravity ? cfg.z : cfg.zEllipsoidal;
  } catch (err) {
    // No elevation surface, or the query failed. The scene's layers all declare
    // gravity-related heights, so that is the better default.
    console.warn("[venue] elevation probe failed, assuming gravity-related z:", err.message);
    return cfg.z;
  }
}

/**
 * Add the panel to the view.
 * Returns a handle with `layer`, `update(patch)` and `config()`.
 */
export async function addJumbotron(view, cfg) {
  const [logo, z] = await Promise.all([loadImage(cfg.logo), resolveZ(view, cfg)]);

  // `lat`/`lon` are the panel flush with the board face. `standoff` lifts it off
  // along the outward normal: flush lets the splat's gaussians bleed through,
  // but too far out and it visibly floats. The normal's heading is the negative
  // of the plane's rotation, since rotation is measured off due north.
  const hdg = -cfg.rotation * Math.PI / 180;
  const off = cfg.standoff ?? 0;
  const lat = cfg.lat + (Math.cos(hdg) * off) / M_PER_DEG_LAT;
  const lon = cfg.lon +
    (Math.sin(hdg) * off) / (M_PER_DEG_LAT * Math.cos(cfg.lat * Math.PI / 180));

  const state = {
    lat, lon, z,
    width: cfg.width, height: cfg.height, rotation: cfg.rotation
  };

  const canvas = paintBoard(logo, state.width / state.height);
  const texture = new MeshTexture({ data: canvas });
  const material = new MeshMaterialMetallicRoughness({
    colorTexture: texture,
    // Emissive as well as albedo, so the mark stays readable whatever the sun
    // is doing — the board faces north and spends most of the day in shadow.
    emissiveTexture: texture,
    emissiveColor: [255, 255, 255],
    emissiveStrength: 1,
    metallic: 0,
    roughness: 1,
    // Single-sided, so the panel is culled when viewed from behind the board
    // rather than hanging in the air over the car park.
    doubleSided: false
  });

  const layer = new GraphicsLayer({
    title: "Jumbotron",
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });
  const graphic = new Graphic({
    symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
  });
  layer.add(graphic);
  view.map.add(layer);

  function build() {
    const centre = new Point({
      longitude: state.lon, latitude: state.lat, z: state.z,
      spatialReference: { wkid: 4326 }
    });
    const mesh = Mesh.createPlane(centre, {
      facing: "north",
      size: { width: state.width, height: state.height },
      material
    });
    // Right-hand rule about local up: +angle swings the north-facing normal
    // toward the west, which is what the measured 357.7 deg heading needs.
    if (state.rotation) mesh.rotate(0, 0, state.rotation);
    graphic.geometry = mesh;
  }
  build();

  return {
    layer,
    config: () => ({ ...state }),
    /** Patch any of lat/lon/z/width/height/rotation, or nudge in metres. */
    update(patch = {}) {
      const { north = 0, east = 0, ...direct } = patch;
      Object.assign(state, direct);
      if (north) state.lat += north / M_PER_DEG_LAT;
      if (east) {
        state.lon += east / (M_PER_DEG_LAT * Math.cos(state.lat * Math.PI / 180));
      }
      build();
      return { ...state };
    }
  };
}

/**
 * Dev-only placement helper, enabled with ?tune=1.
 *
 * The panel's height is an ellipsoidal height derived from the tileset's own
 * ECEF tile transforms. If the scene turns out to want orthometric heights the
 * whole thing sits ~17.8 m out at this site, so this exists to fix it in
 * seconds rather than another measure-and-rebuild cycle.
 */
export function attachTuner(jumbo) {
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:60;" +
    "font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre;" +
    "background:rgba(8,11,16,.92);color:#f4f1ea;padding:10px 14px;border-radius:10px;" +
    "border:1px solid rgba(244,241,234,.18);box-shadow:0 10px 30px rgba(0,0,0,.6)";
  document.body.appendChild(box);

  const KEYS = {
    i: { z: +0.25 },  k: { z: -0.25 },
    j: { rotation: -0.25 }, l: { rotation: +0.25 },
    w: { north: +0.25 }, s: { north: -0.25 },
    a: { east: -0.25 },  d: { east: +0.25 },
    "[": { width: -0.5 }, "]": { width: +0.5 },
    "-": { height: -0.25 }, "=": { height: +0.25 }
  };
  const RELATIVE = new Set(["z", "rotation", "width", "height"]);

  function paint(s) {
    box.textContent =
      `jumbotron  lat ${s.lat.toFixed(8)}  lon ${s.lon.toFixed(8)}  z ${s.z.toFixed(2)}\n` +
      `           ${s.width.toFixed(1)} x ${s.height.toFixed(1)} m   rot ${s.rotation.toFixed(2)}\n` +
      `i/k z · j/l rot · w/a/s/d move · [/] width · -/= height · p print`;
  }
  paint(jumbo.config());

  window.addEventListener("keydown", (e) => {
    if (e.key === "p") { console.log("jumbotron:", jumbo.config()); return; }
    const d = KEYS[e.key];
    if (!d) return;
    e.preventDefault();
    const cur = jumbo.config();
    const patch = {};
    for (const [k, v] of Object.entries(d)) {
      patch[k] = RELATIVE.has(k) ? cur[k] + v : v;
    }
    paint(jumbo.update(patch));
  });
}
