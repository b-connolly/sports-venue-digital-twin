/**
 * The painted playing surface — and there is more than one of them.
 *
 * The field was covered when the site was captured, so both the splat and the
 * drone mesh render it as a flat grey slab. Measuring the splat, that slab is
 * 130 x 76.6 m with its long axis at heading 0.59 deg — essentially
 * north-south. That comfortably contains a gridiron field (109.73 x 48.77 m
 * including end zones) and, as it happens, a full-size association football
 * pitch (105 x 68 m) as well, which is what lets the same slab carry both.
 *
 * So: lay a textured, up-facing quad on it, proud enough to win the depth test
 * without floating. Each surface is its own layer, and switching between them
 * is a cross-fade of layer opacity — cheap, and reactive in a way that mutating
 * a material mid-flight is not.
 *
 * Markings are painted into the texture rather than modelled: flat paint reads
 * correctly from every angle and costs nothing to render. Neither texture
 * carries a club badge, a sponsor or a competition mark — those are trademarks,
 * and deliberately not reproduced. See tools/make_field.py and make_pitch.py.
 */

import Mesh from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Mesh.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";
import Graphic from "https://js.arcgis.com/5.0/@arcgis/core/Graphic.js";
import GraphicsLayer from "https://js.arcgis.com/5.0/@arcgis/core/layers/GraphicsLayer.js";
import { addUprights } from "./goals.js";
import MeshTexture from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshTexture.js";
import MeshMaterialMetallicRoughness from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshMaterialMetallicRoughness.js";
import MeshSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/MeshSymbol3D.js";
import FillSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/FillSymbol3DLayer.js";

const DEG = Math.PI / 180;

/** Sit a set of goal structures on top of the turf, wherever the turf is. */
function raise(graphics, lift) {
  for (const g of graphics ?? []) {
    const t = g.geometry.transform;
    // A new array, not an element write: the transform only notices a whole
    // reassignment, which is how the replay moves its players every frame.
    t.translation = [t.translation[0], t.translation[1], lift];
  }
}

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
 * Which vertical datum the scene reads Point.z in. The splat's transforms are
 * ECEF, so measuring off it gives an ellipsoidal height, while the scene's
 * layers declare gravity-related heights (the mesh is EGM96). Those differ by
 * about 17.8 m here, so ask the ground which frame it is in.
 */
async function resolveZ(view, cfg) {
  const probe = new Point({
    longitude: cfg.lon, latitude: cfg.lat, spatialReference: { wkid: 4326 }
  });
  try {
    const { geometry } = await view.map.ground.queryElevation(probe);
    const ground = geometry?.z;
    if (typeof ground !== "number" || !isFinite(ground)) throw new Error("no elevation");
    const gravity = Math.abs(ground - cfg.groundEgm96) <= Math.abs(ground - cfg.groundEllipsoidal);
    console.info(`[Field] ground reads ${ground.toFixed(2)} m -> ` +
      `${gravity ? "gravity-related" : "ellipsoidal"} z`);
    return gravity ? cfg.z : cfg.zEllipsoidal;
  } catch (err) {
    console.warn("[Field] elevation probe failed, assuming gravity-related:", err.message);
    return cfg.z;
  }
}

function plane(cfg, surface, z, material) {
  const centre = new Point({
    longitude: cfg.lon, latitude: cfg.lat, z, spatialReference: { wkid: 4326 }
  });
  // createPlane always reads size.width and size.HEIGHT, then maps them per
  // facing — for "up" it returns { width, depth: height }. Passing { width,
  // depth } leaves height undefined, which defaults to 1 m and produces a
  // sliver. So the long axis must be given as `height`.
  const mesh = Mesh.createPlane(centre, {
    facing: "up",
    size: { width: surface.width, height: surface.depth },
    material
  });
  // Right-hand rule about local up. The measured long axis is 0.59 deg east of
  // north, so the plane turns the other way to meet it.
  if (cfg.rotation) mesh.rotate(0, 0, cfg.rotation);
  return mesh;
}

/**
 * Lay every painted surface into the scene, with one of them showing.
 * Returns a handle with `use()`, `dims()`, `setLift()` and `remove()`.
 */
