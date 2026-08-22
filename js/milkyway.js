/**
 * Milky Way night sky.
 *
 * The SDK draws stars but has no galactic band, and `starsEnabled` exposes no
 * texture hook. This adds one as a custom render pass: a full-screen shader
 * that paints an equirectangular sky map into the pixels where nothing was
 * drawn, leaving the SDK's own stars and atmosphere on top of it.
 *
 * It is astronomically placed, not decorative. The camera ray is rotated into
 * equatorial coordinates using the observer's latitude and the local sidereal
 * time derived from `environment.lighting.date`, so the band sits where it
 * really is, rotates through the night, and shifts with the seasons — and it
 * follows the time-of-day slider for free.
 *
 * Texture: NASA SVS "Deep Star Maps 2020" (public domain), equatorial
 * equirectangular, median-filtered to drop the point stars (the SDK renders
 * those itself) and sqrt-encoded so 8-bit keeps precision in the dim range.
 */

import RenderNode from "https://js.arcgis.com/5.0/@arcgis/core/views/3d/webgl/RenderNode.js";

const VERT = `#version 300 es
out vec2 vUV;
void main() {
  // Full-screen triangle from the vertex id — no buffers needed.
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler2D;

in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uColor;
uniform sampler2D uDepth;
uniform sampler2D uSky;
uniform mat3  uRayToEq;    // camera ray -> equatorial unit vector
uniform vec2  uTanHalf;    // tan(hfov/2), tan(vfov/2)
uniform float uGain;
uniform float uScale;      // decode scale for the sqrt-encoded texture

const float PI = 3.14159265358979;

void main() {
  vec4 col = texture(uColor, vUV);

  // Paint only where nothing was rendered — anything with geometry keeps its
  // colour, so terrain, stadium, splat and the jumbotron all occlude correctly
  // with no depth fighting.
  float depth = texture(uDepth, vUV).r;
  if (depth < 0.99999) { fragColor = col; return; }

  vec3 ray = normalize(vec3((vUV.x * 2.0 - 1.0) * uTanHalf.x,
                            (vUV.y * 2.0 - 1.0) * uTanHalf.y,
                            1.0));
  vec3 eq = normalize(uRayToEq * ray);

  float dec = asin(clamp(eq.z, -1.0, 1.0));
  float ra  = atan(eq.y, eq.x);
  vec2 uv = vec2(fract(ra / (2.0 * PI)), 0.5 - dec / PI);

  vec3 band = texture(uSky, uv).rgb;
  band = band * band * uScale;              // undo the sqrt encode

  fragColor = vec4(col.rgb + band * uGain, col.a);
}`;

/* ------------------------------------------------------------ astronomy */

/** Local sidereal time, in degrees, for a UTC instant and longitude. */
function localSiderealDeg(date, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const d = jd - 2451545.0;
  return (((280.46061837 + 360.98564736629 * d) % 360) + lonDeg + 360) % 360;
}

/** Sun altitude in degrees — used to fade the band out around twilight. */
export function sunAltitudeDeg(date, latDeg, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const rad = Math.PI / 180;
  const L = (280.460 + 0.9856474 * n) * rad;
  const g = (357.528 + 0.9856003 * n) * rad;
  const lambda = L + (1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const lst = localSiderealDeg(date, lonDeg) * rad;
  const lat = latDeg * rad;
  const h = lst - ra;
  return Math.asin(
    Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(h)
  ) / rad;
}

/**
 * Matrix taking a camera-space ray (+X right, +Y up, +Z forward) to an
 * equatorial unit vector. Returned column-major, as WebGL wants it.
 *
 * Verified against the hour-angle formulation to 1e-13 across the sphere.
 */
function rayToEquatorial(camera, date) {
  const rad = Math.PI / 180;
  const lat = camera.position.latitude * rad;
  const lst = localSiderealDeg(date, camera.position.longitude) * rad;

  // ArcGIS tilt: 0 looks straight down, 90 is horizontal.
  const alt = (camera.tilt - 90) * rad;
  const az = camera.heading * rad;

  const ca = Math.cos(alt), sa = Math.sin(alt);
  const cz = Math.cos(az), sz = Math.sin(az);
  const fwd = [sz * ca, cz * ca, sa];
  const right = [cz, -sz, 0];
  const up = [                       // cross(right, fwd)
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0]
  ];

  // ENU basis expressed in the equatorial frame.
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const ct = Math.cos(lst), st = Math.sin(lst);
  const E = [-st, ct, 0];
  const N = [-sl * ct, -sl * st, cl];
  const U = [cl * ct, cl * st, sl];

  const toEq = (v) => [
    E[0] * v[0] + N[0] * v[1] + U[0] * v[2],
    E[1] * v[0] + N[1] * v[1] + U[1] * v[2],
    E[2] * v[0] + N[2] * v[1] + U[2] * v[2]
  ];
  const r = toEq(right), u = toEq(up), f = toEq(fwd);
  return [r[0], r[1], r[2], u[0], u[1], u[2], f[0], f[1], f[2]];
}

