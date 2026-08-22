/**
 * A very small mesh builder, shared by everything in the scene that is drawn
 * from primitives rather than loaded: the players, the ball, the goals.
 *
 * Faces are grouped by material index, so one finished mesh is a single vertex
 * buffer carrying several MeshComponents — jersey, trousers, helmet, skin, or
 * post and net — rather than several meshes that have to be kept in step.
 *
 * Everything is built in a local metric frame: +x right, +y forward, +z up,
 * with the origin on the ground. A MeshLocalVertexSpace then pins that frame to
 * a point on the globe, and a MeshTransform moves it about, so no geodetic
 * maths happens per frame.
 */

import Mesh from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Mesh.js";
import MeshLocalVertexSpace from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshLocalVertexSpace.js";
import MeshComponent from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshComponent.js";
import MeshMaterial from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshMaterial.js";

export const DEG = Math.PI / 180;

export function Builder(groups) {
  return { pos: [], nrm: [], groups: Array.from({ length: groups }, () => []), n: 0 };
}

/** One quad, wound counter-clockwise seen from outside. */
export function quad(b, g, a, c, d, e) {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
  const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const L = Math.hypot(nx, ny, nz) || 1;
  nx /= L; ny /= L; nz /= L;
  const i = b.n;
  for (const p of [a, c, d, e]) { b.pos.push(p[0], p[1], p[2]); b.nrm.push(nx, ny, nz); }
  b.n += 4;
  b.groups[g].push(i, i + 1, i + 2, i, i + 2, i + 3);
}

/**
 * A limb or a bar. The box hangs from a pivot, extending `len` downward, and
 * swings about that pivot: pitch forward (+y), then roll outward (+x). That is
 * what lets an arm rotate about the shoulder rather than about its own middle.
 */
export function block(b, g, px, py, pz, len, w, d, pitch = 0, roll = 0) {
  const hw = w / 2, hd = d / 2;
  const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
  const cr = Math.cos(roll * DEG), sr = Math.sin(roll * DEG);
  const put = (x, y, z) => {
    const y1 = y * cp - z * sp;
    let z1 = y * sp + z * cp;
    const x1 = x * cr - z1 * sr;
    z1 = x * sr + z1 * cr;
    return [px + x1, py + y1, pz + z1];
  };
  const p = [];
  for (const z of [-len, 0]) {
    for (const c of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) p.push(put(c[0], c[1], z));
  }
  quad(b, g, p[0], p[3], p[2], p[1]);                       // bottom  -z
  quad(b, g, p[4], p[5], p[6], p[7]);                       // top     +z
  quad(b, g, p[0], p[1], p[5], p[4]);                       // front   -y
  quad(b, g, p[1], p[2], p[6], p[5]);                       // right   +x
  quad(b, g, p[2], p[3], p[7], p[6]);                       // back    +y
  quad(b, g, p[3], p[0], p[4], p[7]);                       // left    -x
}

/**
 * An axis-aligned box standing ON `cz` rather than centred on it — (cx, cy, cz)
 * is the middle of its base. Everything built with this sits on the ground or
 * on top of something else, which is the common case; centring would bury half
 * of it.
 */
export function box(b, g, cx, cy, cz, sx, sy, sz) {
  block(b, g, cx, cy, cz + sz, sz, sx, sy);
}

/** Low-resolution spheroid: a helmet, a head, or — stretched — a ball. */
export function spheroid(b, g, cx, cy, cz, rx, ry, rz, seg = 10, ring = 6) {
  const at = (i, j) => {
    const th = (j / ring) * Math.PI, ph = (i / seg) * 2 * Math.PI;
    return [cx + rx * Math.sin(th) * Math.cos(ph),
            cy + ry * Math.sin(th) * Math.sin(ph),
            cz + rz * Math.cos(th)];
  };
  for (let j = 0; j < ring; j++) {
    for (let i = 0; i < seg; i++) quad(b, g, at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
  }
}

/**
 * Close the builder into a Mesh. `materials` is one entry per face group; an
 * entry may be a colour array, or `{ color, alpha }` for anything that needs to
 * be seen through — a net, most obviously.
 */
export function finish(b, materials, origin, sr) {
  return new Mesh({
    vertexSpace: new MeshLocalVertexSpace({ origin }),
    spatialReference: sr,
    vertexAttributes: {
      position: new Float64Array(b.pos),
      normal: new Float32Array(b.nrm)
    },
    components: b.groups.map((faces, i) => {
      const m = materials[i];
      const spec = Array.isArray(m) ? { color: m } : m;
      return new MeshComponent({
        faces: new Uint32Array(faces),
        material: new MeshMaterial({
          color: spec.alpha != null ? [...spec.color, spec.alpha] : spec.color,
          alphaMode: spec.alpha != null ? "blend" : "opaque",
          doubleSided: !!spec.doubleSided
        })
      });
    }).filter((c) => c.faces.length)
  });
}
