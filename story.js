// Widening the Frame: the story for each stop.
// EDIT FREELY: every word here is a Draft 1 placeholder drafted with Claude from Ian's
// proposal (11/9) and midterm. Rewrite in your own voice before the final.
// Places: farm, chadwick, quarry (Pop-Up, Wednesdays), selib (Pop-Up, Fridays). Coordinates are metres
// from the centre of the map (x east, y north).
// view: { at: site key or [x, y], dist: metres from target, pitch: degrees above horizontal, heading: degrees (0 = looking north) }
// frame: how wide the lit "frame" is in metres (the rest of the map dims). null = no frame.
// layers: which map layers this stop turns on (the reader can still toggle them).

export const STOPS = [
  {
    id: "intro",
    mapNote: "Whole campus: the Farm sits at the bottom, the Pop-Up and Chadwick Garden up the hill",
    eyebrow: "ENVS 143 · A record of transformation",
    title: "Widening the Frame",
    body: [
      "I photograph the UCSC Farm for a living. My job is to make it look like a place you want to visit and support.",
      "This walk starts inside one of those photos and keeps pulling the frame back, one reading at a time, until the map runs out.",
    ],
    view: { at: [-20, -420], dist: 3600, pitch: 24, heading: 172 },
    frame: null,
    layers: { frame: true },
    intro: true,
  },
  {
    id: "rows",
    mapNote: "Gold frame = what my CfA photos usually show",
    place: "UCSC Farm",
    eyebrow: "Stop 1 · UCSC Farm",
    title: "The frame I'm paid to make",
    body: [
      "This is where my pictures usually start: long rows, soft fog light, nobody looking at the camera.",
      "It's a true picture. It just isn't the whole one.",
    ],
    media: [
      { type: "photo", src: "media/farm_rows.jpg", thumb: "media/farm_rows_t.jpg", caption: "Rows at the Farm, October 21, 2026", w: 1333, h: 2000 },
      { type: "photo", src: "media/farm_carrots.jpg", thumb: "media/farm_carrots_t.jpg", caption: "Carrots coming out of the bed, October 21", w: 2000, h: 1333 },
      { type: "photo", src: "media/farm_dahlias.jpg", thumb: "media/farm_dahlias_t.jpg", caption: "Dahlias, September 2, 2026", w: 2000, h: 1333 },
      { type: "photo", src: "media/farm_apples.jpg", thumb: "media/farm_apples_t.jpg", caption: "Apples on the tree, September 2", w: 2000, h: 1333 },
    ],
    view: { at: "farm", dist: 760, pitch: 36, heading: 14 },
    frame: 240,
    layers: { frame: true },
  },
  {
    id: "work",
    mapNote: "The frame widens: the people and work around the rows",
    place: "UCSC Farm",
    eyebrow: "Stop 2 · UCSC Farm",
    title: "Who's in the rows",
    body: [
      "Pull back a little and the rows are full of people. Students and apprentices do the planting, the weeding and the harvest.",
      "Esteva (1992) showed me how the word \"development\" stops meaning progress and starts sorting people into ahead and behind. A teaching farm can slip into that too, as the one right way to grow food. I want my photos to show the people doing the work, not just the model.",
    ],
    readings: ["Esteva (1992)"],
    media: [
      { type: "photo", src: "media/farm_harvest.jpg", thumb: "media/farm_harvest_t.jpg", caption: "Carrot harvest, October 21", w: 2000, h: 1333 },
      { type: "photo", src: "media/farm_field_worker.jpg", thumb: "media/farm_field_worker_t.jpg", caption: "In the carrot field, October 21", w: 1333, h: 2000 },
      { type: "photo", src: "media/farm_tractor.jpg", thumb: "media/farm_tractor_t.jpg", caption: "Transplanting with the tractor crew, September 2026", w: 1334, h: 2000 },
      { type: "photo", src: "media/farm_persimmon.jpg", thumb: "media/farm_persimmon_t.jpg", caption: "Persimmons, with the hoop houses behind", w: 2000, h: 1333 },
    ],
    view: { at: "farm", dist: 950, pitch: 33, heading: -28 },
    frame: 260,
    layers: { frame: true },
  },
  {
    id: "water",
    mapNote: "Dry-farm plot on the Farm (exact spot approximate)",
    place: "UCSC Farm · dry farm plot",
    eyebrow: "Stop 3 · Dry farm",
    title: "Growing on what's already in the ground",
    body: [
      "Dry-farmed tomatoes get almost no irrigation once they're established. Their roots go down after the water the soil held from winter.",
      "Sachs (1992) warns that \"environment\" can become one more resource to manage. This plot reads more like a relationship you have to listen to.",
    ],
    readings: ["Sachs (1992)"],
    note: "Pin placed on the Farm; exact plot to confirm.",
    media: [
      { type: "video", src: "media/dryfarm_rows.mp4", poster: "media/dryfarm_rows_poster.jpg", caption: "Dry farm rows, July 30, 2026", w: 720, h: 1280 },
      { type: "video", src: "media/dryfarm_tomato.mp4", poster: "media/dryfarm_tomato_poster.jpg", caption: "Checking the tomatoes", w: 720, h: 1280 },
      { type: "photo", src: "media/dryfarm_staked.jpg", thumb: "media/dryfarm_staked_t.jpg", caption: "Staked dry-farmed tomato rows, September 2, 2026", w: 2000, h: 1333 },
      { type: "photo", src: "media/dryfarm_fieldday.jpg", thumb: "media/dryfarm_fieldday_t.jpg", caption: "Dry Farmed Tomato Field Day, September 2026", w: 2000, h: 1333 },
      { type: "photo", src: "media/dryfarm_haybarn.jpg", thumb: "media/dryfarm_haybarn_t.jpg", caption: "A talk in the hay barn at the field day", w: 1333, h: 2000 },
    ],
    view: { at: "farm", dist: 1350, pitch: 30, heading: 150 },
    frame: 420,
    layers: { frame: true },
  },
  {
    id: "chadwick",
    mapNote: "Alan Chadwick Garden, started 1967, up the hill from the Farm",
    place: "Alan Chadwick Garden",
    eyebrow: "Stop 4 · Alan Chadwick Garden",
    title: "Where the story usually starts",
    body: [
      "Up the hill is the Alan Chadwick Garden, started in 1967. The official story of organic farming at UCSC starts here.",
      "But 1967 isn't the beginning. Before the university, this hillside was the Cowell lime ranch, and long before that it was Awaswas land. The garden is one layer, not the bottom one.",
    ],
    media: [
      { type: "photo", src: "media/chadwick_interns.jpg", thumb: "media/chadwick_interns_t.jpg", caption: "Interns in the Chadwick Garden beds, February 4, 2026", w: 2000, h: 1333 },
      { type: "photo", src: "media/chadwick_dig.jpg", thumb: "media/chadwick_dig_t.jpg", caption: "Turning a bed", w: 2000, h: 1333 },
      { type: "photo", src: "media/chadwick_label.jpg", thumb: "media/chadwick_label_t.jpg", caption: "A plant label in the bed", w: 1333, h: 2000 },
    ],
    view: { at: "chadwick", dist: 1050, pitch: 31, heading: 196 },
    frame: 760,
    layers: { frame: true, campus: true },
  },
  {
    id: "route",
    mapNote: "Gold line = the produce's route, Farm to Quarry Plaza",
    place: "Farm → Quarry Plaza",
    eyebrow: "Stop 5 · The route",
    title: "The food walks uphill",
    body: [
      "Produce from the Farm goes up campus to the Produce Pop-Up. By path it's {farm_quarry_km} km and about {farm_quarry_climb} m of climb.",
      "Turn on Campus and you can see what grew up around the Farm. Sachs (1992) made me notice how \"sustainable\" can become a reason to keep building. The Farm is the green part of a university that keeps growing.",
    ],
    readings: ["Sachs (1992)"],
    route: "farm_quarry",
    view: { at: [-110, -150], dist: 3000, pitch: 38, heading: 200 },
    frame: 1250,
    layers: { frame: true, campus: true, route: true },
  },
  {
    id: "popup",
    mapNote: "Pop-Up: Quarry Plaza on Wednesdays, Science Hill on Fridays",
    place: "Produce Pop-Up",
    eyebrow: "Stop 6 · Produce Pop-Up",
    title: "Who the Farm feeds",
    body: [
      "On Wednesdays the Pop-Up sets up in Quarry Plaza, and on Fridays outside the Science & Engineering Library. The sign says \"Affordable organic produce from the UCSC Student Farm.\"",
      "Cheap kale helps. It doesn't change why so many students here can't afford food. The line at the table is part of the Farm's picture too.",
    ],
    media: [
      { type: "video", src: "media/popup_wide.mp4", poster: "media/popup_wide_poster.jpg", caption: "Quarry Plaza, Wednesday, November 4, 2026", w: 720, h: 1280 },
      { type: "video", src: "media/popup_sign.mp4", poster: "media/popup_sign_poster.jpg", caption: "The sign", w: 720, h: 1280 },
      { type: "video", src: "media/popup_kale.mp4", poster: "media/popup_kale_poster.jpg", caption: "Kale on the table", w: 720, h: 1280 },
    ],
    view: { at: "quarry", dist: 720, pitch: 32, heading: 140 },
    frame: 1600,
    layers: { frame: true, campus: true, route: true },
  },
  {
    id: "beyond",
    mapNote: "No frame, no outlines: one continuous land",
    place: "The whole map",
    eyebrow: "Stop 7 · Beyond the map",
    title: "What this map can't show",
    body: [
      "Everything on this map sits on the unceded territory of the Awaswas-speaking Uypi Tribe. The Amah Mutsun Tribal Band is working to bring back traditional care of this land.",
      "Hazlewood (2023) writes about what is \"beyond the map\": the struggles and relationships official maps leave out. I can't draw that as a line, so I won't. Instead the map lets go of its own outlines.",
      "The Universal Declaration of the Rights of Mother Earth (2010) asks what it would mean for this land and water to have rights of their own. I still think the Farm does real good. Now I also ask whose land it is, who does the work, and who is left out of the picture.",
    ],
    readings: ["Hazlewood (2023)", "Rights of Mother Earth (2010)"],
    view: { at: [0, -600], dist: 5600, pitch: 30, heading: 172 },
    frame: null,
    layers: { beyond: true },
    end: true,
  },
];

