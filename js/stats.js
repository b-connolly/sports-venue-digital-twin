/**
 * What the tracking says, beyond where everybody is.
 *
 * The replays already move twenty-two people and a ball through real recorded
 * positions. This reads the same numbers again and asks the questions a
 * broadcast graphic asks: how fast is the man with the ball going, who is
 * closest to him, and is that gap opening or closing.
 *
 * ## Computed here, and said so
 *
 * All of this is arithmetic on an array the browser already has in memory - a
 * first difference for speed, a second for acceleration, a hypotenuse for
 * separation. It is not a sensor feed and the app must never imply that it is.
 * The panel carries a label saying where the numbers come from, in the same
 * spirit as the forecast pill: a figure derived from a recording and a figure
 * measured live must not look alike.
 *
 * What *is* real is the movement underneath. The positions come from the NFL's
 * Big Data Bowl and from Metrica's open sample - actual games, recorded ten
 * times a second - so the speeds and the closing angles are the ones that
 * happened. The distinction worth being precise about is that the tracking is
 * real and recorded, and the analysis is real and local. Neither is live.
 *
 * Operationally this is exactly the job ArcGIS Velocity does: a live tracking
 * feed, motion statistics over each track, and stateful rules for possession -
 * see docs/VELOCITY.md, which is the same arithmetic at a scale a browser
 * cannot reach. This module is deliberately the shape that pipeline would
 * output, so the two can be swapped and compared rather than rewritten.
 *
 * ## Distances
 *
 * Positions arrive in the feed's own space - 120 x 53.333 yards for a gridiron,
 * 105 x 68 metres for a pitch - and are scaled onto the marked surface. Only
 * the scaling is needed here, not the rotation the renderer applies: rotation
 * preserves distance, and a separation is a distance.
 */

/**
 * How wide a window the speeds are read over.
 *
 * A centred difference across one frame either side - two tenths of a second at
 * 10 Hz - which is about what a tracking provider uses. Narrower and the
 * quantisation of the source shows up as a player jittering between 14 and 19
 * mph while running in a straight line; wider and a cut is smoothed into the
 * stride before it.
 */
const V_HALF = 1;

/** And a light average on top, purely so the readout is legible while moving. */
const SMOOTH = 5;

/**
 * Above this the ball is in the air and nobody is carrying it.
 *
 * Height rather than the event names, which differ by sport - the gridiron feed
 * marks `pass_forward` and `pass_arrived`, the football one `cross` - and would
 * need a table per feed that a new play could fall outside of. The ball's own
 * height needs no table: measured across the six passages, the handoff play
 * never leaves 1.05 m and possession correctly never lapses, while the deep
 * pass reaches 8.1 m and the cross 8.1 m, and both correctly go unclaimed for
 * the frames they are up.
 */
const FLIGHT_M = 2.0;

/** And within this of the ball to be carrying it at all. */
const REACH_M = 2.5;

const MPH = 2.2369363;

/**
 * Who the passage is about, and when to say so.
 *
 * The slideshow has nobody clicking it. Left alone it plays six passages of
 * real sport with a panel of numbers nobody has asked a question of, and the
 * one thing a viewer would actually want - which of these twenty-two is the
 * story - never gets pointed at.
 *
 * Both answers come out of the play's own events rather than a table of who
 * scores in which file, because such a table is wrong the first time a passage
 * is rebuilt or added.
 */

/** A passage ends in one of these, and whoever has the ball then is the story. */
const SCORING = ["touchdown", "goal", "field_goal"];

/**
 * Events that mean the ball has been committed: a release, or a turnover.
 *
 * Deliberately not the arrivals and outcomes - `pass_arrived`,
 * `pass_outcome_caught` - and deliberately not the snap. The snap is the start
 * of the play and cueing there would put a card up before there is anything to
 * watch; the outcomes are the moment the thing has already happened. What is
 * wanted is the throw, the handoff, the interception: the point at which the
 * passage commits to the person it is going to be about, with time left to
 * watch them do it.
 */
const RELEASE = new Set(["pass_forward", "handoff", "cross", "shot", "kick",
                         "intercept", "recover", "win", "switch",
                         "field_goal_attempt"]);

/** And it has to land far enough before the score to be worth putting up. */
const LEAD_S = 2.5;