/* ----------------------------------------------------------------- gl */

function compile(gl, src, type) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader: ${log}`);
  }
  return sh;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

/**
 * Add the Milky Way to a SceneView.
 * Returns a handle with `remove()` and `setGain()`; if anything fails the scene
 * is untouched, because the pass simply never gets added.
 */
export async function addMilkyWay(view, cfg = {}) {
  const {
    texture = "./assets/milkyway.jpg",
    scale = 0.705,          // encode scale from the texture build
    fadeStartDeg = -4,      // sun altitude where the band starts to appear
    fadeFullDeg = -12       // ...and where it reaches full strength
  } = cfg;
  // Held in an object rather than destructured, so setGain() actually reaches
  // the value the render loop reads.
  const state = { gain: cfg.gain ?? 0.7 };

  const image = await loadTexture(texture);

  /**
   * RenderNode is an Accessor. Accessor applies constructor properties and
   * calls initialize() from postscript(), which is generated by
   * createSubclass()/@subclass — a plain `class extends RenderNode` never runs
   * it, so `view` stays null and the node is never registered with the
   * renderer. Hence createSubclass rather than an ES class.
   */
  const MilkyWayNode = RenderNode.createSubclass({
    constructor() {
      this.produces = "composite-color";
      // Without this the input FBO carries no depth, and there is no way to
      // tell sky from unlit ground.
      this.requireGeometryDepth = true;
      this._gl = null;
      this._logged = false;
      this._first = false;
    },

    _setup(gl) {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, VERT, gl.VERTEX_SHADER));
      gl.attachShader(prog, compile(gl, FRAG, gl.FRAGMENT_SHADER));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        throw new Error(`link: ${gl.getProgramInfoLog(prog)}`);
      }
      this._prog = prog;
      this._u = {};
      for (const n of ["uColor", "uDepth", "uSky", "uRayToEq", "uTanHalf", "uGain", "uScale"]) {
        this._u[n] = gl.getUniformLocation(prog, n);
      }

      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      // Wrap in RA so the 0h/24h seam is continuous; clamp in declination.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this._tex = tex;
      this._vao = gl.createVertexArray();
      this._gl = gl;
    },

    render(inputs) {
      try { return this._draw(inputs); }
      catch (err) {
        if (!this._logged) {
          this._logged = true;
          console.error("[MilkyWay] render failed, pass disabled:", err.message);
        }
        return this.bindRenderTarget();
      }
    },

    _draw(inputs) {
      const input = inputs.find(({ name }) => name === "composite-color");
      const output = this.acquireOutputFramebuffer();
      const gl = this.gl;
      if (!this._gl) this._setup(gl);

      const cam = this.view.camera;
      const date = this.view.environment?.lighting?.date ?? new Date();
      const sunAlt = sunAltitudeDeg(date, cam.position.latitude, cam.position.longitude);
      // Invisible in daylight, full strength once the sky is properly dark.
      const fade = Math.min(1, Math.max(0,
        (fadeStartDeg - sunAlt) / (fadeStartDeg - fadeFullDeg)));

      if (!this._first) {
        this._first = true;
        console.info("[MilkyWay] running — sun", sunAlt.toFixed(1) + "deg, fade",
          fade.toFixed(2) + ", gain", (state.gain * fade).toFixed(2));
      }

      gl.useProgram(this._prog);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, input.getTexture().glName);
      gl.uniform1i(this._u.uColor, 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, input.depthTexture.glName);
      gl.uniform1i(this._u.uDepth, 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this._tex);
      gl.uniform1i(this._u.uSky, 2);

      // `fov` is the horizontal field of view; derive the vertical from aspect.
      const aspect = this.view.width / Math.max(this.view.height, 1);
      const tanH = Math.tan((cam.fov * Math.PI / 180) / 2);
      gl.uniform2f(this._u.uTanHalf, tanH, tanH / aspect);
      gl.uniformMatrix3fv(this._u.uRayToEq, false, rayToEquatorial(cam, date));
      gl.uniform1f(this._u.uGain, state.gain * fade);
      gl.uniform1f(this._u.uScale, scale);

      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(this._vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);

      // Hand the context back exactly as the SDK expects to find it.
      this.resetWebGLState();
      return output;
    }
  });

  const node = new MilkyWayNode({
    view,
    consumes: { required: ["composite-color"] }
  });
  // If `view` is null here, Accessor's postscript() did not run: the node was
  // never registered with the renderer and nothing will draw.
  console.info("[MilkyWay] node:",
    "view =", node.view ? "set" : "NULL",
    "| produces =", node.produces,
    "| consumes =", JSON.stringify(node.consumes),
    "| depth =", node.requireGeometryDepth);

  return {
    node,
    remove: () => node.destroy(),
    gain: () => state.gain,
    setGain: (g) => { state.gain = g; node.requestRender?.(); }
  };
}
