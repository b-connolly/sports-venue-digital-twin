/**
 * The play drawn on the field as it happens.
 *
 * A coach's diagram is a still: everybody's route drawn at once, so you read
 * the design and not the sequence. On a replay the sequence is the point, so
 * this draws the same diagram a frame at a time - each route grows behind the
 * man running it, and the shape of the play appears in the order it was made.
 *
 * Conventions are the playbook's, because a viewer who knows them should not
 * have to learn ours: the offence are circles, the defence crosses, both set
 * where they line up. Only the offence gets routes. That is not a shortcut -
 * a diagram that traces all twenty-two is a plate of spaghetti, and the
 * defence's job on a drawn play is to be where it started.
 *
 * Everything is one graphic per role rather than one per player. Twenty-two
 * polylines rebuilt ten times a second is twenty-two geometries a frame to
 * allocate and hand to the renderer; a multi-part polyline is one, and the
 * renderer draws the parts just the same.
 */
import Graphic from "https://js.arcgis.com/5.0/@arcgis/core/Graphic.js";
import GraphicsLayer from "https://js.arcgis.com/5.0/@arcgis/core/layers/GraphicsLayer.js";
import Polyline from "https://js.arcgis.com/5.0/@arcgis/core/geometry/Polyline.js";
import LineSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/LineSymbol3D.js";
import LineSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/LineSymbol3DLayer.js";

// Chalk, not paint: bright enough to read over turf at broadcast distance,
// and the carrier's line hot so the eye follows the ball without being told.
const ROUTE = [246, 246, 244];
const CARRY = [251, 79, 20];
// Ink, not chalk. A playbook is black on white; on turf the same marks want to
// be black on green, and the crosses have to hold their shape at the distance
// the field is watched from or they are just dots.
const DEF = [18, 18, 20];

const LIFT = 0.06;         // metres above the turf, clear of z-fighting
const WIDTH = 1.5;         // route line, points
const CARRY_WIDTH = 2.3;
const DASH = { type: "style", style: "dash" };

/**
 * Who blocks and who runs.
 *
 * A playbook draws routes for the men who go somewhere and leaves the line as
 * five circles: their movement is a yard of shove, and drawn in full it is five
 * scribbles on top of each other exactly where the eye is already busy. So the
 * line gets the first moment of its block and then stops, which says "these
 * held here" without saying it five times over.
 *
 * Read off the position in the data rather than guessed from the movement -
 * a pulling guard travels as far as a receiver, and would otherwise be drawn
 * as though he had run a route.
 */
const BLOCKERS = new Set(["C", "G", "T", "OG", "OT", "LS"]);
const BLOCK_S = 1.1;       // when the block is made and the mark is drawn

// Metres, in the field's own frame.
const STEM = 1.5;          // the blocker's short line into his man
const BAR = 2.0;           // and the bar across it that means "held here"
const ARROW = 3.0;         // the head that caps a route
const SMOOTH = 5;          // frames either side, averaged
const STEP = 2;            // and one point kept in this many

// A mark is about a body across. The size is set by the line of scrimmage and
// nowhere else: a guard and the man over him stand a metre apart, so anything
// drawn wider than that turns the middle of the formation into a knot of
// overlapping marks - which is where the eye goes first and the least room
// there is to spare. A playbook can space its marks out because it is drawing a
// design; this is drawing where twenty-two men actually stood.
const MARK_R = 0.8;        // metres, half the width of a mark
const RING_SEGS = 16;      // enough that a circle is not a polygon at this size
const RING_PEN = 1.8;      // points
const CROSS_PEN = 2.4;     // heavier, because ink on green has less to work with

/**
 * @param {object} data     the play file
 * @param {object} map      the play's own mapper: toEN(x, y), toLonLat(e, n)
 * @param {number} z        height of the painted surface
 */
