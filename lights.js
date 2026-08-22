/**
 * Stadium lighting: symbology and popup, applied only where the scene has none.
 *
 * The hosted feature service cannot carry this. Its `drawingInfo` accepts 2D
 * renderers only - pushing a PointSymbol3D returns success and is then silently
 * discarded - so the 3D symbols live either in the web scene's layer override or
 * here.
 *
 * The web scene is the authority. When it carries a 3D renderer, that is
 * someone's deliberate tuning of colour, size, transparency and emissive
 * strength against the actual night scene, and it is left completely alone -
 * renderer, elevation offset and popup alike. What follows is a fallback for a
 * layer dropped in raw, so the fixtures are never dark spheres after dark.
 *
 * Emissive is the whole point: without it the fixtures are sun-shaded like any
 * other object, so at night they disappear. With it they read as the light
 * sources they represent.
 */

import UniqueValueRenderer from "https://js.arcgis.com/5.0/@arcgis/core/renderers/UniqueValueRenderer.js";
import PointSymbol3D from "https://js.arcgis.com/5.0/@arcgis/core/symbols/PointSymbol3D.js";
import ObjectSymbol3DLayer from "https://js.arcgis.com/5.0/@arcgis/core/symbols/ObjectSymbol3DLayer.js";
import PopupTemplate from "https://js.arcgis.com/5.0/@arcgis/core/PopupTemplate.js";

/**
 * Fallback only. Sizes are real metres. Values follow the ones tuned in the web
 * scene: amber rather than white, part-transparent so overlapping fixtures on
 * the roof ring build up into a glow instead of a solid bead, and emissive well
 * above 1 so they carry at stadium distances.
 */
const STYLE = {
  "Roof floodlight":  { size: 1.7, color: [255, 187, 0],  alpha: 0.53, glow: 16.0 },
  "Parking pole":     { size: 1.0, color: [171, 137, 43], alpha: 0.70, glow: 13.3 },
  "Plaza lamp":       { size: 1.0, color: [171, 137, 43], alpha: 0.75, glow: 12.5 },
  "Aisle step light": { size: 1.0, color: [255, 187, 0],  alpha: 0.58, glow: 11.45 }
};
const FALLBACK = { size: 1.2, color: [255, 200, 60], alpha: 0.6, glow: 13.0 };

function bulb({ size, color, alpha, glow }) {
  return new PointSymbol3D({
    symbolLayers: [new ObjectSymbol3DLayer({
      resource: { primitive: "sphere" },
      width: size, depth: size, height: size,
      // `emissive` takes { strength, source } in 5.x - a bare colour array is
      // the 4.x form and does not survive.
      material: { color: [...color, alpha], emissive: { strength: glow, source: "color" } }
    })]
  });
}

/** Every symbol a renderer might carry, whatever its flavour. */
function symbolsOf(renderer) {
  if (!renderer) return [];
  const out = [renderer.symbol, renderer.defaultSymbol];
  (renderer.uniqueValueInfos || []).forEach((i) => out.push(i.symbol));
  (renderer.uniqueValueGroups || []).forEach((g) =>
    (g.classes || []).forEach((c) => out.push(c.symbol)));
  (renderer.classBreakInfos || []).forEach((i) => out.push(i.symbol));
  return out.filter(Boolean);
}

/** True when the scene already symbolises this layer in 3D. */
function authored(layer) {
  return symbolsOf(layer.renderer).some((s) => s.type === "point-3d");
}

const CONTENT = `
  <div class="lightpop">
    <div class="lightpop__eyebrow">{assembly} &middot; #{position_index}</div>
    <div class="lightpop__hero">
      <span class="lightpop__big">{height_above_deck_m}</span>
      <span class="lightpop__unit">m above ground</span>
    </div>
    <table class="lightpop__t">
      <tr><td>Elevation</td><td>{elev_egm96_m} m <em>EGM96</em></td></tr>
      <tr><td>Derived from</td><td>{source}</td></tr>
      <tr><td>Position tolerance</td><td>&plusmn;{position_tolerance_m} m</td></tr>
      <tr><td>Splat points behind it</td><td>{support_points}</td></tr>
      <tr><td>Light ID</td><td>{light_id}</td></tr>
    </table>
    <div class="lightpop__note">{expression/confidence}</div>
  </div>`;

const CONFIDENCE = `
  if ($feature.source == "measured") {
    return "Measured directly from the drone Gaussian splat at 0.42 m ground resolution. Position is good to roughly the tolerance shown.";
  }
  return "Modelled, not observed. A step light is about 10 cm, far below this capture's resolution, so the aisle line and spacing were inferred from the seating geometry. Indicative placement only.";`;

function popup() {
  return new PopupTemplate({
    title: "{category}",
    content: CONTENT,
    expressionInfos: [{ name: "confidence", title: "Confidence", expression: CONFIDENCE }],
    fieldInfos: [
      { fieldName: "height_above_deck_m", format: { places: 1, digitSeparator: false } },
      { fieldName: "elev_egm96_m", format: { places: 1, digitSeparator: true } },
      { fieldName: "position_tolerance_m", format: { places: 1, digitSeparator: false } },
      { fieldName: "support_points", format: { places: 0, digitSeparator: true } },
      { fieldName: "position_index", format: { places: 0, digitSeparator: false } },
      { fieldName: "light_id", format: { places: 0, digitSeparator: false } }
    ]
  });
}

/**
 * Give the lighting layers 3D emissive symbology and a popup - but only the
 * parts the web scene has not already specified.
 */
export function styleLights(layers) {
  layers.forEach((layer) => {
    if (layer.type !== "feature") return;

    if (authored(layer)) {
      // The scene's classes match `category` as an exact string, so a single
      // mistyped value renders nothing at all - silently, since a missing light
      // among hundreds looks like no light. Give the renderer a default when it
      // has none: a stray then reads as a slightly-off fixture rather than a
      // hole. This adds to the authored symbology without altering any class.
      if (!layer.renderer.defaultSymbol) {
        const r = layer.renderer.clone();
        r.defaultSymbol = bulb(FALLBACK);
        layer.renderer = r;
      }
      console.info(`[Lights] ${layer.title}: using the scene's own 3D symbology`);
    } else {
      const r = new UniqueValueRenderer({ field: "category", defaultSymbol: bulb(FALLBACK) });
      for (const [value, s] of Object.entries(STYLE)) {
        r.addUniqueValueInfo({ value, symbol: bulb(s) });
      }
      layer.renderer = r;
      // Absolute height: z is EGM96 orthometric, matching the scene's integrated
      // mesh. On-the-ground would drop every roof fixture ~55 m. Only set when
      // the scene left it alone, since the offset is part of the same tuning.
      if (!layer.elevationInfo) layer.elevationInfo = { mode: "absolute-height", offset: 0 };
      console.info(`[Lights] ${layer.title}: applied fallback 3D symbology`);
    }

    if (!layer.popupTemplate) layer.popupTemplate = popup();
  });
}