export async function addSurfaces(view, cfg) {
  const keys = Object.keys(cfg.surfaces);
  const [baseZ, ...images] = await Promise.all([
    resolveZ(view, cfg),
    ...keys.map((k) => loadImage(cfg.surfaces[k].texture))
  ]);

  let lift = cfg.lift ?? 0;
  const made = {};

  keys.forEach((key, i) => {
    const surface = cfg.surfaces[key];
    const material = new MeshMaterialMetallicRoughness({
      colorTexture: new MeshTexture({ data: images[i] }),
      // Turf is not a light source, so no emissive: it should darken with the
      // scene at dusk and pick up the stadium lights, not glow on its own.
      metallic: 0,
      roughness: 1,
      doubleSided: false
    });
    const layer = new GraphicsLayer({
      title: `Playing surface — ${key}`,
      listMode: "hide",
      elevationInfo: { mode: "absolute-height" },
      visible: false,
      opacity: 0
    });
    const graphic = new Graphic({
      geometry: plane(cfg, surface, baseZ + lift, material),
      symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
    });
    layer.add(graphic);

    // The uprights belong to the gridiron the way the nets belong to the pitch,
    // so they ride in the surface's own layer: they cross-fade in and out with
    // the paint rather than appearing only while a replay is open.
    let posts = null;
    if (key === "gridiron") {
      const th = (cfg.rotation || 0) * DEG, ct = Math.cos(th), st = Math.sin(th);
      // Built at the bare ground height, with the lift carried in the transform
      // instead of baked into the vertex origin - that way setLift can raise
      // them with the turf rather than leaving them planted underneath it.
      posts = addUprights(layer, {
        origin: [cfg.lon, cfg.lat, baseZ],
        sr: { wkid: 4326 },
        // Where the posts stand is the end of the *marked* area, not the end
        // of the painted one - a surface with an apron of grass around it is
        // wider than the pitch it carries.
        halfLength: (surface.play ?? surface).depth / 2,
        place: (along, across) => [across * ct - along * st, across * st + along * ct],
        heading: -(cfg.rotation || 0)
      });
      raise(posts, lift);
    }

    view.map.add(layer);
    made[key] = { layer, graphic, material, surface, posts };
  });

  let current = null;
  let fade = null;

  /** Cross-fade to a surface. Returns when it has finished. */
  function use(key, ms = 700) {
    if (!made[key] || current === key) return Promise.resolve();
    const from = current ? made[current] : null;
    const to = made[key];
    current = key;
    to.layer.visible = true;
    if (fade) cancelAnimationFrame(fade);

    return new Promise((resolve) => {
      const t0 = performance.now();
      const step = (now) => {
        const u = ms <= 0 ? 1 : Math.min(1, (now - t0) / ms);
        const e = u * u * (3 - 2 * u);
        to.layer.opacity = e;
        if (from) from.layer.opacity = 1 - e;
        if (u < 1) { fade = requestAnimationFrame(step); return; }
        if (from) { from.layer.visible = false; from.layer.opacity = 0; }
        fade = null;
        resolve();
      };
      fade = requestAnimationFrame(step);
    });
  }

  const api = {
    layers: made,
    /** Which surface is showing. */
    get current() { return current; },
    /** Real size of a surface, in metres. */
    dims(key) { return cfg.surfaces[key ?? current]; },
    /** Height of the playing surface in the scene's vertical datum. */
    get z() { return baseZ + lift; },
    use,
    /** Set the lift in metres above the measured slab. Returns the new z. */
    setLift(metres) {
      lift = metres;
      for (const key of keys) {
        made[key].graphic.geometry = plane(cfg, made[key].surface, baseZ + lift, made[key].material);
        raise(made[key].posts, lift);
      }
      return baseZ + lift;
    },
    remove() { keys.forEach((k) => view.map.remove(made[k].layer)); }
  };

  await use(cfg.default ?? keys[0], 0);
  const d = api.dims();
  console.info(`[Field] ${keys.length} surfaces at z ${(baseZ + lift).toFixed(2)}`
    + ` (slab ${baseZ.toFixed(2)} + lift ${lift.toFixed(2)});`
    + ` showing ${current} ${d.width} x ${d.depth} m`);
  return api;
}
