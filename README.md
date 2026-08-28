# Sports Venue Digital Twin

An example digital twin of Empower Field at Mile High. Drone and
hand-held reality captures — Gaussian splats and integrated meshes — georeferenced
into one scene, lit by live weather and the real position of the sun, with two
replays driven by actual sports tracking data.

<img width="900" height=auto alt="milehigh" src="https://github.com/user-attachments/assets/feee15c4-1ed4-4475-9b52-4ca956f02644" />

**Live:** https://b-connolly.github.io/sports-venue-digital-twin/


---

## What's in it

- **Captures** — toggle each splat and mesh independently
- **Views** — saved viewpoints from the scene, with a slideshow that runs
  itself, and a name you can press to jump straight to any view rather than
  step through the ones between. The two replay views hold until the passage
  they opened has actually finished rather than for a fixed count, so nothing
  is cut off mid-throw — and then the show hands itself back, because the end
  of a replay is where you want to scrub through it rather than be moved along.
  Changing the play or the camera stands it down for the same reason. The play
  button pulses whenever it is the thing to press. The move from the night sky
  to the statues is flown rather than cut: a slow arc round the outside of the
  stadium with the sun coming up over it, which also gives the handheld captures
  at the far end the length of the shot to load
- **Live action** — six replays on the field: pick a sport, then a passage.
  American football gives a deep pass, a running touchdown and a record-distance
  field goal; football gives a tackle worked to a finish, a cross headed in, and an
  interception broken the length of the pitch. Each has fan, broadcast and
  follow-the-ball cameras. While a passage is running and the pointer is
  elsewhere the panel folds to a strip and dims, and comes back the moment you
  point at it
- **Draw Play** — the play chalked onto the field as it develops, playbook style.
  American football draws every route from the snap; the moment the ball is
  caught, the route that worked turns orange along its whole length and the rest
  stay where they are. Football draws only the goal: the delivery in, the finish,
  and a ring on the man at each end of them
- **View from a seat** — pick any of the 135 sections and sit in it, from the
  front row of the lower bowl to the back of the 500s. Drag to look around from
  where you are sitting rather than to move; the view follows the ball gently
  and hands back the moment you take hold of it
- **Analysis** — distance, area, volume and elevation profile tools
- **Time of day** — scrub the sun; the floodlights come on by themselves after
  dark and can be switched on by hand at any hour, because a bowl is its own
  shade and a low morning sun still leaves the ground dim. `‹ ›` step the day,
  up to a week ahead
- **Conditions** — live weather at the venue drives the sky, or pick your own:
  clear, cloudy, rain, snow that lies, fog. Step the clock past today and the
  sky follows the hourly forecast there — so the venue can be seen under the
  conditions it is going to have, labelled as a forecast rather than as a
  reading

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
| [GraphicsLayer](https://developers.arcgis.com/javascript/latest/api-reference/esri-layers-GraphicsLayer.html) + [LineSymbol3D](https://developers.arcgis.com/javascript/latest/api-reference/esri-symbols-LineSymbol3D.html) | the play diagram, redrawn each frame |

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