export const SITES = {
  farm: { label: "UCSC Farm" },
  chadwick: { label: "Chadwick Garden" },
  quarry: { label: "Pop-Up · Wed" },
  selib: { label: "Pop-Up · Fri" },
};

export const LAYERS = [
  { id: "frame", name: "The CfA frame", hint: "Farm, garden and Pop-Up outlines" },
  { id: "campus", name: "Campus", hint: "Buildings around the Farm" },
  { id: "route", name: "Food route", hint: "Farm to Quarry Plaza" },
  { id: "beyond", name: "Beyond the map", hint: "Awaswas · Uypi land" },
];

export const REFERENCES = [
  "Esteva, G. (1992). Development. In W. Sachs (Ed.), The development dictionary: A guide to knowledge as power. Zed Books.",
  "Hazlewood, J. A. (2023). Be(y)on(d) the map: Collaboratively activating geographies of (De)CO2loniality/H2Ope in the Ecuadorian Chocó borderlands. Environment and Planning E: Nature and Space, 6(3), 1463–1500. https://doi.org/10.1177/25148486231182994",
  "Sachs, W. (1992). Environment. In W. Sachs (Ed.), The development dictionary: A guide to knowledge as power. Zed Books.",
  "World People's Conference on Climate Change and the Rights of Mother Earth. (2010). Universal declaration of the rights of Mother Earth.",
  "Anthropic. (2026). Claude [Large language model]. https://claude.ai",
];