export function buildStats(data, { depthM, widthM }) {
  const space = data.space ?? { length: 120, width: 53.333, unit: "yd" };
  const hz = Number(data.meta.hz) || 10;
  const n = Number(data.meta.frames) || 0;
  // Metres per unit of the feed's own space, along and across. The gridiron
  // works out at 0.9144 - a yard - and the pitch at exactly 1.
  const kx = depthM / space.length;
  const ky = widthM / space.width;
  const unit = space.unit === "m" ? "m" : "yd";
  const perUnit = unit === "m" ? 1 : 1 / 0.9144;   // metres -> the feed's unit

  const players = data.players.map((p, i) => {
    const seen = data.players.slice(0, i)
      .filter((q) => q.side === p.side && q.pos === p.pos).length;
    return {
      side: p.side,
      pos: p.pos,
      // The same identity the Velocity feed uses - see tools/playfield.py.
      // Position alone is not one: this play has three receivers.
      track: `${p.side}-${p.pos}-${seen + 1}`,
      label: `${p.pos}${seen ? " " + (seen + 1) : ""}`,
      x: p.x,
      y: p.y
    };
  });

  const at = (arr, f) => arr[Math.max(0, Math.min(arr.length - 1, f))];
  const gap = (ax, ay, bx, by) =>
    Math.hypot((ax - bx) * kx, (ay - by) * ky);

  /** Metres per second for one track, as a centred difference then smoothed. */
  function speeds(x, y) {
    const raw = new Array(n);
    for (let f = 0; f < n; f++) {
      const a = Math.max(0, f - V_HALF), b = Math.min(n - 1, f + V_HALF);
      const dt = (b - a) / hz;
      raw[f] = dt > 0 ? gap(at(x, a), at(y, a), at(x, b), at(y, b)) / dt : 0;
    }
    const out = new Array(n);
    const h = (SMOOTH - 1) / 2;
    for (let f = 0; f < n; f++) {
      let s = 0, k = 0;
      for (let j = f - h; j <= f + h; j++) {
        if (j >= 0 && j < n) { s += raw[j]; k++; }
      }
      out[f] = s / (k || 1);
    }
    return out;
  }

  const vel = players.map((p) => speeds(p.x, p.y));
  const ballV = speeds(data.ball.x, data.ball.y);

  // Acceleration from the smoothed speed rather than from the raw, or it is
  // the difference of a difference of quantised data and reads as noise.
  const acc = vel.map((v) => {
    const a = new Array(n);
    for (let f = 0; f < n; f++) {
      const lo = Math.max(0, f - 1), hi = Math.min(n - 1, f + 1);
      const dt = (hi - lo) / hz;
      a[f] = dt > 0 ? (v[hi] - v[lo]) / dt : 0;
    }
    return a;
  });

  /* ------------------------------------------------------- per frame state */
  const frames = new Array(n);
  for (let f = 0; f < n; f++) {
    const bx = at(data.ball.x, f), by = at(data.ball.y, f);
    const bz = at(data.ball.z, f);
    const flight = bz > FLIGHT_M;

    let carrier = -1, best = Infinity;
    if (!flight) {
      for (let i = 0; i < players.length; i++) {
        if (players[i].side !== "off") continue;
        const d = gap(at(players[i].x, f), at(players[i].y, f), bx, by);
        if (d < best) { best = d; carrier = i; }
      }
      if (best > REACH_M) carrier = -1;
    }

    // The nearest defender is measured to the carrier when there is one and to
    // the ball when there is not, because a ball in the air is the thing the
    // defence is running at.
    const tx = carrier >= 0 ? at(players[carrier].x, f) : bx;
    const ty = carrier >= 0 ? at(players[carrier].y, f) : by;
    let chaser = -1, sep = Infinity;
    for (let i = 0; i < players.length; i++) {
      if (players[i].side !== "def") continue;
      const d = gap(at(players[i].x, f), at(players[i].y, f), tx, ty);
      if (d < sep) { sep = d; chaser = i; }
    }

    frames[f] = { carrier, chaser, sep, flight, ballZ: bz };
  }

  // Closing rate needs the separation series, so it is a second pass. Negative
  // is closing, which is the sign a viewer expects on a gap that is shrinking.
  for (let f = 0; f < n; f++) {
    const lo = Math.max(0, f - 1), hi = Math.min(n - 1, f + 1);
    const dt = (hi - lo) / hz;
    frames[f].closing = dt > 0 ? (frames[hi].sep - frames[lo].sep) / dt : 0;
  }

  const topBy = vel.map((v) => Math.max(...v));
  const fastest = topBy.indexOf(Math.max(...topBy));

  /* ------------------------------------------------- who, and when to say so */
  const events = data.events ?? {};
  const scoreName = SCORING.find((k) => events[k] != null) ?? null;
  const scoreF = scoreName == null
    ? -1 : Math.max(0, Math.min(n - 1, events[scoreName]));

  /**
   * The protagonist: whoever has the ball when it is scored.
   *
   * Walked backwards when nobody does, which is not an edge case - it is the
   * field goal. The ball is through the posts and forty metres from the nearest
   * human at the moment it counts, so the question "who scored this" is
   * answered a couple of seconds earlier, by whoever last had it. The same walk
   * covers a ball still in the air at a touchdown.
   *
   * `carrier` is the possession already worked out per frame, so this cannot
   * disagree with what the panel says about the same instant.
   */
  let protagonist = -1;
  for (let f = scoreF; f >= 0 && protagonist < 0; f--) {
    if (frames[f].carrier >= 0) protagonist = frames[f].carrier;
  }

  /**
   * The cue: the last committing event that still leaves time to watch.
   *
   * Measured across the six passages this gives the throw on the deep pass, the
   * handoff on the run, the kick on the field goal, the switch of play on the
   * football, and the interception on both of the others - between two and a
   * half and fourteen seconds of watching, and never earlier than a sixth of
   * the way in. Where a passage names no such event the fallback is three
   * seconds before the score, floored so it cannot land on the first moment.
   */
  let cueT = -1;
  if (scoreF >= 0) {
    const limit = scoreF / hz - LEAD_S;
    let best = -1;
    for (const [name, f] of Object.entries(events)) {
      if (!RELEASE.has(name)) continue;
      const t = f / hz;
      if (t <= limit && t > best) best = t;
    }
    cueT = best >= 0 ? best : Math.max(1.5, scoreF / hz - 3);
  }

  /**
   * Ground covered, as a running total per player.
   *
   * Summed from the smoothed speed rather than from the raw positions. The two
   * differ by about a percent over a passage and the smoothed one is the
   * honest answer: adding up the distance between consecutive raw samples also
   * adds up the tracking's own jitter, so a player standing still accumulates
   * a few metres of nothing over twenty seconds.
   */
  const covered = vel.map((v) => {
    const out = new Array(n);
    let sum = 0;
    for (let f = 0; f < n; f++) {
      sum += v[f] / hz;
      out[f] = sum;
    }
    return out;
  });


  return {
    unit,
    /** Top speed reached by anybody in the passage, and who reached it. */
    top: { mph: Math.max(...topBy) * MPH, who: players[fastest]?.label ?? "" },
    /**
     * The derived state at a moment, in the units the readout shows.
     *
     * Keyed by time rather than by frame so the caller does not have to know
     * the sample rate - and so that the same call works against a Velocity
     * stream, where observations arrive keyed by seconds into the passage.
     */
    at(t) {
      const f = Math.max(0, Math.min(n - 1, Math.round(t * hz)));
      const s = frames[f];
      const c = s.carrier >= 0 ? players[s.carrier] : null;
      const d = s.chaser >= 0 ? players[s.chaser] : null;
      return {
        frame: f,
        flight: s.flight,
        carrier: c && {
          label: c.label, track: c.track,
          mph: vel[s.carrier][f] * MPH,
          accel: acc[s.carrier][f]
        },
        chaser: d && {
          label: d.label, track: d.track,
          mph: vel[s.chaser][f] * MPH
        },
        // In the feed's own unit: yards for a gridiron, metres for a pitch.
        sep: Number.isFinite(s.sep) ? s.sep * perUnit : null,
        closing: s.closing * perUnit,
        ballMph: ballV[f] * MPH
      };
    },
    /**
     * Who the passage is about, and the moment worth pointing at them.
     *
     * `cue` is a time in seconds, or null where the passage does not end in
     * anything - in which case nothing should be put up on the viewer's behalf,
     * because there is no answer to point at.
     */
    lead: protagonist >= 0 && cueT >= 0
      ? { index: protagonist, cue: cueT,
          label: players[protagonist].label, scored: scoreName }
      : null,
    /** The roster, for anything that needs to name a player it has not clicked. */
    players: players.map((p, i) => ({
      index: i, track: p.track, label: p.label, side: p.side, pos: p.pos,
      topMph: topBy[i] * MPH
    })),
    /**
     * One player, at a moment.
     *
     * Everything a popup pinned to somebody needs, and nothing that would make
     * it a different kind of number from the strip above it: the same speeds,
     * the same units, the same source. A readout that disagreed with the panel
     * two inches away would be worse than no readout.
     */
    trackAt(i, t) {
      const p = players[i];
      if (!p) return null;
      const f = Math.max(0, Math.min(n - 1, Math.round(t * hz)));
      const s = frames[f];
      const bx = at(data.ball.x, f), by = at(data.ball.y, f);
      const toBall = gap(at(p.x, f), at(p.y, f), bx, by);
      return {
        index: i, track: p.track, label: p.label, side: p.side, pos: p.pos,
        mph: vel[i][f] * MPH,
        // Metres per second per second. Shown as a g-force would be shown -
        // signed, so a viewer can see braking as well as acceleration, which
        // is half of what a cut actually is.
        accel: acc[i][f],
        topMph: topBy[i] * MPH,
        // In the feed's own unit, like every other distance here.
        toBall: toBall * perUnit,
        covered: covered[i][f] * perUnit,
        carrying: s.carrier === i,
        chasing: s.chaser === i,
        unit
      };
    }
  };
}
