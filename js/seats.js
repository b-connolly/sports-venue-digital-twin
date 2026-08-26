/**
 * Where a seating section is, and what it sees.
 *
 * The stadium has no seating layer - the scene carries the reality captures and
 * a lights layer and nothing else - so a section's position is *modelled*, not
 * surveyed. That distinction matters here as much as it does in the play data:
 * these are plausible vantages, close enough that "the view from 132" looks
 * like the view from 132, and they are not seat coordinates.
 *
 * ## Bearings are measured, not derived
 *
 * Which way round the bowl a section sits is read off the published seating
 * chart, one number a section, in the table below. That is worth the 135
 * literals: every attempt to derive them instead was wrong, and wrong in a way
 * nothing in the app could show.
 *
 * The chart is a plan with a compass on it. Each section is a solid block with
 * white gaps around it, so labelling connected components finds all 135
 * without reading a single digit, and normalising radius for the bowl being an
 * ellipse splits them into decks - the sorted radii break after exactly 36
 * blocks, then 56, then 43, which is the lower bowl, the 300s sharing a band
 * with the 200 club, and the 500s. Numbers are then assigned by walking each
 * ring from one anchor read off the picture by eye: one bearing to get right
 * instead of 135. tools/digitise_chart.py does it and can be re-run.
 *
 * Three independent checks fall out rather than being imposed. 105 lands at
 * 269.9 degrees, 123 at 90.2 and 132 at 180.0 - due west, due east and due
 * south, level with the 50 yard line and the middle of the south stand - and
 * only 114 was anchored, so the other three had every opportunity to disagree.
 *
 * ## Why the arithmetic had to go
 *
 * Sections are not evenly spaced. The lower bowl steps by as little as 7.3
 * degrees and as much as 13.2, because a section is a roughly constant *width*
 * and the bowl is an ellipse, so the same width subtends a bigger angle where
 * the ring passes close to the middle. Assuming even spacing puts a section up
 * to 7.7 degrees out - most of the 9.9 degrees a section occupies - and the
 * error is worst at the corners, which is exactly where nobody thinks to check.
 *
 * Two rounds of guessing came before this. Both produced a bowl in which every
 * section sat in a plausible seat, facing the field, at a sensible height, and
 * both were wrong: a whole-model rotation of 40 degrees that survived a check
 * at the quarter points because it was anchored there. That failure mode is the
 * argument for measuring.
 *
 * ## What is still modelled
 *
 * How far out each ring sits, how high, and the set-back from the touchline:
 * `a`, `b` and `up` below, tuned by standing in them and looking. Those are
 * deliberately not taken from the chart. A seating chart shrinks the field
 * relative to the bowl to make room for its labels - this one draws the 100
 * ring about right but pushes the 500s half as far out again - so its radii are
 * schematic even though its angles are not.
 */
import Camera from "https://js.arcgis.com/5.0/@arcgis/core/Camera.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";

const DEG = Math.PI / 180;

/**
 * How wide a seat sees, in degrees.
 *
 * The default camera is 55, which is a lens rather than a person: comfortable
 * for a map and far too narrow for a stand. Somebody sitting in row 20 takes in
 * most of the field without moving their head, and the camera has to be given
 * the same latitude or it ends up turning constantly to keep up with a ball
 * that a real spectator would simply be watching.
 *
 * 75 is the useful part of human vision - not the full 180-odd degrees, which
 * includes everything you can detect but not read. Widening it is what lets the
 * follow turn less; the two settings only make sense together.
 */
const SEAT_FOV = 75;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/**
 * The rings, as the seating map numbers them.
 *
 * `first` is the lowest section number, `at` the bearing it sits on, and
 * `count` how many there are. `span` is how far round they go: 360 for a ring
 * that closes, less for one that does not. `a` and `b` are the ellipse's
 * half-axes - along the field and across it - and `up` is the eye height above
 * the playing surface.
 *
 * Not every ring closes, and that is the shape of this particular ground. The
 * lower bowl goes all the way round. The 300 and 500 rings do not: both run 280
 * degrees and stop short at the south-east, and the 80 degrees they leave is
 * exactly where the 200 club sits. That is why there are only nine 200s and why
 * they are all on one side - and the two arcs tiling the turn between them,
 * 280 and 80, is the reassurance that the numbers are the ground rather than
 * three rings that happen to fit the spokes checked.
 *
 * The distances and heights below were each found by standing in them. The
 * bearings are arithmetic from the numbering, anchored on one fact per ring:
 * where its first section sits.
 *
 * The lower bowl is anchored on a compass. Section 100 is due south, which is
 * printed on the seating chart rather than inferred.
 *
 * The upper rings are anchored on the lower bowl instead, because sections in
 * the same spoke line up radially and a radial alignment survives the
 * distortion a chart drawn in perspective puts on everything else. Where a
 * section *appears* on such a chart cannot be read as a bearing; which section
 * it sits behind can. Six spokes - 114/323/521, 105/308, 110/316, 118/330,
 * 100/500, 131/231, 133/233 - agree to within a degree and a half, and they
 * were each solved separately, so the agreement is a check and not a
 * restatement.
 *
 * That is also how the rings turned out to run 280 degrees rather than the 320
 * first assumed, and how the 200 club turned out to be 10 degrees a section
 * like the bowl below it rather than a squeezed 5. The two errors hid each
 * other: a ring too wide by 40 degrees, started 20 degrees early, puts its
 * middle in the right place and both its ends in the wrong one.
 */
