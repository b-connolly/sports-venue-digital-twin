/**
 * Where a seating section is, and what it sees.
 *
 * The stadium has no seating layer - the scene carries the reality captures and
 * a lights layer and nothing else - so a section's position is *modelled*, not
 * surveyed. That distinction matters here as much as it does in the play data:
 * these are plausible vantages, close enough that "the view from 132" looks
 * like the view from 132, and they are not seat coordinates.
 *
 * ## What is read rather than guessed
 *
 * The numbering is regular, and that is the whole trick. Sections run in one
 * direction around each ring at a constant spacing, so a section's bearing is
 * arithmetic rather than a digitised point: the lower bowl has 36 sections at
 * 10 degrees each, starting with 100 due south. It checks out against the
 * seating map at the quarter points - 118 lands north, 128 lands east - which
 * is the sort of thing that would be badly wrong rather than slightly wrong if
 * the model were.
 *
 * ## What is modelled
 *
 * The rest: how far out each ring sits, how high, and how far the near edge of
 * the seating is set back from the touchline. Four numbers a ring, tuned by
 * standing in them and looking. A bowl is an ellipse rather than a circle -
 * longer along the field than across it - so the distance is a function of
 * bearing, not a constant.
 *
 * Equal angles rather than equal arc length, which is the one deliberate
 * simplification. Physically the sections are similar widths, so they crowd
 * slightly at the ends of a true ellipse; the map shows nine or ten a side and
 * eight or nine an end, near enough even that the difference is a seat or two
 * of bearing and not worth the arithmetic.
 */
import Camera from "https://js.arcgis.com/5.0/@arcgis/core/Camera.js";
import Point from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Point.js";

const DEG = Math.PI / 180;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320;

/**
 * The rings, as the seating map numbers them.
 *
 * `first` is the lowest section number and `at` the bearing it sits on; `count`
 * closes the ring, so the spacing is 360/count and the last section is
 * first + count - 1. `a` and `b` are the ellipse's half-axes - along the field
 * and across it - `up` is the eye height above the playing surface.
 *
 * Only the lower bowl for now. The upper rings are the same arithmetic with
 * different numbers, and there is no sense in writing them down before the
 * model has been stood in and checked.
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
  { name: "100", first: 100, count: 36, at: 180, a: 88, b: 60, up: 15 }
];

/** The ring a section belongs to, or null if it is not one we model. */
export function ringOf(section) {
  return RINGS.find((r) => section >= r.first && section < r.first + r.count)
    ?? null;
}

/** Every section this module can place, in numbering order. */
export function sections() {
  return RINGS.flatMap((r) =>
    Array.from({ length: r.count }, (_, i) => r.first + i));
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

  // Bearing round the bowl, then the field's own rotation on top: the bowl is
  // built around the field, and the field is not quite square to north.
  const step = 360 / ring.count;
  const bearing = ring.at + (section - ring.first) * step
    + (cfg.field.rotation || 0);
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
    tilt: 90 - Math.atan2(ring.up, out) / DEG
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
    const step = 360 / ring.count;
    return Array.from({ length: ring.count }, (_, i) => {
      const local = (ring.at + i * step) * DEG;
      const out = (ring.a * ring.b) / Math.hypot(
        ring.b * Math.cos(local), ring.a * Math.sin(local));
      return {
        section: ring.first + i,
        ring: ring.name,
        along: out * Math.cos(local),
        across: out * Math.sin(local),
        // The block's own size: as wide as its share of the ring, and deep
        // enough to be worth aiming at.
        wide: (2 * Math.PI * out / ring.count) * 0.84,
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
