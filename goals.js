/**
 * The goal structures for each playing surface: a pair of nets for the pitch,
 * and a pair of gooseneck uprights for the gridiron.
 *
 * Regulation: 7.32 m between the posts, 2.44 m to the underside of the bar,
 * posts no more than 12 cm square. The net is a translucent double-sided panel
 * rather than modelled mesh — at any distance this scene is viewed from, a
 * woven net reads as a flat grey haze anyway, and a few hundred thousand
 * triangles of string would not survive the frame budget.
 */

import Graphic from "https://js.arcgis.com/5.0/@arcgis/core/Graphic.js";
import MeshSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/MeshSymbol3D.js";
import FillSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/FillSymbol3DLayer.js";
import MeshTransform from "https://js.arcgis.com/5.0/@arcgis/core/geometry/support/MeshTransform.js";
import { Builder, box, quad, finish } from "./meshkit.js";

const W = 7.32;          // inside of post to inside of post
const H = 2.44;          // ground to the underside of the crossbar
const P = 0.12;          // post and crossbar section
const DEPTH_TOP = 1.0;   // how far the net is slung back at the bar
const DEPTH_LOW = 2.2;   // and at the ground

const FRAME = [244, 244, 241];
// The net carries the goal visually. Regulation posts are 12 cm, which at the
// distance the pitch is viewed from is barely more than a pixel, so it is the
// net panel that has to read - hence enough opacity to show as a soft white box
// from the stand, while still being seen through from behind.
const NET = { color: [232, 236, 240], alpha: 0.34, doubleSided: true };

/**
 * One goal, built facing +y — that is, standing on the goal line with the net
 * behind it in +y. Origin at the centre of the goal line.
 */
function goalMesh(origin, sr) {
  const b = Builder(2);                       // 0 frame, 1 net
  const hw = W / 2;

  box(b, 0, -hw - P / 2, 0, 0, P, P, H + P);  // left post
  box(b, 0,  hw + P / 2, 0, 0, P, P, H + P);  // right post
  box(b, 0, 0, 0, H, W + 2 * P, P, P);        // crossbar

  // Net: back panel, two sides, and a roof, slung back and down.
  const fTL = [-hw, 0, H], fTR = [hw, 0, H];
  const bTL = [-hw, DEPTH_TOP, H], bTR = [hw, DEPTH_TOP, H];
  const bBL = [-hw, DEPTH_LOW, 0], bBR = [hw, DEPTH_LOW, 0];
  const fBL = [-hw, 0, 0], fBR = [hw, 0, 0];

  quad(b, 1, bTL, bTR, bBR, bBL);             // back
  quad(b, 1, fTL, bTL, bTR, fTR);             // roof
  quad(b, 1, fTL, fBL, bBL, bTL);             // left side
  quad(b, 1, fTR, bTR, bBR, fBR);             // right side

  return finish(b, [FRAME, NET], origin, sr);
}

/**
 * Place both goals on the goal lines of a pitch.
 * `place(alongMetres, acrossMetres)` maps pitch-local metres to [east, north],
 * matching however the surface is rotated.
 */
export function addGoals(layer, { origin, sr, halfLength, place, heading }) {
  const out = [];
  for (const end of [1, -1]) {
    const mesh = goalMesh(origin, sr);
    const en = place(end * halfLength, 0);
    // Each goal faces in towards the middle, so the nets point outwards.
    mesh.transform = new MeshTransform({
      translation: [en[0], en[1], 0],
      rotationAxis: [0, 0, 1],
      rotationAngle: heading + (end > 0 ? 0 : 180)
    });
    const g = new Graphic({
      geometry: mesh,
      symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
    });
    layer.add(g);
    out.push(g);
  }
  return out;
}


/* ------------------------------------------------------------- gridiron
 * Regulation NFL uprights, which are not where people remember them: they
 * stand on the END line, at the back of the end zone, not on the goal line.
 * The crossbar is 10 ft up and 18 ft 6 in wide inside to inside, the uprights
 * carry on 35 ft above it, and the whole thing is held up from behind by a
 * single gooseneck so nothing is in the way of a play crossing the line.
 */
const BAR_Z = 3.048;        // top of the crossbar, 10 ft
const SPAN = 5.6388;        // inside to inside, 18 ft 6 in
const TIP = 13.716;         // top of the uprights, 45 ft
const SECT = 0.115;         // post section
const GOOSE = 1.0;          // how far behind the end line the base stands
const YELLOW = [242, 200, 32];

/** One set, built with the crossbar on y = 0 and the base behind it in +y. */
function uprightMesh(origin, sr) {
  const b = Builder(1);
  const half = SPAN / 2 + SECT / 2;           // upright centres

  box(b, 0, 0, GOOSE, 0, SECT, SECT, BAR_Z - SECT);          // base post
  box(b, 0, 0, GOOSE / 2, BAR_Z - SECT, SECT, GOOSE + SECT, SECT);  // gooseneck arm
  box(b, 0, 0, 0, BAR_Z - SECT, SPAN + 2 * SECT, SECT, SECT);       // crossbar
  box(b, 0, -half, 0, BAR_Z - SECT, SECT, SECT, TIP - BAR_Z);       // uprights
  box(b, 0,  half, 0, BAR_Z - SECT, SECT, SECT, TIP - BAR_Z);

  return finish(b, [YELLOW], origin, sr);
}

/**
 * Stand a set on each end line. `place` and `heading` match addGoals: the same
 * local-metres-to-east-north mapping the painted surface was laid down with.
 */
export function addUprights(layer, { origin, sr, halfLength, place, heading }) {
  const out = [];
  for (const end of [1, -1]) {
    const mesh = uprightMesh(origin, sr);
    const en = place(end * halfLength, 0);
    // Each set is turned to face in, so its gooseneck leans away from the field.
    mesh.transform = new MeshTransform({
      translation: [en[0], en[1], 0],
      rotationAxis: [0, 0, 1],
      rotationAngle: heading + (end > 0 ? 0 : 180)
    });
    const g = new Graphic({
      geometry: mesh,
      symbol: new MeshSymbol3D({ symbolLayers: [new FillSymbol3DLayer()] })
    });
    layer.add(g);
    out.push(g);
  }
  return out;
}
