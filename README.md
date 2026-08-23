# Sports Venue Digital Twin

An example digital twin of Empower Field at Mile High. Drone and
hand-held reality captures — Gaussian splats and integrated meshes — georeferenced
into one scene, lit by live weather and the real position of the sun, with two
replays driven by actual sports tracking data.

**Live:** https://b-connolly.github.io/sports-venue-digital-twin/

---

## What's in it

- **Captures** — toggle each splat and mesh independently
- **Views** — saved viewpoints from the scene, with a slideshow
- **Live action** — two replays on the field: an NFL touchdown and a football goal,
  each with fan, broadcast and follow-the-ball cameras
- **Analysis** — distance, area, volume and elevation profile against the captures
- **Time of day** — scrub the sun; stadium lights come on after dark
- **Conditions** — live weather at the venue drives the sky

## Built with

[ArcGIS Maps SDK for JavaScript 5.x](https://developers.arcgis.com/javascript/latest/),
loaded as ES modules from the CDN. No build step and no dependencies to install.

| | |
|---|---|
| [SceneView](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-SceneView.html) / [WebScene](https://developers.arcgis.com/javascript/latest/api-reference/esri-WebScene.html) | the scene, its saved slides and layer list |
| [Mesh](https://developers.arcgis.com/javascript/latest/api-reference/esri-geometry-Mesh.html) + [MeshTransform](https://developers.arcgis.com/javascript/latest/api-reference/esri-geometry-support-MeshTransform.html) | players, ball, goals and uprights, moved per frame |
| [RenderNode](https://developers.arcgis.com/javascript/latest/api-reference/esri-views-3d-webgl-RenderNode.html) | custom render pass for the night sky |
| [Measurement widgets](https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-DirectLineMeasurement3D.html) + [VolumeMeasurementAnalysis](https://developers.arcgis.com/javascript/latest/api-reference/esri-analysis-VolumeMeasurementAnalysis.html) | distance, area, volume, profile |
| [TimeSlider](https://developers.arcgis.com/javascript/latest/api-reference/esri-widgets-TimeSlider.html) | time of day |

The captures were processed with
[ArcGIS Reality](https://www.esri.com/en-us/arcgis/products/arcgis-reality/overview)
(drone) and [Pix4Dcatch](https://www.pix4d.com/product/pix4dcatch/) (hand-held).

## Data

| | |
|---|---|
| [NFL Big Data Bowl](https://github.com/nfl-football-ops/Big-Data-Bowl) | American football tracking, 10 Hz, all 22 players and the ball |
| [Metrica Sports sample data](https://github.com/metrica-sports/sample-data) | football tracking, 25 Hz, anonymised at source |
| [NASA SVS Deep Star Maps 2020](https://svs.gsfc.nasa.gov/4851) | night sky texture, public domain |
| [Open-Meteo](https://open-meteo.com) | live conditions at the venue |

Both replays are real movement, not animation. Names and squad numbers are
stripped from the data before it ships, and no team is identified in the animated data despite being based on real-world events and actual data. The Denver Broncos are only highlighted by the capture data with permission from City of Denver to use in demos and marketing materials. See [`NOTICE`](NOTICE).