export const RINGS = [
  // Tuned by standing in them, and the two axes were tuned against each other
  // rather than separately. The ends want height - the deck rises as it goes
  // back, and a seat 88 m out is under the stand below about 15 m - while the
  // sideline wants to be closer, because at 70 m out the upper deck is directly
  // overhead and 15 m puts the camera into its underside.
  //
  // 88 by 60 is where both work at one height, and it is not a coincidence:
  // it leaves 33 m behind the end line and 36 m behind the sideline, which is
  // the roughly constant set-back a real bowl is built with. An ellipse whose
  // axes are picked independently does not have that property, and the first
  // attempt - 100 by 70 - was 45 m back at the sides and 33 at the ends, which
  // is why one end of the ring could be made to work and the other could not.
  //
  // The only ring that closes. 114 sits on the north end, 132 on the south,
  // 105 and 123 level with the 50 on either touchline.
  {
    name: "100", first: 100, closed: true, a: 88, b: 60, up: 15,
    at: [
      217.5, 227.4, 234.8, 245.3, 256.8, 269.9, 283.0, 294.6,
      305.1, 312.5, 322.4, 334.8, 343.5, 351.2,   0.1,   9.0,
       16.7,  25.4,  37.9,  47.7,  55.2,  65.5,  77.1,  90.2,
      103.4, 114.8, 125.2, 132.5, 142.3, 154.9, 163.6, 171.1,
      180.0, 188.7, 196.5, 205.3
    ]
  },

  // The club, filling the arc the two rings above it leave open at the south.
  // Nine sections across 55 degrees, which is why they look narrow on the plan.
  {
    name: "200", first: 228, a: 100, b: 74, up: 28,
    at: [
      152.5, 157.9, 164.5, 172.2, 179.8, 187.8, 195.5, 201.8,
      207.2
    ]
  },

  // Sideline comfortable from 26 m up at 72 m out; the end wants 98 m, where
  // any height from 30 m works. Beyond about 120 m at either end the camera is
  // inside the structure rather than on it. Runs 214 degrees round to 146,
  // anticlockwise past west, north and east, stopping either side of the club.
  {
    name: "300", first: 300, a: 100, b: 72, up: 30,
    at: [
      214.1, 218.5, 224.7, 230.7, 235.9, 241.6, 248.0, 254.7,
      262.1, 269.8, 277.6, 285.1, 291.8, 298.3, 303.9, 309.2,
      315.0, 321.2, 327.2, 333.2, 339.3, 346.0, 353.0,   0.0,
        7.0,  14.1,  20.8,  26.9,  32.9,  38.9,  45.0,  50.8,
       56.1,  61.8,  68.2,  74.9,  82.3,  90.1,  97.8, 105.2,
      111.8, 118.3, 123.9, 129.1, 135.0, 141.0, 145.8
    ]
  },

  // The top deck. 92 m out on the sideline needs 50 m of height to clear what
  // is above it; 112 m at the end works from 42 m. 126 m does not work at any
  // height tried - that is the back wall.
  {
    name: "500", first: 500, a: 112, b: 92, up: 50,
    at: [
      215.2, 219.8, 226.3, 233.2, 240.6, 248.9, 256.7, 263.5,
      270.1, 276.7, 283.5, 291.3, 299.6, 307.0, 313.8, 320.7,
      327.4, 333.9, 340.6, 347.8, 354.3,   0.1,   6.0,  12.5,
       19.8,  26.4,  32.9,  39.4,  46.4,  53.2,  60.5,  68.8,
       76.6,  83.4,  89.9,  96.5, 103.4, 111.1, 119.4, 126.8,
      133.6, 140.0, 144.4
    ]
  }
];