export function addChalk(data, map, z) {
  const layer = new GraphicsLayer({
    title: "Live action — chalk",
    listMode: "hide",
    elevationInfo: { mode: "absolute-height" }
  });

  const hz = data.meta.hz;
  // Routes start at the snap. Before it nobody has moved - the pre-snap frames
  // are held - so a line drawn from frame zero would be a dot, and a line drawn
  // from the play's start would claim movement that did not happen.
  const from = data.events?.ball_snap ?? 0;
  // And they stop at the whistle. The celebration is authored movement; drawing
  // it as route would make a man mobbing the scorer look like part of the play.
  const until = data.meta.measuredFrames ?? data.meta.frames;

  const carrier = typeof data.meta.carrier === "number" ? data.meta.carrier : -1;
  // The moment the ball commits to somebody. Everyone who did not get it stops
  // being drawn here and is capped with an arrow instead.
  const ev = data.events ?? {};
  // The moment the ball is *received*, not the moment it is let go of. The
  // difference is two and a half seconds on the deep pass, and all of it is the
  // part of the play worth watching: ten men are still running their routes
  // while the ball is in the air, and cutting them off at the throw stops the
  // diagram exactly when the routes are about to arrive. So everyone is drawn
  // until the catch. After it the play belongs to one man, and the other nine
  // are still running but no longer in it.
  const caught = ev.pass_outcome_caught ?? ev.pass_arrived ?? ev.handoff
              ?? ev.field_goal_attempt
              ?? (data.meta.measuredFrames ?? data.meta.frames);
  // Football names its own: the file records who played the delivery, who met
  // it, and the three frames that matter, because none of it can be recovered
  // from the tracking afterwards - see build_soccer.py. Absent, and this is a
  // gridiron play.
  const assist = data.meta.assist ?? null;
  const players = data.players;
  const offence = players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.side === "off");

  // Two frames of reference: the field's metres, where the glyphs are drawn,
  // and longitude and latitude, which is the only thing the renderer takes.
  const en = (p, f) => map.toEN(p.x[f], p.y[f]);
  const ll = ([e, n]) => {
    const [lon, lat] = map.toLonLat(e, n);
    return [lon, lat, z + LIFT];
  };
  const at = (p, f) => ll(en(p, f));

  /**
   * A player's path as a diagram draws it, not as the tracker recorded it.
   *
   * Ten samples a second of a real body carry every stutter and every
   * centimetre the optical tracking guessed at, and drawn as a line that reads
   * as a scribble - which is the difference between the traces this had and the
   * arcs a playbook uses. So the path is averaged over half a second either
   * way and then thinned, which keeps the shape of the route and loses the
   * hand-shake. The ends are held, or smoothing would walk a man off his own
   * starting mark.
   */
  function path(p, a, b) {
    const raw = [];
    for (let k = a; k <= b; k++) raw.push(en(p, k));
    if (raw.length < 3) return raw;
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      if (i === 0 || i === raw.length - 1) { out.push(raw[i]); continue; }
      if (i % STEP && i !== raw.length - 1) continue;
      let e = 0, n = 0, c = 0;
      for (let j = Math.max(0, i - SMOOTH); j <= Math.min(raw.length - 1, i + SMOOTH); j++) {
        e += raw[j][0]; n += raw[j][1]; c++;
      }
      out.push([e / c, n / c]);
    }
    return out;
  }

  const unit = ([e, n]) => {
    const d = Math.hypot(e, n) || 1;
    return [e / d, n / d];
  };
  const mid = (side, f) => {
    const pts = players.filter((q) => q.side === side).map((q) => en(q, f));
    return [pts.reduce((a, q) => a + q[0], 0) / pts.length,
            pts.reduce((a, q) => a + q[1], 0) / pts.length];
  };
  const ballEN = (f) => map.toEN(data.ball.x[f], data.ball.y[f]);
  // Which way is forward, taken from where the two sides line up rather than
  // from a constant - the plays run towards both ends of the ground. Football
  // has no formation to read that off, so it takes the direction of the finish,
  // which is the only bearing in the passage that means anything.
  const FWD = (() => {
    if (assist) {
      const a = ballEN(assist.met), b = ballEN(assist.scored);
      const d = [b[0] - a[0], b[1] - a[1]];
      return Math.hypot(d[0], d[1]) > 0.5 ? unit(d) : [1, 0];
    }
    const o = mid("off", from), d = mid("def", from);
    return unit([d[0] - o[0], d[1] - o[1]]);
  })();

  /**
   * A V at `p`, opening back along `d`: this route carries on.
   *
   * `len` is given where the line being capped is short. A route runs forty
   * yards and a three-metre head is a detail on the end of it; a finish from
   * the six-yard box is four metres long, and the same head on that is an
   * arrow with no shaft - barbs as long as the line they are supposed to be
   * pointing along.
   */
  const head = (p, d, len = ARROW) => {
    const perp = [-d[1], d[0]];
    const back = [p[0] - d[0] * len, p[1] - d[1] * len];
    const w = len * 0.5;
    return [
      [ll([back[0] + perp[0] * w, back[1] + perp[1] * w]), ll(p)],
      [ll(p), ll([back[0] - perp[0] * w, back[1] - perp[1] * w])]
    ];
  };

  const perp = [-FWD[1], FWD[0]];
  // Offsets are taken along the play rather than along the world, so the marks
  // line up with the formation and read as a row instead of a scatter.
  const off2 = (c, a, b) => ll([c[0] + a * FWD[0] + b * perp[0],
                                c[1] + a * FWD[1] + b * perp[1]]);

  const crossAt = (c) => [
    [off2(c, -MARK_R, -MARK_R), off2(c, MARK_R, MARK_R)],
    [off2(c, -MARK_R, MARK_R), off2(c, MARK_R, -MARK_R)]
  ];
  const ringAt = (c) => {
    const p = [];
    for (let i = 0; i <= RING_SEGS; i++) {
      const a = (i / RING_SEGS) * Math.PI * 2;
      p.push(off2(c, Math.cos(a) * MARK_R, Math.sin(a) * MARK_R));
    }
    return [p];
  };

  /** A stem with a bar across it: this man blocked and stayed. */
  const block = (p, d, grown) => {
    const perp = [-d[1], d[0]];
    const tip = [p[0] + d[0] * STEM * grown, p[1] + d[1] * STEM * grown];
    const parts = [[ll(p), ll(tip)]];
    if (grown >= 1) {
      parts.push([ll([tip[0] + perp[0] * BAR / 2, tip[1] + perp[1] * BAR / 2]),
                  ll([tip[0] - perp[0] * BAR / 2, tip[1] - perp[1] * BAR / 2])]);
    }
    return parts;
  };

  /** One graphic for the many, rebuilt as the play runs. */
  const routes = new Graphic({
    symbol: new LineSymbol3D({ symbolLayers: [new LineSymbol3DLayer({
      material: { color: ROUTE }, size: WIDTH, cap: "round", join: "round",
      pattern: DASH
    })] })
  });
  // Solid, and a little heavier: the routes are a plan, this is what happened.
  const carried = new Graphic({
    symbol: new LineSymbol3D({ symbolLayers: [new LineSymbol3DLayer({
      material: { color: CARRY }, size: CARRY_WIDTH, cap: "round", join: "round"
    })] })
  });

  // ------------------------------------------------------------- football --
  // A goal, and the two men it belongs to. Nothing else.
  //
  // The gridiron diagram draws the whole play because a play is a design and
  // every route is part of it. A passage of football is not: twenty-two men
  // moving for half a minute has no design to show, and drawn in full it is
  // half a minute of scribble over the one thing worth pointing at. So this
  // draws the last two touches - the delivery in, dashed, and the finish,
  // solid - and rings the man at each end of them.
  //
  // The colours carry the whole message and are the same ones the rest of the
  // app uses: white is the ball being moved, orange is the ball being scored
  // with. The white ring made the pass, the orange ring scored.
  if (assist) {
    const mark = (color) => new Graphic({
      symbol: new LineSymbol3D({ symbolLayers: [new LineSymbol3DLayer({
        material: { color }, size: RING_PEN, cap: "round", join: "round"
      })] })
    });
    const feedMark = mark(ROUTE), scoreMark = mark(CARRY);
    layer.addMany([routes, carried, feedMark, scoreMark]);

    const line = (paths) => paths.length
      ? new Polyline({ paths, spatialReference: { wkid: 4326 } }) : null;
    // Every frame of it, unsmoothed. The gridiron routes are half a minute of
    // a running man and need the shake taken out; this is at most two seconds
    // of a struck ball, and what the file has for it is already a modelled
    // flight - there is nothing left in it to smooth away.
    const flight = (a, b) => {
      const out = [];
      for (let k = a; k <= b; k++) out.push(ll(ballEN(k)));
      return out.length > 1 ? [out] : [];
    };
    /** How far the ball actually travelled over those frames, in metres. */
    const span = (a, b) => {
      let d = 0;
      for (let k = a; k < b; k++) {
        const u = ballEN(k), v = ballEN(k + 1);
        d += Math.hypot(v[0] - u[0], v[1] - u[1]);
      }
      return d;
    };

    let seen = -1;
    const drawFootball = (t) => {
      const f = Math.min(assist.scored, Math.round(t * hz));
      if (f === seen) return;
      seen = f;
      // Before the delivery there is nothing to say, and after the ball is over
      // the line there is nothing to add - the celebration is not the goal.
      const on = f >= assist.at;
      routes.geometry = on ? line(flight(assist.at, Math.min(f, assist.met))) : null;
      feedMark.geometry = on
        ? line(ringAt(en(players[assist.from], assist.at))) : null;

      const done = f > assist.met;
      const shot = done ? flight(assist.met, f) : [];
      if (shot.length) {
        const q = shot[0], b = ballEN(f), a = ballEN(Math.max(assist.met, f - 2));
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3
          ? unit([b[0] - a[0], b[1] - a[1]]) : FWD;
        const len = Math.max(0.9, Math.min(ARROW, span(assist.met, f) * 0.45));
        shot.push(...head(b, d, len));
        carried.geometry = line(shot);
      } else {
        carried.geometry = null;
      }
      scoreMark.geometry = done
        ? line(ringAt(en(players[assist.to], assist.met))) : null;
    };

    return {
      layer,
      update: drawFootball,
      reset() { seen = -1; drawFootball(0); },
      set visible(v) { layer.visible = !!v; },
      get visible() { return layer.visible; }
    };
  }

  // Circles for the offence, crosses for the defence, which is how the sport
  // has drawn itself for a century.
  //
  // Drawn as lines rather than as symbols, and that is the whole of it: this
  // view does not draw icons. A point carrying an IconSymbol3DLayer is accepted,
  // kept, and reported back with its geometry intact - and never appears, on the
  // turf or thirty metres above it, with the layer visible and nothing on the
  // console. An object symbol in the same place renders, so it is billboards
  // specifically. Chalk is a better fit than a symbol would have been anyway: a
  // mark measured in metres lies on the field and turns with it, where a
  // billboard is a sticker on the screen that stays the same size as the camera
  // pulls out and stands upright while everything it belongs to lies flat.
  // Where everyone lines up. Drawn once, from the snap frame, and left there -
  // the diagram's job is to say where the play started from. One graphic a side,
  // every mark a part of it, the same way the routes are one graphic.
  const marks = (side, glyph, color, width) => new Graphic({
    geometry: new Polyline({
      paths: players.filter((p) => p.side === side)
                    .flatMap((p) => glyph(en(p, from))),
      spatialReference: { wkid: 4326 }
    }),
    symbol: new LineSymbol3D({ symbolLayers: [new LineSymbol3DLayer({
      material: { color }, size: width, cap: "round", join: "round"
    })] })
  });

  // Routes first, marks over them: a route leaves its man's mark, and drawn the
  // other way round it is drawn through it.
  layer.addMany([
    routes,
    carried,
    marks("off", ringAt, ROUTE, RING_PEN),
    marks("def", crossAt, DEF, CROSS_PEN)
  ]);

  let shownTo = -1;

  /** Draw the play as far as `t` seconds. */
  function update(t) {
    const f = Math.max(from, Math.min(until - 1, Math.round(t * hz)));
    if (f === shownTo) return;
    shownTo = f;

    const paths = [];
    let hot = null, hotHead = null;
    const blockEnd = from + Math.round(BLOCK_S * hz);

    for (const { p, i } of offence) {
      // The man with the ball is drawn whole, into the end zone, whatever he
      // lines up as. His is the line the play is about.
      // The man who ends up with it is one route among five until the ball
      // reaches him, and from that moment the whole of his line is orange -
      // not the part after the catch, but all of it, back to the snap.
      //
      // Which is the point of drawing it at all. While the ball is in the air
      // there is nothing to say and saying it early would give the play away;
      // the instant it is caught, the route that worked lights up along its
      // whole length and the four that did not stay where they are. The line
      // does not grow into the answer, it becomes it.
      if (i === carrier) {
        if (f < caught) {
          const pts = path(p, from, f);
          if (pts.length > 1) paths.push(pts.map(ll));
        } else {
          const pts = path(p, from, f);
          if (pts.length > 1) {
            hot = pts.map(ll);
            const a = pts[Math.max(0, pts.length - 3)], b = pts[pts.length - 1];
            const d = Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3
              ? unit([b[0] - a[0], b[1] - a[1]]) : FWD;
            hotHead = head(b, d);
          }
        }
        continue;
      }

      // The line blocks. Where he ends up a second later is his man; if he
      // barely moved, he took whoever came to him, which is straight ahead.
      if (BLOCKERS.has(p.pos)) {
        const a = en(p, from), b = en(p, Math.min(f, blockEnd));
        const moved = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const dir = moved > 0.4 ? unit([b[0] - a[0], b[1] - a[1]]) : FWD;
        const grown = Math.min(1, (f - from) / Math.max(1, blockEnd - from));
        if (grown > 0.05) paths.push(...block(a, dir, grown));
        continue;
      }

      // Everyone else runs a route, drawn until somebody catches the ball -
      // after that they are still running, but the play has left them, and
      // tracing every stride of a man who is no longer in it is the noise a
      // playbook leaves out. An arrowhead says the route carried on.
      const stop = Math.min(f, caught);
      const pts = path(p, from, stop);
      if (pts.length < 2) continue;
      paths.push(pts.map(ll));
      if (stop >= caught) {
        const a = pts[Math.max(0, pts.length - 3)], b = pts[pts.length - 1];
        const d = Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.3
          ? unit([b[0] - a[0], b[1] - a[1]]) : FWD;
        paths.push(...head(b, d));
      }
    }
    routes.geometry = paths.length
      ? new Polyline({ paths, spatialReference: { wkid: 4326 } })
      : null;
    carried.geometry = hot
      ? new Polyline({ paths: [hot, ...(hotHead ?? [])],
                       spatialReference: { wkid: 4326 } })
      : null;
  }

  return {
    layer,
    update,
    /** Wind it back, so a replay does not start with the last one still drawn. */
    reset() { shownTo = -1; update(from / hz); },
    set visible(on) { layer.visible = !!on; },
    get visible() { return layer.visible; }
  };
}