/**
 * How wide a section is, in degrees, from the gap to each of its neighbours.
 *
 * Needed only for drawing the plan. Widths vary by nearly a factor of two round
 * a ring, so a block drawn at the average would overlap its neighbours at the
 * sides and leave gaps at the ends.
 */
function widthOf(ring, i) {
  const at = ring.at;
  const gap = (a, b) => (((at[b] - at[a]) % 360) + 360) % 360;
  const before = i > 0 ? gap(i - 1, i)
    : ring.closed ? gap(at.length - 1, 0) : gap(0, 1);
  const after = i < at.length - 1 ? gap(i, i + 1)
    : ring.closed ? gap(at.length - 1, 0) : gap(at.length - 2, at.length - 1);
  return (before + after) / 2;
}

/** The ring a section belongs to, or null if it is not one we model. */
export function ringOf(section) {
  return RINGS.find((r) => section >= r.first
    && section < r.first + r.at.length) ?? null;
}

/** Every section this module can place, in numbering order. */
export function sections() {
  return RINGS.flatMap((r) =>
    r.at.map((_, i) => r.first + i));
}

/**
 * The camera for a section: standing in it, looking at the middle of the field.
 *
 * Looking at the centre rather than at the near touchline is what keeps the
 * whole surface in shot from every seat in the ring. From behind an end zone
 * that is a long view down the length of the field, which is exactly what those
 * seats have.
 */
export function sectionCamera(cfg, section, surfaceZ) {
  const ring = ringOf(section);
  if (!ring) return null;

  // The measured bearing, then the field's own rotation on top. The chart
  // draws the field square to north; the real one is off by half a degree, and
  // the bowl is built around the field rather than around the compass.
  const bearing = ring.at[section - ring.first] + (cfg.field.rotation || 0);
  const th = bearing * DEG;

  // An ellipse in the field's frame, so `a` runs along the field and `b`
  // across it, whatever bearing the field itself is on.
  const local = (bearing - (cfg.field.rotation || 0)) * DEG;
  const out = (ring.a * ring.b) / Math.hypot(
    ring.b * Math.cos(local), ring.a * Math.sin(local));

  const east = out * Math.sin(th);
  const north = out * Math.cos(th);
  return new Camera({
    position: new Point({
      longitude: cfg.field.lon
        + east / (M_PER_DEG_LON * Math.cos(cfg.field.lat * DEG)),
      latitude: cfg.field.lat + north / M_PER_DEG_LAT,
      z: surfaceZ + ring.up,
      spatialReference: { wkid: 4326 }
    }),
    heading: (bearing + 180) % 360,
    // Down onto the middle of the field from however high the seat is. A seat
    // is nearly level with what it is watching, so this is a few degrees off
    // the horizon rather than the steep look-down of a broadcast camera.
    tilt: 90 - Math.atan2(ring.up, out) / DEG,
    fov: ring.fov ?? SEAT_FOV
  });
}

/**
 * The rings as a plan, for drawing a map of the bowl.
 *
 * Everything here comes from the same table the cameras come from, so the map
 * cannot drift from the thing it is a map of - a section drawn in the wrong
 * place would be a section the camera also flew to the wrong place.
 *
 * Coordinates are metres in the field's own frame: `along` runs the length of
 * the field and `across` its width, which is how the printed seating maps are
 * drawn and how anybody looking at one expects to read it. The renderer decides
 * which way is up.
 */
export function sectionPlan(cfg) {
  const surface = cfg.field.surfaces.gridiron;
  const blocks = RINGS.flatMap((ring) => {
    return ring.at.map((deg, i) => {
      const local = deg * DEG;
      const out = (ring.a * ring.b) / Math.hypot(
        ring.b * Math.cos(local), ring.a * Math.sin(local));
      return {
        section: ring.first + i,
        ring: ring.name,
        along: out * Math.cos(local),
        across: out * Math.sin(local),
        // The block's own size: as wide as its share of the ring, and deep
        // enough to be worth aiming at.
        wide: (2 * Math.PI * out * (widthOf(ring, i) / 360)) * 0.84,
        deep: 15,
        // Turned so its long side lies along the ring rather than across it.
        turn: 90 - (local / DEG)
      };
    });
  });
  return {
    blocks,
    field: { along: surface.depth / 2, across: surface.width / 2 },
    reach: Math.max(...blocks.map((b) => Math.hypot(b.along, b.across))) + 22
  };
}
