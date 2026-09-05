// Seed spot data. See HANDOFF.md for provenance notes — most of these were
// re-verified against real sources, a few were corrected (see git history).
//
// `swellWindow: [from, to]` is the compass arc (clockwise) a spot actually receives swell
// from, and `bestTide` is the tide it works best on ('low' | 'mid' | 'high' | 'all'). Both are
// optional: spots without them fall back to an arc derived from `offshoreDeg` — see
// lib/spotmodel.js, which explains why the derived arc is only a starting point and why the
// rule it replaced actively penalised the best waves in this list.
export const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA', blurb: 'Cobblestone point wrapping into long, workable walls. Best before the wind fills in.', lat: 33.3825, lon: -117.5972, offshoreDeg: 60, swellWindow: [180, 230], bestTide: 'mid' },
  blacks: { name: 'Blacks Beach', region: 'La Jolla, CA', blurb: 'Deep submarine canyon keeps it offshore-groomed most of the day. Powerful and hollow.', lat: 32.8991, lon: -117.2528, offshoreDeg: 90, swellWindow: [260, 310], bestTide: 'all' },
  rincon: { name: 'Rincon', region: 'Santa Barbara, CA', blurb: 'Long, playful walls peeling down the point. Small today, but silky smooth.', lat: 34.3739, lon: -119.4763, offshoreDeg: 350, swellWindow: [260, 310], bestTide: 'mid' },
  wedge: { name: 'The Wedge', region: 'Newport Beach, CA', blurb: 'Ledgy, close-interval peaks off the jetty. Heavy, and not for the faint of heart.', lat: 33.5952, lon: -117.8822, offshoreDeg: 30, swellWindow: [180, 230], bestTide: 'all' },
  pipeline: { name: 'Pipeline', region: 'Oahu, Hawaii', blurb: "World-famous reef barrel on the North Shore. Heavy, shallow, and unforgiving when it's on.", lat: 21.6647, lon: -158.0538, offshoreDeg: 200, swellWindow: [290, 350], bestTide: 'mid' },
  teahupoo: { name: "Teahupo'o", region: 'Tahiti, French Polynesia', blurb: 'One of the heaviest, thickest waves on the planet, breaking over shallow coral.', lat: -17.8570, lon: -149.2680, offshoreDeg: 20, swellWindow: [190, 230], bestTide: 'low' },
  jbay: { name: 'Jeffreys Bay', region: 'Eastern Cape, South Africa', blurb: 'Long, high-speed right point — one of the best walls in the world when it lines up.', lat: -34.0489, lon: 24.9087, offshoreDeg: 325, swellWindow: [190, 240], bestTide: 'all' },
  uluwatu: { name: 'Uluwatu', region: 'Bali, Indonesia', blurb: "Dramatic reef break beneath a clifftop temple, with several sections down the point.", lat: -8.8290, lon: 115.0870, offshoreDeg: 50, swellWindow: [200, 250], bestTide: 'mid' },
  snapper: { name: 'Snapper Rocks', region: 'Gold Coast, Australia', blurb: 'The Superbank — impossibly long, fast right points when the sand banks line up.', lat: -28.1590, lon: 153.5470, offshoreDeg: 250, swellWindow: [100, 160], bestTide: 'all' },
  nazare: { name: 'Nazaré', region: 'Portugal', blurb: 'Home to some of the biggest waves ever surfed, thanks to an underwater canyon offshore.', lat: 39.6033, lon: -9.0705, offshoreDeg: 85, swellWindow: [280, 330], bestTide: 'all' },
  chicama: { name: 'Chicama', region: 'La Libertad, Peru', blurb: 'The longest left-hand point wave in the world — rides can last over a minute.', lat: -7.7000, lon: -79.4500, offshoreDeg: 135, swellWindow: [190, 230], bestTide: 'all' },
  raglan: { name: 'Raglan', region: 'Waikato, New Zealand', blurb: 'Classic left point break, one of the most consistent walls in the Southern Hemisphere.', lat: -37.8010, lon: 174.8710, offshoreDeg: 95, swellWindow: [220, 270], bestTide: 'mid' },
  puertoescondido: { name: 'Puerto Escondido', region: 'Oaxaca, Mexico', blurb: "Nicknamed the Mexican Pipeline — a powerful, sandy-bottom beach break barrel.", lat: 15.8720, lon: -97.0767, offshoreDeg: 15, swellWindow: [170, 220], bestTide: 'all' },
  hossegor: { name: 'Hossegor', region: 'France', blurb: 'Punchy, powerful Atlantic beach breaks that host a stop on the world tour.', lat: 43.6640, lon: -1.4400, offshoreDeg: 90, swellWindow: [260, 320], bestTide: 'all' },
  mundaka: { name: 'Mundaka', region: 'Basque Country, Spain', blurb: 'A world-class left river-mouth wave that peels around a sandbar.', lat: 43.4070, lon: -2.6990, offshoreDeg: 180, swellWindow: [300, 340], bestTide: 'mid' },
  cloudbreak: { name: 'Cloudbreak', region: 'Mamanuca Islands, Fiji', blurb: 'A world-class reef pass left, breaking over shallow coral in the open ocean.', lat: -17.8600, lon: 177.2000, offshoreDeg: 130, swellWindow: [180, 230], bestTide: 'mid' },
  skeletonbay: { name: 'Skeleton Bay', region: 'Namibia', blurb: 'A freakishly long, mechanical sand-point left along a remote desert coastline.', lat: -22.9590, lon: 14.4930, offshoreDeg: 165, swellWindow: [200, 240], bestTide: 'all' },
  pavones: { name: 'Pavones', region: 'Golfo Dulce, Costa Rica', blurb: 'One of the longest lefts in the world, wrapping into a jungle-lined bay.', lat: 8.3830, lon: -83.1500, offshoreDeg: 25, swellWindow: [180, 230], bestTide: 'mid' },
  fistral: { name: 'Fistral Beach', region: 'Newquay, Cornwall, UK', blurb: "The UK's best-known beach break, exposed to the full force of the Atlantic.", lat: 50.4160, lon: -5.1020, offshoreDeg: 90, swellWindow: [260, 320], bestTide: 'all' },
  anchorpoint: { name: 'Anchor Point', region: 'Taghazout, Morocco', blurb: 'A classic North African right point, long and mellow when it wraps in clean.', lat: 30.5460, lon: -9.7100, offshoreDeg: 85, swellWindow: [280, 330], bestTide: 'mid' },
  margaretriver: { name: 'Margaret River', region: 'Western Australia', blurb: 'Powerful, chilly reef and point breaks along a wild stretch of coastline.', lat: -33.9750, lon: 115.0750, offshoreDeg: 90, swellWindow: [200, 250], bestTide: 'all' },
  montauk: { name: 'Montauk', region: 'New York, USA', blurb: 'Classic East Coast beach and reef breaks at the tip of Long Island.', lat: 41.0500, lon: -71.9200, offshoreDeg: 330 },
  arugambay: { name: 'Arugam Bay', region: 'Sri Lanka', blurb: "A long, sandy-bottomed right point on Sri Lanka's east coast.", lat: 6.8400, lon: 81.8300, offshoreDeg: 270, swellWindow: [130, 200], bestTide: 'all' },
  gland: { name: 'G-Land', region: 'East Java, Indonesia', blurb: 'A legendary, remote left reef break inside a jungle bay.', lat: -8.7304, lon: 114.3526, offshoreDeg: 35, swellWindow: [190, 230], bestTide: 'mid' },
  siargao: { name: 'Siargao (Cloud 9)', region: 'Philippines', blurb: 'A hollow, powerful reef pass that put the Philippines on the surfing map.', lat: 9.8000, lon: 126.1660, offshoreDeg: 270, swellWindow: [40, 110], bestTide: 'mid' },
  ericeira: { name: 'Ericeira', region: 'Portugal', blurb: 'A World Surfing Reserve with a cluster of quality points and reefs.', lat: 38.9630, lon: -9.4160, offshoreDeg: 90, swellWindow: [270, 330], bestTide: 'all' },
  desertpoint: { name: 'Desert Point', region: 'Lombok, Indonesia', blurb: 'One of the fastest, longest tube rides on Earth, over sharp reef.', lat: -8.8900, lon: 116.0400, offshoreDeg: 60, swellWindow: [190, 230], bestTide: 'low' },
  tofino: { name: 'Tofino', region: 'Vancouver Island, Canada', blurb: 'Cold-water Pacific beach breaks framed by old-growth rainforest.', lat: 49.1530, lon: -125.9066, offshoreDeg: 90 },
  joaquina: { name: 'Joaquina', region: 'Florianópolis, Brazil', blurb: 'A popular sandy beach break on Floripa island, consistent and crowd-friendly.', lat: -27.6280, lon: -48.4480, offshoreDeg: 270 },
  puntadelobos: { name: 'Punta de Lobos', region: 'Pichilemu, Chile', blurb: "A powerful, rocky left point on Chile's rugged central coast.", lat: -34.4110, lon: -72.0270, offshoreDeg: 90 },
  shonan: { name: 'Shonan', region: 'Kanagawa, Japan', blurb: "Tokyo's home break — accessible and consistent, a train ride from the city.", lat: 35.3060, lon: 139.4870, offshoreDeg: 0 },
  kovalam: { name: 'Kovalam', region: 'Kerala, India', blurb: "A mellow beach break on India's southwestern coast, warm water year-round.", lat: 8.4004, lon: 76.9787, offshoreDeg: 90 },
  caesarea: { name: 'Caesarea', region: 'Israel', blurb: 'A Mediterranean reef break beside the ruins of an ancient Roman harbor.', lat: 32.5000, lon: 34.9040, offshoreDeg: 90, swellWindow: [240, 330], bestTide: 'all' },
  elcotillo: { name: 'El Cotillo', region: 'Fuerteventura, Canary Islands', blurb: "Wind-sculpted beach breaks on the island's rugged north coast.", lat: 28.6800, lon: -14.0080, offshoreDeg: 165 },
  popoyo: { name: 'Popoyo', region: 'Nicaragua', blurb: "A hollow reef break on Nicaragua's Pacific coast, offshore almost every morning.", lat: 11.4731, lon: -86.1270, offshoreDeg: 90 },
  santacatalina: { name: 'Santa Catalina', region: 'Panama', blurb: "A powerful, rocky point break on Panama's Pacific coast.", lat: 7.6330, lon: -81.2680, offshoreDeg: 85 },
  deadmans: { name: 'Deadmans', region: 'Denmark', blurb: "A cold-water North Sea break in Denmark's surf region, best with a groundswell and light wind.", lat: 57.0500, lon: 8.5100, offshoreDeg: 90 },
  muine: { name: 'Mui Ne', region: 'Vietnam', blurb: 'A wind-exposed stretch of coast better known for kitesurfing, but surfable too.', lat: 10.9330, lon: 108.2830, offshoreDeg: 293 },
  laentrada: { name: 'La Entrada', region: 'Ecuador', blurb: "A sandy beach break at the north end of the Olón beach stretch, gentle and beginner-friendly.", lat: -1.7700, lon: -80.7700, offshoreDeg: 90 },
  montoya: { name: 'Montoya', region: 'Punta del Este, Uruguay', blurb: "A rocky point near Punta del Este, one of Uruguay's better-known breaks.", lat: -34.9500, lon: -54.9300, offshoreDeg: 350 },
  darne: { name: 'Darne', region: 'Mauritius', blurb: "A remote left reef break behind Île des Deux Cocos, inside the island's fringing coral.", lat: -20.4200, lon: 57.7000, offshoreDeg: 0 },
  capesolander: { name: 'Cape Solander', region: 'Sydney, Australia', blurb: "An exposed ledge break on the cliffs at Sydney's Kurnell headland.", lat: -34.0010, lon: 151.2330, offshoreDeg: 270 },
  masnou: { name: 'Masnou', region: 'Catalonia, Spain', blurb: 'A Mediterranean beach break just north of Barcelona, small but rideable on a good day.', lat: 41.4780, lon: 2.3160, offshoreDeg: 315 },
  capomarina: { name: 'Capo Marina', region: 'Genoa, Italy', blurb: 'A rocky point break on the Ligurian coast near Genoa.', lat: 44.4000, lon: 8.9500, offshoreDeg: 5 },

  // Second batch — added on request to expand geographic coverage. Same caveat as the
  // original 44: reasonable estimates from available sources, not surveyed. Coordinates for
  // the least-documented of these (Macaronis, Riyue Bay) were verified against cited sources;
  // Lagundri Bay and Jinzun are lower-confidence estimates (no precise published coordinates
  // found) placed near the nearest documented reference point.
  malibu: { name: 'Malibu (Surfrider Beach)', region: 'California, USA', blurb: 'A classic, mechanical right point that helped define modern longboarding.', lat: 34.0369, lon: -118.6786, offshoreDeg: 0, swellWindow: [180, 230], bestTide: 'mid' },
  steamerlane: { name: 'Steamer Lane', region: 'Santa Cruz, CA', blurb: 'A punchy reef/point off a cliffside lighthouse, the heart of Santa Cruz surfing.', lat: 36.9519, lon: -122.0247, offshoreDeg: 30, swellWindow: [260, 320], bestTide: 'mid' },
  mavericks: { name: 'Mavericks', region: 'Half Moon Bay, CA', blurb: 'A cold-water big-wave reef that only wakes up on serious winter swells.', lat: 37.4913, lon: -122.5025, offshoreDeg: 90, swellWindow: [270, 320], bestTide: 'mid' },
  waimeabay: { name: 'Waimea Bay', region: 'Oahu, Hawaii', blurb: "Hawaii's original big-wave proving ground, dormant until the swell is massive.", lat: 21.6392, lon: -158.0656, offshoreDeg: 180, swellWindow: [300, 350], bestTide: 'all' },
  sunsetbeach: { name: 'Sunset Beach', region: 'Oahu, Hawaii', blurb: 'A shifting, powerful North Shore peak that punishes poor positioning.', lat: 21.6754, lon: -158.0400, offshoreDeg: 180, swellWindow: [300, 350], bestTide: 'all' },
  honoluabay: { name: 'Honolua Bay', region: 'Maui, Hawaii', blurb: 'A picture-perfect right point wrapping into a protected jungle bay.', lat: 21.0067, lon: -156.6403, offshoreDeg: 135 },
  hookipa: { name: 'Hookipa', region: 'Maui, Hawaii', blurb: 'Powerful reef break better known today as a windsurfing/kite mecca.', lat: 20.9330, lon: -156.3580, offshoreDeg: 180 },
  sayulita: { name: 'Sayulita', region: 'Nayarit, Mexico', blurb: 'A friendly, playful beach and point break inside a laid-back fishing village.', lat: 20.8700, lon: -105.4419, offshoreDeg: 45 },
  barradelacruz: { name: 'Barra de la Cruz', region: 'Oaxaca, Mexico', blurb: 'A world-class right point through a village-owned reserve, long and rippable.', lat: 15.9280, lon: -96.0670, offshoreDeg: 0 },
  playahermosa: { name: 'Playa Hermosa', region: 'Puntarenas, Costa Rica', blurb: "Costa Rica's most consistent beach break, powerful and popular with pros in training.", lat: 9.5480, lon: -84.5820, offshoreDeg: 45 },
  witchsrock: { name: "Witch's Rock", region: 'Guanacaste, Costa Rica', blurb: 'A remote national-park beach break made famous by Endless Summer II.', lat: 10.7990, lon: -85.6870, offshoreDeg: 90, swellWindow: [200, 250], bestTide: 'all' },
  salsabrava: { name: 'Salsa Brava', region: 'Puerto Viejo, Costa Rica', blurb: "Costa Rica's heaviest wave, a shallow Caribbean reef pass not for beginners.", lat: 9.6550, lon: -82.7530, offshoreDeg: 270 },
  elsunzal: { name: 'El Sunzal', region: 'La Libertad, El Salvador', blurb: "A long, forgiving right point — one of Central America's best learn-to-surf waves.", lat: 13.4930, lon: -89.4460, offshoreDeg: 0, swellWindow: [180, 230], bestTide: 'mid' },
  puntaroca: { name: 'Punta Roca', region: 'La Libertad, El Salvador', blurb: "El Salvador's premier point break, a long, powerful right along a rocky headland.", lat: 13.4880, lon: -89.3220, offshoreDeg: 0 },
  picoalto: { name: 'Pico Alto', region: 'Punta Hermosa, Peru', blurb: "One of South America's premier big-wave reef breaks, south of Lima.", lat: -12.3330, lon: -76.8250, offshoreDeg: 90 },
  mancora: { name: 'Máncora', region: 'Piura, Peru', blurb: 'A long, warm-water left point in a lively northern Peru beach town.', lat: -4.1080, lon: -81.0480, offshoreDeg: 75 },
  guardadoembau: { name: 'Guarda do Embaú', region: 'Santa Catarina, Brazil', blurb: 'A river-mouth right point inside a protected coastal village.', lat: -27.9500, lon: -48.5830, offshoreDeg: 270 },
  itacare: { name: 'Itacaré', region: 'Bahia, Brazil', blurb: 'Jungle-backed beach breaks and points along a laid-back Bahia coastline.', lat: -14.2780, lon: -38.9960, offshoreDeg: 270 },
  rinconpr: { name: 'Rincón', region: 'Puerto Rico', blurb: "Puerto Rico's best-known surf town, with a string of reef and point breaks.", lat: 18.3400, lon: -67.2510, offshoreDeg: 90 },
  soupbowl: { name: 'Soup Bowl', region: 'Bathsheba, Barbados', blurb: "Barbados's premier wave, a punchy Atlantic-facing reef.", lat: 13.2170, lon: -59.5180, offshoreDeg: 270 },
  lasanta: { name: 'La Santa', region: 'Lanzarote, Canary Islands', blurb: 'A powerful, volcanic-reef left on a rugged, wind-exposed coast.', lat: 29.1330, lon: -13.7330, offshoreDeg: 165 },
  elconfital: { name: 'El Confital', region: 'Gran Canaria, Canary Islands', blurb: 'A long left point wrapping around a quiet stretch near Las Palmas.', lat: 28.1580, lon: -15.4460, offshoreDeg: 135 },
  supertubos: { name: 'Supertubos', region: 'Peniche, Portugal', blurb: 'A world-class, barreling beach break that hosts a stop on the world tour.', lat: 39.3490, lon: -9.3830, offshoreDeg: 90, swellWindow: [270, 330], bestTide: 'all' },
  amado: { name: 'Praia do Amado', region: 'Algarve, Portugal', blurb: 'An exposed, reliable beach break near Sagres, a Euro surf-trip staple.', lat: 37.1810, lon: -8.9080, offshoreDeg: 90 },
  thursoeast: { name: 'Thurso East', region: 'Scotland, UK', blurb: 'A cold-water reef point that put Scottish surfing on the map.', lat: 58.5950, lon: -3.5140, offshoreDeg: 180, swellWindow: [340, 50], bestTide: 'mid' },
  bundoran: { name: 'Bundoran', region: 'Donegal, Ireland', blurb: "A cluster of reef and beach breaks along Ireland's rugged northwest.", lat: 54.4780, lon: -8.2830, offshoreDeg: 90 },
  lacanau: { name: 'Lacanau', region: 'France', blurb: 'A wide, exposed Atlantic beach break and French surf-culture hub.', lat: 44.9810, lon: -1.2030, offshoreDeg: 90 },
  anglet: { name: 'Anglet', region: 'France', blurb: "A string of jettied beach breaks next to Biarritz, France's surf capital.", lat: 43.4930, lon: -1.5280, offshoreDeg: 90 },
  dungeons: { name: 'Dungeons', region: 'Hout Bay, South Africa', blurb: 'A cold, shark-rich big-wave reef reserved for the heaviest South African swells.', lat: -34.0500, lon: 18.3460, offshoreDeg: 45, swellWindow: [200, 250], bestTide: 'all' },
  elandsbay: { name: 'Elands Bay', region: 'Western Cape, South Africa', blurb: 'A long, cold-water left point on a remote stretch of West Coast.', lat: -32.3110, lon: 18.3330, offshoreDeg: 90 },
  padangpadang: { name: 'Padang Padang', region: 'Bali, Indonesia', blurb: 'A short, intense left barrel through a narrow reef slot.', lat: -8.8110, lon: 115.1050, offshoreDeg: 45, swellWindow: [200, 250], bestTide: 'mid' },
  keramas: { name: 'Keramas', region: 'Bali, Indonesia', blurb: 'A fast, punchy right reef break that hosts a world tour event.', lat: -8.5580, lon: 115.3480, offshoreDeg: 0 },
  lakeypeak: { name: 'Lakey Peak', region: 'Sumbawa, Indonesia', blurb: "A powerful A-frame reef peak, one of Sumbawa's best-known waves.", lat: -8.8830, lon: 118.5170, offshoreDeg: 0 },
  lagundribay: { name: 'Lagundri Bay', region: 'Nias, Indonesia', blurb: 'A long, hollow right point inside a horseshoe bay — one of the original Indonesian surf discoveries.', lat: 0.5580, lon: 97.7900, offshoreDeg: 0, swellWindow: [170, 220], bestTide: 'mid' },
  macaronis: { name: 'Macaronis', region: 'Mentawai Islands, Indonesia', blurb: 'A fun, rippable left reef widely rated among the most enjoyable waves on the planet.', lat: -2.7783, lon: 99.9842, offshoreDeg: 90, swellWindow: [180, 230], bestTide: 'all' },
  bellsbeach: { name: 'Bells Beach', region: 'Victoria, Australia', blurb: 'A powerful, historic right point and home to the longest-running pro surf contest.', lat: -38.3690, lon: 144.2830, offshoreDeg: 0, swellWindow: [190, 240], bestTide: 'mid' },
  byronbay: { name: 'The Pass, Byron Bay', region: 'New South Wales, Australia', blurb: 'A long, easy right point wrapping around a lighthouse headland.', lat: -28.6350, lon: 153.6280, offshoreDeg: 250 },
  angourie: { name: 'Angourie', region: 'New South Wales, Australia', blurb: "A classic, sheltered right point — one of Australia's original dedicated surf reserves.", lat: -29.4700, lon: 153.3400, offshoreDeg: 270, swellWindow: [100, 160], bestTide: 'mid' },
  narrabeen: { name: 'North Narrabeen', region: 'Sydney, Australia', blurb: 'A punchy beach break off a rock shelf, a fixture of Sydney competitive surfing.', lat: -33.7180, lon: 151.3020, offshoreDeg: 270 },
  kirra: { name: 'Kirra', region: 'Gold Coast, Australia', blurb: 'Once one of the fastest, longest barrels on Earth off its groyne-fed sandbank.', lat: -28.1670, lon: 153.5330, offshoreDeg: 250, swellWindow: [90, 150], bestTide: 'all' },
  piha: { name: 'Piha', region: 'Auckland, New Zealand', blurb: 'A wild, black-sand beach break beneath dramatic volcanic cliffs.', lat: -36.9530, lon: 174.4700, offshoreDeg: 90 },
  onjuku: { name: 'Onjuku', region: 'Chiba, Japan', blurb: "A consistent beach break close to Tokyo, popular with the city's surfers.", lat: 35.1170, lon: 140.3670, offshoreDeg: 270 },
  hikkaduwa: { name: 'Hikkaduwa', region: 'Sri Lanka', blurb: 'A mellow, reliable reef break inside a lively beach town.', lat: 6.1400, lon: 80.1000, offshoreDeg: 90 },
  weligama: { name: 'Weligama', region: 'Sri Lanka', blurb: "A wide, gentle bay that's become Sri Lanka's top spot to learn.", lat: 5.9730, lon: 80.4290, offshoreDeg: 0 },
  namotu: { name: 'Namotu Left', region: 'Mamanuca Islands, Fiji', blurb: 'A playful reef pass near Cloudbreak, friendlier but still a proper wave.', lat: -17.9330, lon: 177.2170, offshoreDeg: 45 },
  imsouane: { name: 'Imsouane', region: 'Morocco', blurb: "One of the world's longest right points, inside a working fishing bay.", lat: 30.8480, lon: -9.8180, offshoreDeg: 45 },
  tamarin: { name: 'Tamarin', region: 'Mauritius', blurb: 'A powerful left reef break known locally as "the Wall".', lat: -20.3260, lon: 57.3720, offshoreDeg: 90 },
  zarautz: { name: 'Zarautz', region: 'Basque Country, Spain', blurb: "One of Europe's longest beach breaks, a wide bay backed by green hills.", lat: 43.2830, lon: -2.1670, offshoreDeg: 180 },
  croyde: { name: 'Croyde', region: 'Devon, England', blurb: "A punchy, shallow beach break, one of England's best-loved waves.", lat: 51.1290, lon: -4.2350, offshoreDeg: 105 },
  unstad: { name: 'Unstad', region: 'Lofoten, Norway', blurb: 'A dramatic Arctic beach break framed by snow-capped peaks.', lat: 68.2830, lon: 13.0170, offshoreDeg: 90, swellWindow: [290, 350], bestTide: 'all' },
  jungmun: { name: 'Jungmun', region: 'Jeju, South Korea', blurb: "South Korea's best-known beach break, on the island's south coast.", lat: 33.2440, lon: 126.4130, offshoreDeg: 0 },
  riyuebay: { name: 'Riyue Bay', region: 'Hainan, China', blurb: "China's most established surf spot, an exposed point on a resort coastline.", lat: 18.5480, lon: 110.2120, offshoreDeg: 270 },
  jinzun: { name: 'Jinzun', region: 'Taitung, Taiwan', blurb: "Taiwan's premier surf beach, host to an annual international contest.", lat: 22.9500, lon: 121.2350, offshoreDeg: 270 },
  pontadoouro: { name: 'Ponta do Ouro', region: 'Mozambique', blurb: 'An uncrowded point break just north of the South African border.', lat: -26.8500, lon: 32.8830, offshoreDeg: 270 },
  lennoxhead: { name: 'Lennox Head', region: 'New South Wales, Australia', blurb: 'A long, high-performance right point next to a dramatic headland.', lat: -28.7830, lon: 153.6000, offshoreDeg: 270, swellWindow: [100, 160], bestTide: 'mid' },

  // Third batch — added on a second "as many as you can" request, filling in regions the
  // first two batches left thin (US East Coast, Pacific Northwest, Ireland/UK, West Africa,
  // remote Australia, cold-water Atlantic). Same caveat as both earlier batches: reasonable
  // estimates from available sources, not surveyed. The remote/lesser-documented entries in
  // this batch (Todos Santos, Nihiwatu, Bawa, Wai'ao, Pasta Point, One Eye, Shipstern Bluff,
  // Sandvík, Lawrencetown, Cactus Beach) are lower-confidence than the rest -- built-in spots
  // known well enough to describe but without a precisely published coordinate double-checked.
  huntingtonbeach: { name: 'Huntington Beach', region: 'California, USA', blurb: '"Surf City USA" — long stretches of consistent, contest-friendly beach break peaks.', lat: 33.6553, lon: -118.0053, offshoreDeg: 45 },
  oceanbeachsf: { name: 'Ocean Beach', region: 'San Francisco, California, USA', blurb: 'Powerful, shifting beach break with strong currents and serious big-wave days.', lat: 37.7594, lon: -122.5107, offshoreDeg: 90 },
  swamis: { name: "Swami's", region: 'Encinitas, California, USA', blurb: 'A reliable, well-organized reef point popular with SoCal locals.', lat: 33.0281, lon: -117.2934, offshoreDeg: 60 },
  rockawaybeach: { name: 'Rockaway Beach', region: 'Queens, New York, USA', blurb: "New York City's home beach break, best in the fall and winter groundswell season.", lat: 40.5795, lon: -73.8351, offshoreDeg: 0 },
  capehatteras: { name: 'Cape Hatteras', region: 'Outer Banks, North Carolina, USA', blurb: 'Exposed Atlantic beach breaks that pick up nearly every hurricane swell.', lat: 35.2496, lon: -75.5284, offshoreDeg: 270 },
  follybeach: { name: 'Folly Beach', region: 'South Carolina, USA', blurb: "The Lowcountry's best-known beach break, a short drive from Charleston.", lat: 32.6551, lon: -79.9403, offshoreDeg: 315 },
  newsmyrnabeach: { name: 'New Smyrna Beach', region: 'Florida, USA', blurb: 'A consistent inlet beach break, notorious for its shark population.', lat: 29.0258, lon: -80.9270, offshoreDeg: 270 },
  peahi: { name: "Jaws (Pe'ahi)", region: 'Maui, Hawaii, USA', blurb: 'One of the biggest tow-in and paddle waves on Earth when a big NW swell hits.', lat: 20.9330, lon: -156.3140, offshoreDeg: 180 },
  alamoana: { name: 'Ala Moana Bowls', region: 'Oahu, Hawaii, USA', blurb: "A hollow, high-performance reef right just off Honolulu's south shore.", lat: 21.2830, lon: -157.8580, offshoreDeg: 0 },
  hanalei: { name: 'Hanalei Bay', region: 'Kauai, Hawaii, USA', blurb: 'A scenic, sheltered bay with gentle summer waves and a serious winter pier break.', lat: 22.2050, lon: -159.5000, offshoreDeg: 180 },
  shortsands: { name: 'Short Sands', region: 'Oregon, USA', blurb: 'A sheltered cove break in Oswald West State Park, a Pacific Northwest favorite.', lat: 45.7520, lon: -123.9700, offshoreDeg: 90 },
  westport: { name: 'Westport', region: 'Washington, USA', blurb: "A cold, powerful jetty break, one of the Pacific Northwest's most consistent spots.", lat: 46.9010, lon: -124.1450, offshoreDeg: 90 },
  todossantos: { name: 'Killers (Todos Santos)', region: 'Ensenada, Baja California, Mexico', blurb: 'A big-wave reef off an island, one of the heaviest waves in North America.', lat: 31.8300, lon: -116.7280, offshoreDeg: 90 },
  laticla: { name: 'La Ticla', region: 'Michoacán, Mexico', blurb: 'A long, hollow left point on a wild, largely undeveloped stretch of coast.', lat: 18.6060, lon: -103.6650, offshoreDeg: 45 },
  puntamita: { name: 'Punta Mita', region: 'Nayarit, Mexico', blurb: 'A gentle, long right point popular with longboarders in the Riviera Nayarit.', lat: 20.7730, lon: -105.5330, offshoreDeg: 90 },
  tamarindo: { name: 'Tamarindo', region: 'Guanacaste, Costa Rica', blurb: 'An easygoing beach and river-mouth break at the heart of a busy surf town.', lat: 10.2990, lon: -85.8370, offshoreDeg: 90 },
  dominical: { name: 'Dominical', region: 'Costa Rica', blurb: 'A powerful, punchy beach break on the jungle-backed southern Pacific coast.', lat: 9.2480, lon: -83.8620, offshoreDeg: 60 },
  venao: { name: 'Playa Venao', region: 'Panama', blurb: 'A crescent-shaped bay with consistent peaks on both ends, a backpacker surf hub.', lat: 7.4180, lon: -80.1980, offshoreDeg: 0 },
  playacolorado: { name: 'Playa Colorado', region: 'Nicaragua', blurb: 'A punchy, hollow right reef point popular with Central American surf camps.', lat: 11.7940, lon: -86.1940, offshoreDeg: 50 },
  cabarete: { name: 'Cabarete (Encuentro)', region: 'Dominican Republic', blurb: "The Caribbean's best-known surf town, with reefs and beach breaks for every level.", lat: 19.7580, lon: -70.4250, offshoreDeg: 180 },
  lawrencetown: { name: 'Lawrencetown Beach', region: 'Nova Scotia, Canada', blurb: "Atlantic Canada's best-known cold-water beach break.", lat: 44.6430, lon: -63.3860, offshoreDeg: 0 },
  pichilemu: { name: 'Pichilemu', region: 'Chile', blurb: "Chile's surf capital, with a long, rippable left point next to town.", lat: -34.3890, lon: -72.0010, offshoreDeg: 90 },
  arica: { name: 'El Gringo', region: 'Arica, Chile', blurb: "A powerful left point in Chile's far north, close to the Peruvian border.", lat: -18.4780, lon: -70.3210, offshoreDeg: 90 },
  montanita: { name: 'Montañita', region: 'Ecuador', blurb: "Ecuador's best-known surf town, with a lively beach and point break out front.", lat: -1.8330, lon: -80.7420, offshoreDeg: 90 },
  maresias: { name: 'Maresias', region: 'São Paulo, Brazil', blurb: "One of Brazil's best-known beach breaks, on a scenic bay near São Sebastião.", lat: -23.7960, lon: -45.5670, offshoreDeg: 10 },
  lapaloma: { name: 'La Paloma', region: 'Rocha, Uruguay', blurb: "Uruguay's low-key surf town, with reef and beach breaks scattered along the point.", lat: -34.6650, lon: -54.1500, offshoreDeg: 315 },
  watergatebay: { name: 'Watergate Bay', region: 'Cornwall, England', blurb: 'A wide, sandy Atlantic beach break popular with Cornish surf schools.', lat: 50.4420, lon: -5.0550, offshoreDeg: 135 },
  porthleven: { name: 'Porthleven', region: 'Cornwall, England', blurb: 'A shallow, powerful reef break beside a historic harbor wall.', lat: 50.0850, lon: -5.3160, offshoreDeg: 0 },
  rhossili: { name: 'Rhossili Bay', region: 'Gower, Wales', blurb: 'A dramatic three-mile beach break backed by cliffs and green hills.', lat: 51.5680, lon: -4.2930, offshoreDeg: 90 },
  lahinch: { name: 'Lahinch', region: 'County Clare, Ireland', blurb: "A consistent beach break beneath the Cliffs of Moher, Ireland's original surf town.", lat: 52.9330, lon: -9.3450, offshoreDeg: 90 },
  mullaghmore: { name: 'Mullaghmore Head', region: 'County Sligo, Ireland', blurb: 'A frigid, ferocious big-wave reef, among the heaviest waves in Europe.', lat: 54.4680, lon: -8.4470, offshoreDeg: 135, swellWindow: [270, 320], bestTide: 'all' },
  biarritz: { name: 'Côte des Basques', region: 'Biarritz, France', blurb: 'A classic beach break beneath Biarritz, birthplace of European surfing.', lat: 43.4780, lon: -1.5660, offshoreDeg: 90 },
  somo: { name: 'Somo', region: 'Cantabria, Spain', blurb: 'A wide, sandy beach break across the bay from Santander.', lat: 43.4610, lon: -3.7440, offshoreDeg: 180 },
  carcavelos: { name: 'Carcavelos', region: 'Lisbon, Portugal', blurb: "Lisbon's most popular beach break, with a heavier reef at its northern end.", lat: 38.6800, lon: -9.3350, offshoreDeg: 30 },
  sandvik: { name: 'Sandvík', region: 'Reykjanes Peninsula, Iceland', blurb: 'A cold, moody beach break beneath volcanic cliffs, for the hardiest surfers.', lat: 63.8320, lon: -22.6980, offshoreDeg: 0 },
  hashpoint: { name: 'Hash Point', region: 'Taghazout, Morocco', blurb: 'A long right point in a laid-back fishing village turned surf destination.', lat: 30.5460, lon: -9.7100, offshoreDeg: 90 },
  ngor: { name: 'Ngor Right', region: 'Dakar, Senegal', blurb: "West Africa's best-known wave, a reef right off a small island village.", lat: 14.7460, lon: -17.5170, offshoreDeg: 90 },
  caverock: { name: 'Cave Rock', region: 'Durban, South Africa', blurb: "A punchy right reef at the entrance to Durban's harbor.", lat: -29.9130, lon: 31.0430, offshoreDeg: 270 },
  canggu: { name: 'Canggu (Batu Bolong)', region: 'Bali, Indonesia', blurb: "A lively reef break at the heart of Bali's surf-town scene.", lat: -8.6560, lon: 115.1330, offshoreDeg: 50 },
  nihiwatu: { name: "Nihiwatu (Occy's Left)", region: 'Sumba, Indonesia', blurb: 'A long, world-class left reef fronting a famous luxury resort.', lat: -9.6890, lon: 119.2870, offshoreDeg: 50 },
  bawa: { name: 'Bawa', region: 'Hinako Islands, Indonesia', blurb: 'A remote, near-perfect left barrel wrapping around a tiny island.', lat: 0.7500, lon: 97.1170, offshoreDeg: 50 },
  launion: { name: 'La Union', region: 'Philippines', blurb: "The Philippines' most popular surf town, with easygoing beach-break peaks.", lat: 16.6660, lon: 120.3130, offshoreDeg: 90 },
  miyazaki: { name: 'Kisakihama', region: 'Miyazaki, Japan', blurb: "One of Japan's best-known beach breaks, on the subtropical Kyushu coast.", lat: 31.9520, lon: 131.4590, offshoreDeg: 270 },
  midigama: { name: 'Midigama', region: 'Sri Lanka', blurb: 'A pair of reef breaks on the south coast, a step up from nearby Weligama.', lat: 5.9660, lon: 80.3960, offshoreDeg: 0 },
  waao: { name: "Wai'ao", region: 'Yilan, Taiwan', blurb: "Taiwan's most popular beach break, a short drive from Taipei.", lat: 24.8610, lon: 121.8580, offshoreDeg: 270 },
  pastapoint: { name: 'Pasta Point', region: 'Thulusdhoo, Maldives', blurb: 'A soft, playful left reef inside a resort-run atoll break.', lat: 4.3760, lon: 73.6440, offshoreDeg: 90 },
  oneeye: { name: 'One Eye', region: 'Le Morne, Mauritius', blurb: 'A world-class left reef breaking beneath a dramatic basalt mountain.', lat: -20.4560, lon: 57.3120, offshoreDeg: 90 },
  noosaheads: { name: 'Noosa Heads', region: 'Queensland, Australia', blurb: 'A string of gentle, scenic points inside a national park headland.', lat: -26.3980, lon: 153.0990, offshoreDeg: 225, swellWindow: [40, 100], bestTide: 'all' },
  burleighheads: { name: 'Burleigh Heads', region: 'Gold Coast, Australia', blurb: 'A fast, sand-bottomed point next to a rocky headland, near the Superbank.', lat: -28.0930, lon: 153.4470, offshoreDeg: 250 },
  shipsternbluff: { name: 'Shipstern Bluff', region: 'Tasmania, Australia', blurb: 'A freakish, ledging slab beneath towering sea cliffs — as heavy as it looks.', lat: -43.1670, lon: 147.9330, offshoreDeg: 345, swellWindow: [170, 220], bestTide: 'all' },
  thebox: { name: 'The Box', region: 'Gracetown, Western Australia', blurb: 'A short, ultra-heavy slab that breaks in shallow water close to the rocks.', lat: -33.8580, lon: 114.9980, offshoreDeg: 90, swellWindow: [200, 250], bestTide: 'low' },
  cactus: { name: 'Cactus Beach', region: 'South Australia', blurb: 'A remote, wind-blasted cluster of world-class reefs on the Great Australian Bight.', lat: -32.0330, lon: 133.6330, offshoreDeg: 350 },
  restaurants: { name: 'Restaurants', region: 'Tavarua, Fiji', blurb: "Cloudbreak's playful neighbor, a lighter left reef inside the same reef pass.", lat: -17.8390, lon: 177.1890, offshoreDeg: 50 },
  shipwreckbay: { name: 'Shipwreck Bay', region: 'Ahipara, New Zealand', blurb: 'A long left point at the southern end of Ninety Mile Beach.', lat: -35.1670, lon: 173.1330, offshoreDeg: 90, swellWindow: [230, 290], bestTide: 'mid' },
  // Fourth batch. Well-known breaks filling out coverage that the first three left thin:
  // the US East Coast, northern Europe and the North Sea, the Australian city beaches,
  // New Zealand's South Island, and more of Indonesia and Central America. Coordinates
  // place each break to within a few hundred metres, which is what the globe and the
  // directions link need; they are not surveyed line-ups.
  sunsetcliffs: { name: 'Sunset Cliffs', region: 'San Diego, CA', blurb: 'Reefs tucked under the cliffs, best on a mid tide with a west swell running.', lat: 32.7157, lon: -117.2547, offshoreDeg: 90 },
  sanonofre: { name: 'San Onofre', region: 'San Clemente, CA', blurb: 'Mellow, forgiving cobblestone peaks — the classic longboard wave of Southern California.', lat: 33.3733, lon: -117.5656, offshoreDeg: 60 },
  cardiffreef: { name: 'Cardiff Reef', region: 'Cardiff-by-the-Sea, CA', blurb: 'Consistent reef peak that works through the tides, and takes a crowd well.', lat: 33.017, lon: -117.281, offshoreDeg: 90 },
  oceansidepier: { name: 'Oceanside Pier', region: 'Oceanside, CA', blurb: 'Sandbar peaks either side of the pier, punchy on a solid west swell.', lat: 33.193, lon: -117.386, offshoreDeg: 90 },
  venturapoint: { name: 'Ventura Point', region: 'Ventura, CA', blurb: 'Long right-hand cobblestone point that lines up for hundreds of yards on a winter swell.', lat: 34.276, lon: -119.301, offshoreDeg: 20 },
  countyline: { name: 'County Line', region: 'Malibu, CA', blurb: 'Open beach and reef peaks at the county border, reliable when Malibu is flat.', lat: 34.047, lon: -118.92, offshoreDeg: 20 },
  pleasurepoint: { name: 'Pleasure Point', region: 'Santa Cruz, CA', blurb: 'A string of right-hand reef sections along the cliff, cold and consistently good.', lat: 36.956, lon: -121.972, offshoreDeg: 20 },
  lindamar: { name: 'Linda Mar', region: 'Pacifica, CA', blurb: "Forgiving beach break just south of San Francisco, the Bay Area's learn-to-surf beach.", lat: 37.596, lon: -122.506, offshoreDeg: 90 },
  windansea: { name: 'Windansea', region: 'La Jolla, CA', blurb: 'Powerful, shifting reef peaks below the palm shack. Localised and worth the respect.', lat: 32.828, lon: -117.28, offshoreDeg: 90 },
  elporto: { name: 'El Porto', region: 'Manhattan Beach, CA', blurb: 'The most consistent beach break in the South Bay, punchy on a combo swell.', lat: 33.902, lon: -118.418, offshoreDeg: 70 },
  zuma: { name: 'Zuma Beach', region: 'Malibu, CA', blurb: 'Wide-open beach break that picks up far more swell than the points nearby.', lat: 34.018, lon: -118.821, offshoreDeg: 20 },
  sebastianinlet: { name: 'Sebastian Inlet', region: 'Florida, USA', blurb: "The East Coast's proving ground — a wedging right off the jetty when a swell shows.", lat: 27.86, lon: -80.447, offshoreDeg: 270 },
  cocoabeach: { name: 'Cocoa Beach', region: 'Florida, USA', blurb: 'Small, friendly beach break that produced more than its share of champions.', lat: 28.36, lon: -80.607, offshoreDeg: 270 },
  wrightsville: { name: 'Wrightsville Beach', region: 'North Carolina, USA', blurb: 'Consistent sandbars and a jetty, best on a hurricane swell in late summer.', lat: 34.21, lon: -77.796, offshoreDeg: 270 },
  virginiabeach: { name: 'Virginia Beach', region: 'Virginia, USA', blurb: 'Long stretch of beach break peaks, at their best on an autumn groundswell.', lat: 36.833, lon: -75.968, offshoreDeg: 270 },
  longbeachny: { name: 'Long Beach', region: 'New York, USA', blurb: 'Jetty-lined sandbars a train ride from Manhattan, firing on a hurricane swell.', lat: 40.583, lon: -73.658, offshoreDeg: 340 },
  narragansett: { name: 'Narragansett', region: 'Rhode Island, USA', blurb: "New England's most reliable beach break, and freezing outside of summer.", lat: 41.431, lon: -71.455, offshoreDeg: 340 },
  manasquan: { name: 'Manasquan Inlet', region: 'New Jersey, USA', blurb: 'Sand-bottom peaks beside the inlet jetty, punchy on a tight-period swell.', lat: 40.103, lon: -74.033, offshoreDeg: 290 },
  jaws: { name: 'Peʻahi (Jaws)', region: 'Maui, Hawaii', blurb: 'The most famous big-wave tow and paddle arena on Earth, breaking on an outer reef.', lat: 20.943, lon: -156.302, offshoreDeg: 200, swellWindow: [300, 350], bestTide: 'all' },
  rockypoint: { name: 'Rocky Point', region: 'Oahu, Hawaii', blurb: "Shifting North Shore peaks, lefts and rights, and the shore's busiest performance wave.", lat: 21.662, lon: -158.043, offshoreDeg: 200 },
  queens: { name: 'Queens', region: 'Waikiki, Hawaii', blurb: 'Gentle rolling reef wave in front of Waikiki, where surfing was reintroduced to the world.', lat: 21.272, lon: -157.824, offshoreDeg: 20 },
  makaha: { name: 'Makaha', region: 'Oahu, Hawaii', blurb: 'Historic west-side point with a big, bowling wall and deep local roots.', lat: 21.477, lon: -158.22, offshoreDeg: 70 },
  scorpionbay: { name: 'Scorpion Bay', region: 'Baja California Sur, Mexico', blurb: 'Seven right-hand points that link on a big south swell, in the middle of nowhere.', lat: 26.256, lon: -112.477, offshoreDeg: 70 },
  sanmiguel: { name: 'San Miguel', region: 'Ensenada, Mexico', blurb: 'Cobblestone right point just south of the border, best on a solid winter northwest.', lat: 31.9, lon: -116.766, offshoreDeg: 70 },
  troncones: { name: 'Troncones', region: 'Guerrero, Mexico', blurb: 'Long sandy beach with a point at each end, and warm water year-round.', lat: 17.783, lon: -101.733, offshoreDeg: 20 },
  elzonte: { name: 'El Zonte', region: 'La Libertad, El Salvador', blurb: 'Cobblestone right point that put this stretch of coast on the map.', lat: 13.495, lon: -89.44, offshoreDeg: 20 },
  lasflores: { name: 'Las Flores', region: 'La Unión, El Salvador', blurb: 'Machine-like right point peeling over cobblestones into a palm-lined bay.', lat: 13.174, lon: -88.033, offshoreDeg: 20 },
  olliespoint: { name: "Ollie's Point", region: 'Guanacaste, Costa Rica', blurb: 'Long, walling right point in a remote bay north of Tamarindo.', lat: 10.9, lon: -85.75, offshoreDeg: 70 },
  nosara: { name: 'Playa Guiones', region: 'Nosara, Costa Rica', blurb: 'Dependable beach break peaks along a long, protected stretch of sand.', lat: 9.953, lon: -85.68, offshoreDeg: 70 },
  bocasbluff: { name: 'Playa Bluff', region: 'Bocas del Toro, Panama', blurb: 'Heavy Caribbean beach break barrel that turns on in the winter months.', lat: 9.35, lon: -82.233, offshoreDeg: 250 },
  lobitos: { name: 'Lobitos', region: 'Piura, Peru', blurb: 'Cold, mechanical left points down a desert oil-town coastline.', lat: -4.452, lon: -81.281, offshoreDeg: 110, swellWindow: [190, 240], bestTide: 'all' },
  iquique: { name: 'Playa Cavancha', region: 'Iquique, Chile', blurb: 'Punchy urban reef and beach peaks in the driest desert on Earth.', lat: -20.228, lon: -70.149, offshoreDeg: 90 },
  matanzas: { name: 'Matanzas', region: "O'Higgins, Chile", blurb: 'Long left point and beach break in a windy bay south of Santiago.', lat: -33.96, lon: -71.872, offshoreDeg: 90 },
  saquarema: { name: 'Saquarema', region: 'Rio de Janeiro, Brazil', blurb: "Brazil's most powerful beach break, and a fixture on the world tour.", lat: -22.934, lon: -42.489, offshoreDeg: 340 },
  noronha: { name: 'Cacimba do Padre', region: 'Fernando de Noronha, Brazil', blurb: 'Barrelling beach break beneath two volcanic peaks, on a remote Atlantic island.', lat: -3.854, lon: -32.436, offshoreDeg: 110 },
  praiadorosa: { name: 'Praia do Rosa', region: 'Santa Catarina, Brazil', blurb: 'Beach break in a horseshoe bay backed by green hills and lagoons.', lat: -28.133, lon: -48.64, offshoreDeg: 290 },
  guincho: { name: 'Praia do Guincho', region: 'Cascais, Portugal', blurb: 'Wild, wind-exposed Atlantic beach break under the Sintra hills.', lat: 38.733, lon: -9.472, offshoreDeg: 90 },
  sagres: { name: 'Praia do Tonel', region: 'Sagres, Portugal', blurb: 'Exposed corner at the southwest tip of Europe, catching swell when everywhere else is flat.', lat: 37.0, lon: -8.945, offshoreDeg: 20 },
  pantin: { name: 'Praia de Pantín', region: 'Galicia, Spain', blurb: 'Consistent, punchy beach break on the wild Galician coast.', lat: 43.63, lon: -8.113, offshoreDeg: 180 },
  rodiles: { name: 'Rodiles', region: 'Asturias, Spain', blurb: 'A celebrated left river-mouth wave that peels along a sandbar beside a pine forest.', lat: 43.533, lon: -5.383, offshoreDeg: 180 },
  capbreton: { name: 'La Piste', region: 'Capbreton, France', blurb: 'Heavy, hollow sandbank barrels beside the blockhaus.', lat: 43.642, lon: -1.445, offshoreDeg: 90 },
  easkey: { name: 'Easkey', region: 'Sligo, Ireland', blurb: 'Reliable reef lefts and rights below a ruined castle on the wild Atlantic coast.', lat: 54.287, lon: -8.96, offshoreDeg: 180 },
  porthcawl: { name: 'Rest Bay', region: 'Porthcawl, Wales', blurb: "South Wales' most consistent beach break, working through most of the tide.", lat: 51.489, lon: -3.713, offshoreDeg: 20 },
  saltburn: { name: 'Saltburn', region: 'North Yorkshire, England', blurb: 'A north-east England beach and pier break, cold and surprisingly consistent.', lat: 54.583, lon: -0.97, offshoreDeg: 290 },
  scheveningen: { name: 'Scheveningen', region: 'The Hague, Netherlands', blurb: 'Short-period North Sea beach break, busy whenever a blow puts swell in the water.', lat: 52.108, lon: 4.275, offshoreDeg: 110 },
  sylt: { name: 'Sylt', region: 'Germany', blurb: "Germany's surf capital — a long North Sea sandbar coast on a windswept island.", lat: 54.9, lon: 8.3, offshoreDeg: 110 },
  klitmoller: { name: 'Klitmøller', region: 'Denmark', blurb: 'Known as Cold Hawaii: a reef and point setup on the Danish North Sea coast.', lat: 57.04, lon: 8.48, offshoreDeg: 110, swellWindow: [280, 340], bestTide: 'all' },
  hoddevik: { name: 'Hoddevik', region: 'Norway', blurb: 'A sand-bottom bay ringed by cliffs, surfed under the midnight sun and the northern lights.', lat: 62.033, lon: 5.1, offshoreDeg: 110, swellWindow: [280, 330], bestTide: 'all' },
  killerpoint: { name: 'Killer Point', region: 'Taghazout, Morocco', blurb: 'The longest and most powerful of the Taghazout points, named for the passing whales.', lat: 30.554, lon: -9.718, offshoreDeg: 70 },
  safi: { name: 'Safi', region: 'Morocco', blurb: 'A world-class right point that barrels down the reef when a big northwest lands.', lat: 32.28, lon: -9.25, offshoreDeg: 70 },
  dakhla: { name: 'Dakhla', region: 'Western Sahara', blurb: 'Desert right points wrapping into a huge lagoon, windy and near-empty.', lat: 23.71, lon: -15.94, offshoreDeg: 70 },
  sealpoint: { name: 'Seal Point', region: 'Cape St Francis, South Africa', blurb: 'Long, ruler-edged right point immortalised in The Endless Summer.', lat: -34.21, lon: 24.838, offshoreDeg: 340, swellWindow: [190, 240], bestTide: 'all' },
  muizenberg: { name: 'Muizenberg', region: 'Cape Town, South Africa', blurb: 'Gentle, sandy corner of False Bay where most of Cape Town learns to surf.', lat: -34.108, lon: 18.47, offshoreDeg: 340 },
  newpier: { name: 'New Pier', region: 'Durban, South Africa', blurb: 'Sand-bottom peaks between the piers, the heart of South African surfing.', lat: -29.858, lon: 31.04, offshoreDeg: 250 },
  tofo: { name: 'Tofo', region: 'Inhambane, Mozambique', blurb: 'Warm-water points and beach break beside a bay known for manta rays.', lat: -23.85, lon: 35.54, offshoreDeg: 250 },
  hiltonbeach: { name: 'Hilton Beach', region: 'Tel Aviv, Israel', blurb: "The city's best-known break, crowded whenever a Mediterranean windswell arrives.", lat: 32.087, lon: 34.768, offshoreDeg: 110, swellWindow: [240, 330], bestTide: 'all' },
  hollowtrees: { name: 'Hollow Trees', region: 'Mentawai Islands, Indonesia', blurb: 'A perfect, shallow right-hand reef barrel — one of the best waves in the world.', lat: -2.117, lon: 99.567, offshoreDeg: 70, swellWindow: [180, 230], bestTide: 'mid' },
  bingin: { name: 'Bingin', region: 'Bali, Indonesia', blurb: 'Short, intense left reef barrel below a cliff of stacked guesthouses.', lat: -8.808, lon: 115.113, offshoreDeg: 50, swellWindow: [200, 250], bestTide: 'low' },
  medewi: { name: 'Medewi', region: 'Bali, Indonesia', blurb: "A long, slow left point on Bali's quiet west coast, ideal on a longboard.", lat: -8.42, lon: 114.81, offshoreDeg: 50 },
  tland: { name: 'T-Land', region: 'Rote, Indonesia', blurb: 'A long, mellow left reef wave in a remote bay off Timor.', lat: -10.9, lon: 122.83, offshoreDeg: 20 },
  krui: { name: 'Ujung Bocur', region: 'Krui, Indonesia', blurb: "Consistent left reef point on Sumatra's swell-soaked west coast.", lat: -5.24, lon: 103.92, offshoreDeg: 70 },
  kata: { name: 'Kata Beach', region: 'Phuket, Thailand', blurb: "Thailand's best-known beach break, working through the southwest monsoon.", lat: 7.818, lon: 98.297, offshoreDeg: 70 },
  ikumi: { name: 'Ikumi Beach', region: 'Tokushima, Japan', blurb: "One of Japan's most consistent beach breaks, best on a typhoon swell.", lat: 33.548, lon: 134.283, offshoreDeg: 290 },
  baler: { name: 'Sabang Beach', region: 'Baler, Philippines', blurb: 'Where Apocalypse Now brought surfing to the Philippines — a gentle beach break.', lat: 15.758, lon: 121.563, offshoreDeg: 250 },
  chickens: { name: 'Chickens', region: 'North Malé Atoll, Maldives', blurb: 'A long, wrapping left reef pass over shallow coral in warm, clear water.', lat: 4.287, lon: 73.39, offshoreDeg: 70 },
  winkipop: { name: 'Winkipop', region: 'Victoria, Australia', blurb: 'The fast, racy right next door to Bells, and the better wave when it is on.', lat: -38.369, lon: 144.279, offshoreDeg: 340, swellWindow: [190, 240], bestTide: 'mid' },
  crescenthead: { name: 'Crescent Head', region: 'New South Wales, Australia', blurb: 'A long, sloping right point that is spiritual home to Australian longboarding.', lat: -31.188, lon: 152.98, offshoreDeg: 250, swellWindow: [100, 160], bestTide: 'all' },
  duranbah: { name: 'Duranbah', region: 'New South Wales, Australia', blurb: 'Punchy beach break beside the Tweed river mouth, the most surfed sand in the country.', lat: -28.166, lon: 153.551, offshoreDeg: 250, swellWindow: [80, 150], bestTide: 'all' },
  maroubra: { name: 'Maroubra', region: 'Sydney, Australia', blurb: "Sydney's heaviest beach break, with a fierce local scene to match.", lat: -33.95, lon: 151.256, offshoreDeg: 250 },
  bondi: { name: 'Bondi Beach', region: 'Sydney, Australia', blurb: 'The most famous beach in Australia — shifting sandbars and a permanent crowd.', lat: -33.891, lon: 151.277, offshoreDeg: 250 },
  manly: { name: 'Manly Beach', region: 'Sydney, Australia', blurb: 'Where Australian surfing began in 1915, and still a reliable beach break.', lat: -33.796, lon: 151.288, offshoreDeg: 250 },
  gnaraloo: { name: 'Gnaraloo', region: 'Western Australia', blurb: 'Tombstones — a heavy, remote left reef at the edge of a station on the Ningaloo coast.', lat: -23.79, lon: 113.51, offshoreDeg: 110, swellWindow: [200, 250], bestTide: 'all' },
  redbluff: { name: 'Red Bluff', region: 'Western Australia', blurb: 'A big, hollow left point below red cliffs, camped on rather than driven to.', lat: -24.02, lon: 113.4, offshoreDeg: 110 },
  yallingup: { name: 'Yallingup', region: 'Western Australia', blurb: 'Long, powerful reef and point wave at the top of the Margaret River region.', lat: -33.642, lon: 114.988, offshoreDeg: 110 },
  stclair: { name: 'St Clair Beach', region: 'Dunedin, New Zealand', blurb: 'Cold, consistent beach break at the bottom of the South Island.', lat: -45.911, lon: 170.487, offshoreDeg: 290 },
  makorori: { name: 'Makorori', region: 'Gisborne, New Zealand', blurb: 'A run of points and beach breaks just north of the first city to see the sun.', lat: -38.63, lon: 178.08, offshoreDeg: 250 },
  fitzroybeach: { name: 'Fitzroy Beach', region: 'New Plymouth, New Zealand', blurb: 'Black-sand beach break under the cone of Mount Taranaki.', lat: -39.048, lon: 174.09, offshoreDeg: 110 },
  // Fifth batch: the Israeli Mediterranean coast, north to south. The coastline runs roughly
  // north-south facing west, so offshore is easterly and the swell window is the western arc.
  // `bestTide` is 'all' throughout because the eastern Mediterranean is close to tideless here
  // (a range of roughly 30-40cm) — claiming a tide preference would be inventing a signal.
  nahariya: { name: 'Nahariya', region: 'Northern District, Israel', blurb: 'Northern beach break that picks up the most swell on a winter northwesterly.', lat: 33.005, lon: 35.09, offshoreDeg: 100, swellWindow: [250, 330], bestTide: 'all' },
  akko: { name: 'Akko', region: 'Northern District, Israel', blurb: 'Sheltered break under the old city walls, working when the north swell wraps in.', lat: 32.925, lon: 35.065, offshoreDeg: 100, swellWindow: [260, 340], bestTide: 'all' },
  batgalim: { name: 'Bat Galim', region: 'Haifa, Israel', blurb: "Haifa's home break, tucked beside the breakwater and best on a west swell.", lat: 32.832, lon: 34.985, offshoreDeg: 100, swellWindow: [250, 330], bestTide: 'all' },
  atlit: { name: 'Atlit', region: 'Haifa District, Israel', blurb: 'Reef and beach peaks below the Crusader fortress, quieter than the city breaks.', lat: 32.69, lon: 34.936, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  habonim: { name: 'Habonim', region: 'Haifa District, Israel', blurb: 'Rocky coves and sandbars along a protected nature reserve shoreline.', lat: 32.637, lon: 34.925, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  nahsholim: { name: 'Nahsholim', region: 'Haifa District, Israel', blurb: 'Sandy bay beside Tel Dor, gentle and good for longer boards.', lat: 32.611, lon: 34.918, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  beithanania: { name: 'Beit Hanania', region: 'Haifa District, Israel', blurb: 'Open beach break north of Caesarea that handles more size than most.', lat: 32.545, lon: 34.912, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  michmoret: { name: 'Michmoret', region: 'Central District, Israel', blurb: 'Long sandy stretch with a jetty, one of the most consistent spots on the coast.', lat: 32.404, lon: 34.869, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  beityanai: { name: 'Beit Yanai', region: 'Central District, Israel', blurb: 'Punchy beach break under the cliffs, a favourite when a westerly fills in.', lat: 32.383, lon: 34.869, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  sironit: { name: 'Sironit', region: 'Netanya, Israel', blurb: "Netanya's main beach, sheltered by the cliff and busy whenever it breaks.", lat: 32.336, lon: 34.85, offshoreDeg: 100, swellWindow: [250, 330], bestTide: 'all' },
  poleg: { name: 'Poleg', region: 'Netanya, Israel', blurb: 'Sandbars at the river mouth south of Netanya, best on a clean west swell.', lat: 32.293, lon: 34.843, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  herzliya: { name: 'Acadia', region: 'Herzliya, Israel', blurb: "Herzliya's best-known peak, and one of the more competitive line-ups in Israel.", lat: 32.163, lon: 34.797, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  maravi: { name: 'Maravi', region: 'Tel Aviv, Israel', blurb: 'Tel Aviv beach break just north of the marina, crowded on any decent morning.', lat: 32.093, lon: 34.771, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  bananabeach: { name: 'Banana Beach', region: 'Tel Aviv, Israel', blurb: "Central Tel Aviv sandbars, mellow and the city's usual first surf.", lat: 32.07, lon: 34.762, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  batyam: { name: 'Bat Yam', region: 'Tel Aviv District, Israel', blurb: 'Breakwater-sheltered peaks just south of Tel Aviv, cleaner in a south wind.', lat: 32.017, lon: 34.74, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  palmachim: { name: 'Palmachim', region: 'Central District, Israel', blurb: 'Open, uncrowded beach break beside the kibbutz and the river mouth.', lat: 31.93, lon: 34.7, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  ashdod: { name: 'Ashdod', region: 'Southern District, Israel', blurb: 'Port-side sandbars that turn on when a winter storm tracks down the coast.', lat: 31.826, lon: 34.635, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  ashkelon: { name: 'Ashkelon', region: 'Southern District, Israel', blurb: 'The southernmost consistent break, exposed to swell from the west and south-west.', lat: 31.678, lon: 34.554, offshoreDeg: 100, swellWindow: [230, 320], bestTide: 'all' },
  // Sixth batch, chosen to fill whole countries the catalog had missed rather than to
  // thicken regions already well covered: Argentina, Guatemala, Jamaica, Trinidad, the
  // Azores, Cape Verde, Ghana, Liberia, Sierra Leone, Angola, Kenya, Lebanon, Cyprus,
  // Sweden, Belgium, Malaysia, Tonga, Samoa, Vanuatu, New Caledonia, Papua New Guinea,
  // Micronesia and Guam all appear here for the first time.
  //
  // Same provenance caveat as the earlier batches: coordinates place each break to within a
  // few hundred metres, which is what the globe and the directions link need, and come from
  // general knowledge rather than a surveyed dataset.
  mardelplata: { name: 'Playa Grande (Mar del Plata)', region: 'Mar del Plata, Argentina', blurb: "Argentina's surfing capital, a city beach break that works all year.", lat: -38.0233, lon: -57.5333, offshoreDeg: 290, swellWindow: [80, 170], bestTide: 'all' },
  necochea: { name: 'Necochea', region: 'Buenos Aires, Argentina', blurb: 'Long open beach south of Mar del Plata, bigger and far emptier.', lat: -38.5833, lon: -58.7333, offshoreDeg: 290, swellWindow: [80, 170], bestTide: 'all' },
  miramar: { name: 'Miramar', region: 'Buenos Aires, Argentina', blurb: 'Sheltered beach break in a quiet resort town on the Atlantic coast.', lat: -38.27, lon: -57.84, offshoreDeg: 290, swellWindow: [80, 170], bestTide: 'all' },
  puntadeleste: { name: 'Punta del Este', region: 'Maldonado, Uruguay', blurb: "Playa Brava's open Atlantic peaks, busy through the southern summer.", lat: -34.9667, lon: -54.95, offshoreDeg: 290, swellWindow: [90, 180], bestTide: 'all' },
  itamambuca: { name: 'Itamambuca', region: 'Ubatuba, Brazil', blurb: "A river-mouth beach break in the Atlantic rainforest, one of Brazil's best.", lat: -23.4, lon: -45.03, offshoreDeg: 290, swellWindow: [90, 180], bestTide: 'all' },
  imbituba: { name: 'Praia da Vila', region: 'Imbituba, Brazil', blurb: 'Right-hand point in a horseshoe bay that has hosted world tour events.', lat: -28.24, lon: -48.66, offshoreDeg: 290, swellWindow: [100, 190], bestTide: 'all' },
  buchupureo: { name: 'Buchupureo', region: 'Ñuble, Chile', blurb: 'Long left point over a river-mouth sandbar on the cold central coast.', lat: -36.08, lon: -72.78, offshoreDeg: 90, swellWindow: [200, 290], bestTide: 'all' },
  curanipe: { name: 'Curanipe', region: 'Maule, Chile', blurb: 'Powerful reef and beach peaks in a small fishing village.', lat: -35.85, lon: -72.63, offshoreDeg: 90, swellWindow: [200, 290], bestTide: 'all' },
  caboblanco: { name: 'Cabo Blanco', region: 'Piura, Peru', blurb: "A short, thick, perfect left barrel — Peru's most coveted wave.", lat: -4.25, lon: -81.23, offshoreDeg: 110, swellWindow: [190, 280], bestTide: 'all' },
  pacasmayo: { name: 'Pacasmayo', region: 'La Libertad, Peru', blurb: 'An enormous left point, second only to Chicama for sheer length.', lat: -7.4, lon: -79.57, offshoreDeg: 110, swellWindow: [190, 280], bestTide: 'all' },
  puntarocas: { name: 'Punta Rocas', region: 'Lima, Peru', blurb: 'Powerful right reef south of Lima and a fixture of Peruvian contests.', lat: -12.36, lon: -76.79, offshoreDeg: 110, swellWindow: [190, 280], bestTide: 'all' },
  ayampe: { name: 'Ayampe', region: 'Manabí, Ecuador', blurb: 'Consistent beach break in a quiet village, good for all abilities.', lat: -1.67, lon: -80.79, offshoreDeg: 90, swellWindow: [200, 290], bestTide: 'all' },
  elparedon: { name: 'El Paredón', region: 'Escuintla, Guatemala', blurb: "Black-sand beach break on Guatemala's Pacific coast, punchy and uncrowded.", lat: 13.92, lon: -91.03, offshoreDeg: 50, swellWindow: [170, 260], bestTide: 'all' },
  maderas: { name: 'Playa Maderas', region: 'Rivas, Nicaragua', blurb: 'The most popular beach break near San Juan del Sur, offshore most mornings.', lat: 11.27, lon: -86.13, offshoreDeg: 70, swellWindow: [180, 270], bestTide: 'all' },
  lasaladita: { name: 'La Saladita', region: 'Guerrero, Mexico', blurb: "A long, slow left point that is close to a longboarder's ideal.", lat: 17.68, lon: -101.53, offshoreDeg: 20, swellWindow: [170, 260], bestTide: 'all' },
  puntaconejo: { name: 'Punta Conejo', region: 'Oaxaca, Mexico', blurb: 'Right point in the desert wind belt, big and often howling offshore.', lat: 16.2, lon: -95.2, offshoreDeg: 20, swellWindow: [160, 250], bestTide: 'all' },
  bostonbay: { name: 'Boston Bay', region: 'Portland, Jamaica', blurb: 'The birthplace of Jamaican surfing, a sheltered bay on the east coast.', lat: 18.17, lon: -76.36, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  playagrande: { name: 'Playa Grande (Cabrera)', region: 'María Trinidad Sánchez, Dominican Republic', blurb: 'Powerful north-coast beach break that turns on with the winter swells.', lat: 19.4, lon: -69.95, offshoreDeg: 180, swellWindow: [320, 50], bestTide: 'all' },
  gaschambers: { name: 'Gas Chambers', region: 'Aguadilla, Puerto Rico', blurb: 'A short, violent right barrel over shallow reef, for experienced surfers.', lat: 18.51, lon: -67.16, offshoreDeg: 110, swellWindow: [290, 20], bestTide: 'all' },
  freightsbay: { name: 'Freights Bay', region: 'Christ Church, Barbados', blurb: "Gentle right point on the south coast, the island's learn-to-surf wave.", lat: 13.07, lon: -59.53, offshoreDeg: 20, swellWindow: [110, 200], bestTide: 'all' },
  mountirvine: { name: 'Mount Irvine', region: 'Tobago, Trinidad and Tobago', blurb: "Tobago's best-known reef break, working on a north-east swell.", lat: 11.19, lon: -60.79, offshoreDeg: 200, swellWindow: [320, 60], bestTide: 'all' },
  ribeiragrande: { name: 'Ribeira Grande', region: 'São Miguel, Azores', blurb: 'Consistent black-sand beach break on the north coast of São Miguel.', lat: 37.82, lon: -25.52, offshoreDeg: 180, swellWindow: [280, 40], bestTide: 'all' },
  jardimdomar: { name: 'Jardim do Mar', region: 'Madeira, Portugal', blurb: 'A big-wave right point that breaks along a boulder shoreline.', lat: 32.74, lon: -17.16, offshoreDeg: 60, swellWindow: [280, 20], bestTide: 'all' },
  pontapreta: { name: 'Ponta Preta', region: 'Sal, Cape Verde', blurb: 'A fast, hollow right point in the trade winds off West Africa.', lat: 16.6, lon: -22.95, offshoreDeg: 70, swellWindow: [280, 20], bestTide: 'all' },
  yoff: { name: 'Yoff', region: 'Dakar, Senegal', blurb: "Dakar's most reliable beach and reef setup, offshore through the dry season.", lat: 14.77, lon: -17.47, offshoreDeg: 90, swellWindow: [280, 20], bestTide: 'all' },
  busua: { name: 'Busua', region: 'Western Region, Ghana', blurb: "Ghana's main surf beach, mellow and warm all year.", lat: 4.79, lon: -1.94, offshoreDeg: 20, swellWindow: [170, 260], bestTide: 'all' },
  robertsport: { name: 'Robertsport', region: 'Grand Cape Mount, Liberia', blurb: 'Long, clean left points over cobblestones, remote and rarely crowded.', lat: 6.75, lon: -11.37, offshoreDeg: 70, swellWindow: [190, 280], bestTide: 'all' },
  burehbeach: { name: 'Bureh Beach', region: 'Western Area, Sierra Leone', blurb: 'A friendly beach break with a community surf club on a palm-lined bay.', lat: 8.3, lon: -13.09, offshoreDeg: 70, swellWindow: [190, 280], bestTide: 'all' },
  caboledo: { name: 'Cabo Ledo', region: 'Bengo, Angola', blurb: 'A very long left point wrapping into a desert bay south of Luanda.', lat: -9.68, lon: 13.24, offshoreDeg: 110, swellWindow: [200, 290], bestTide: 'all' },
  diani: { name: 'Diani Beach', region: 'Kwale, Kenya', blurb: 'Reef-protected beach on the Indian Ocean, best on the Kaskazi season.', lat: -4.28, lon: 39.59, offshoreDeg: 250, swellWindow: [60, 150], bestTide: 'all' },
  batroun: { name: 'Batroun', region: 'North Governorate, Lebanon', blurb: 'Rocky point north of Beirut that comes alive on a winter westerly.', lat: 34.25, lon: 35.66, offshoreDeg: 100, swellWindow: [240, 330], bestTide: 'all' },
  curium: { name: 'Curium', region: 'Limassol, Cyprus', blurb: "Cyprus's best-known break, below the ancient amphitheatre.", lat: 34.66, lon: 32.88, offshoreDeg: 20, swellWindow: [180, 270], bestTide: 'all' },
  levanto: { name: 'Levanto', region: 'Liguria, Italy', blurb: "The Ligurian coast's most consistent bay, crowded on any winter swell.", lat: 44.17, lon: 9.61, offshoreDeg: 20, swellWindow: [160, 250], bestTide: 'all' },
  santamarinella: { name: 'Santa Marinella', region: 'Lazio, Italy', blurb: 'A reef point north of Rome, working on a Tyrrhenian south-westerly.', lat: 42.03, lon: 11.85, offshoreDeg: 20, swellWindow: [180, 270], bestTide: 'all' },
  machrihanish: { name: 'Machrihanish', region: 'Argyll, Scotland', blurb: 'Exposed Atlantic beach break on the Kintyre peninsula.', lat: 55.42, lon: -5.73, offshoreDeg: 90, swellWindow: [230, 320], bestTide: 'all' },
  peasebay: { name: 'Pease Bay', region: 'Scottish Borders, Scotland', blurb: "A sheltered North Sea bay and the east coast's most reliable spot.", lat: 55.94, lon: -2.34, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  thorlakshofn: { name: 'Þorlákshöfn', region: 'Southern Region, Iceland', blurb: 'Sub-Arctic beach break, surfed in near-freezing water under the aurora.', lat: 63.85, lon: -21.38, offshoreDeg: 20, swellWindow: [160, 250], bestTide: 'all' },
  toro: { name: 'Torö', region: 'Stockholm, Sweden', blurb: "Sweden's best-known wave, a Baltic reef that needs a hard southerly blow.", lat: 58.82, lon: 17.83, offshoreDeg: 340, swellWindow: [140, 230], bestTide: 'all' },
  oostende: { name: 'Oostende', region: 'West Flanders, Belgium', blurb: 'North Sea beach break, short-period and busy whenever a gale lands.', lat: 51.23, lon: 2.91, offshoreDeg: 110, swellWindow: [280, 10], bestTide: 'all' },
  coxos: { name: 'Coxos', region: 'Ericeira, Portugal', blurb: 'The jewel of the Ericeira reserve — a fast, powerful right point.', lat: 38.99, lon: -9.42, offshoreDeg: 90, swellWindow: [270, 340], bestTide: 'mid' },
  praiagrande: { name: 'Praia Grande', region: 'Sintra, Portugal', blurb: 'Big, exposed beach break under the Sintra cliffs, home to a wave pool too.', lat: 38.81, lon: -9.47, offshoreDeg: 90, swellWindow: [270, 340], bestTide: 'all' },
  razo: { name: 'Playa de Razo', region: 'Galicia, Spain', blurb: 'Long Galician beach break, consistent and rarely busy outside summer.', lat: 43.28, lon: -8.83, offshoreDeg: 110, swellWindow: [280, 10], bestTide: 'all' },
  menakoz: { name: 'Meñakoz', region: 'Basque Country, Spain', blurb: 'A heavy big-wave right reef that only starts working when it is huge.', lat: 43.39, lon: -2.97, offshoreDeg: 180, swellWindow: [280, 20], bestTide: 'all' },
  lafitenia: { name: 'Lafitenia', region: 'Saint-Jean-de-Luz, France', blurb: "A classy right point in a rocky cove, the Basque coast's best on its day.", lat: 43.42, lon: -1.64, offshoreDeg: 110, swellWindow: [280, 10], bestTide: 'mid' },
  mulki: { name: 'Mulki', region: 'Karnataka, India', blurb: "India's surf hub at the river mouth, warm and mellow through the monsoon.", lat: 13.09, lon: 74.79, offshoreDeg: 70, swellWindow: [200, 290], bestTide: 'all' },
  manapad: { name: 'Manapad', region: 'Tamil Nadu, India', blurb: 'A right point off a rocky headland at the southern tip of India.', lat: 8.37, lon: 78.06, offshoreDeg: 250, swellWindow: [60, 150], bestTide: 'all' },
  sultans: { name: 'Sultans', region: 'North Malé Atoll, Maldives', blurb: 'A long, walling right over reef, the best-known wave in the Maldives.', lat: 4.32, lon: 73.42, offshoreDeg: 70, swellWindow: [150, 240], bestTide: 'all' },
  cherating: { name: 'Cherating', region: 'Pahang, Malaysia', blurb: 'A gentle beach and river-mouth wave on the South China Sea monsoon coast.', lat: 4.13, lon: 103.4, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  mykhe: { name: 'My Khe', region: 'Da Nang, Vietnam', blurb: 'Long city beach in Da Nang that picks up the north-east monsoon swell.', lat: 16.06, lon: 108.25, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  calicoan: { name: 'Calicoan', region: 'Eastern Samar, Philippines', blurb: 'Powerful reef break on a remote island facing the open Pacific.', lat: 10.97, lon: 125.72, offshoreDeg: 250, swellWindow: [40, 130], bestTide: 'all' },
  fulong: { name: 'Fulong', region: 'New Taipei, Taiwan', blurb: "Taiwan's main contest beach, at its best on a typhoon swell.", lat: 25.02, lon: 121.94, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  kamogawa: { name: 'Kamogawa', region: 'Chiba, Japan', blurb: 'Consistent Pacific beach break down the Boso peninsula from Tokyo.', lat: 35.11, lon: 140.1, offshoreDeg: 290, swellWindow: [80, 170], bestTide: 'all' },
  songjeong: { name: 'Songjeong', region: 'Busan, South Korea', blurb: "Busan's surf beach, sheltered and forgiving, busy every summer.", lat: 35.18, lon: 129.2, offshoreDeg: 250, swellWindow: [40, 130], bestTide: 'all' },
  haatafu: { name: "Ha'atafu", region: 'Tongatapu, Tonga', blurb: 'Reef passes off the western tip of Tongatapu, warm and uncrowded.', lat: -21.07, lon: -175.34, offshoreDeg: 70, swellWindow: [250, 340], bestTide: 'all' },
  salani: { name: 'Salani', region: 'Upolu, Samoa', blurb: "A reef pass right on Upolu's south coast, powerful and shallow.", lat: -14.02, lon: -171.5, offshoreDeg: 20, swellWindow: [150, 240], bestTide: 'all' },
  pangopoint: { name: 'Pango Point', region: 'Efate, Vanuatu', blurb: 'Left reef point just outside Port Vila, working on a southerly swell.', lat: -17.78, lon: 168.28, offshoreDeg: 20, swellWindow: [150, 240], bestTide: 'all' },
  ouano: { name: 'Ouano', region: 'South Province, New Caledonia', blurb: "A reef pass inside the world's largest lagoon, reached by boat.", lat: -21.85, lon: 165.83, offshoreDeg: 70, swellWindow: [180, 270], bestTide: 'all' },
  vanimo: { name: 'Vanimo', region: 'Sandaun, Papua New Guinea', blurb: "A long right point on PNG's north coast, empty and warm.", lat: -2.68, lon: 141.3, offshoreDeg: 180, swellWindow: [300, 30], bestTide: 'all' },
  ppass: { name: 'P-Pass', region: 'Pohnpei, Micronesia', blurb: 'Palikir Pass — a flawless, heavy right barrel in the middle of the Pacific.', lat: 6.99, lon: 158.19, offshoreDeg: 180, swellWindow: [290, 20], bestTide: 'all' },
  boatbasin: { name: 'Boat Basin', region: 'Guam', blurb: "Guam's most surfed reef, breaking outside the harbour channel.", lat: 13.43, lon: 144.65, offshoreDeg: 70, swellWindow: [230, 320], bestTide: 'all' },
  bawleypoint: { name: 'Bawley Point', region: 'New South Wales, Australia', blurb: 'Quiet right point on the south coast, well away from the Sydney crowds.', lat: -35.51, lon: 150.39, offshoreDeg: 250, swellWindow: [80, 170], bestTide: 'all' },
  werribeach: { name: 'Werri Beach', region: 'New South Wales, Australia', blurb: 'Beach break with a right point at its southern end, south of Sydney.', lat: -34.73, lon: 150.84, offshoreDeg: 250, swellWindow: [80, 170], bestTide: 'all' },
  scarboroughwa: { name: 'Scarborough', region: 'Perth, Western Australia', blurb: "Perth's main city beach, reliable through the winter swell season.", lat: -31.89, lon: 115.75, offshoreDeg: 110, swellWindow: [200, 290], bestTide: 'all' },
  whangamata: { name: 'Whangamata', region: 'Waikato, New Zealand', blurb: "A bar break at the harbour mouth, the Coromandel's best-known wave.", lat: -37.21, lon: 175.87, offshoreDeg: 250, swellWindow: [40, 130], bestTide: 'all' },
  mountmaunganui: { name: 'Mount Maunganui', region: 'Bay of Plenty, New Zealand', blurb: "New Zealand's most popular beach break, below the Mount.", lat: -37.64, lon: 176.18, offshoreDeg: 250, swellWindow: [20, 110], bestTide: 'all' },
  sombrio: { name: 'Sombrio Beach', region: 'British Columbia, Canada', blurb: 'Cold, remote beach break down a forest trail on Vancouver Island.', lat: 48.5, lon: -124.3, offshoreDeg: 70, swellWindow: [200, 290], bestTide: 'all' },
  saltcreek: { name: 'Salt Creek', region: 'Dana Point, CA', blurb: "Reliable reef and beach peaks below the bluff, one of Orange County's best.", lat: 33.48, lon: -117.72, offshoreDeg: 50, swellWindow: [180, 270], bestTide: 'all' },
  pacificbeach: { name: 'Pacific Beach', region: 'San Diego, CA', blurb: "Sandbars either side of Crystal Pier, the city's everyday beach break.", lat: 32.79, lon: -117.25, offshoreDeg: 90, swellWindow: [240, 330], bestTide: 'all' },
  oceancitymd: { name: 'Ocean City', region: 'Maryland, USA', blurb: 'Mid-Atlantic beach break that comes alive on a hurricane swell.', lat: 38.34, lon: -75.08, offshoreDeg: 270, swellWindow: [60, 150], bestTide: 'all' },

  // Southern Africa — added on request. The catalog had 14 spots across the whole region: seven
  // in South Africa (a country with ~2,800km of surfable coast), one in Namibia, two in
  // Mozambique, one in Angola, three in Mauritius, and nothing at all in Madagascar or Réunion.
  // These 31 cover the South African coast properly end to end, give Namibia, Mozambique and
  // Angola a second and third spot each, and open two new countries.
  //
  // Same provenance caveat as every earlier batch: coordinates place each break to within a few
  // hundred metres, which is what the globe and the directions link need, and come from general
  // knowledge rather than a surveyed dataset. Bruce's Beauties and Mdumbi are the loosest of
  // these — both are named breaks without widely published coordinates, placed against the
  // nearest documented reference point.
  //
  // The offshore wind on the South African west and south coasts is the summer south-easter;
  // on the KwaZulu-Natal and Wild Coast side, which faces east, it is a westerly. Both are
  // reflected in `offshoreDeg` below, which is why spots a few hundred kilometres apart in the
  // same country carry offshore directions nearly opposite each other.

  // Western Cape — Cape Peninsula and the cold Atlantic side
  kommetjie: { name: 'Long Beach (Kommetjie)', region: 'Cape Town, South Africa', blurb: "Cape Town's most surfed beach break, sheltered enough to work when the peninsula is blown out.", lat: -34.133, lon: 18.327, offshoreDeg: 130, swellWindow: [200, 300], bestTide: 'all' },
  llandudno: { name: 'Llandudno', region: 'Cape Town, South Africa', blurb: 'A short, punchy beach break in a granite boulder cove under Table Mountain.', lat: -34.008, lon: 18.342, offshoreDeg: 110, swellWindow: [200, 285], bestTide: 'all' },
  scarboroughct: { name: 'Scarborough Beach', region: 'Cape Peninsula, South Africa', blurb: 'Exposed, powerful peaks at the wild end of the peninsula, well clear of the city.', lat: -34.197, lon: 18.372, offshoreDeg: 110, swellWindow: [200, 290], bestTide: 'all' },
  bigbay: { name: 'Big Bay', region: 'Bloubergstrand, South Africa', blurb: 'Table Bay beach break with the mountain as a backdrop, windy enough to be a kite hub too.', lat: -33.794, lon: 18.457, offshoreDeg: 110, swellWindow: [230, 320], bestTide: 'all' },

  // Southern Cape and the Garden Route — warmer, and out of the worst of the Cape wind
  victoriabay: { name: 'Victoria Bay', region: 'Garden Route, South Africa', blurb: 'A right point peeling down a narrow bay with a handful of houses and nowhere to park.', lat: -34.0, lon: 22.549, offshoreDeg: 330, swellWindow: [170, 250], bestTide: 'mid' },
  outerpool: { name: 'Outer Pool', region: 'Mossel Bay, South Africa', blurb: 'Long right walls wrapping around Cape St Blaize into the bay, sheltered from the westerly.', lat: -34.188, lon: 22.156, offshoreDeg: 270, swellWindow: [180, 250], bestTide: 'all' },
  buffalobay: { name: 'Buffalo Bay', region: 'Knysna, South Africa', blurb: 'A long, forgiving right point at the end of a sandy bay, one of the coast\'s easier waves.', lat: -34.085, lon: 22.997, offshoreDeg: 340, swellWindow: [170, 240], bestTide: 'all' },
  wilderness: { name: 'Wilderness', region: 'Garden Route, South Africa', blurb: 'Miles of open beach break between the lagoon and the Outeniqua mountains.', lat: -33.997, lon: 22.583, offshoreDeg: 350, swellWindow: [170, 250], bestTide: 'all' },
  lookoutbeach: { name: 'Lookout Beach', region: 'Plettenberg Bay, South Africa', blurb: 'Sandbars at the river mouth in a wide, sheltered bay, busy every summer holiday.', lat: -34.057, lon: 23.38, offshoreDeg: 330, swellWindow: [160, 240], bestTide: 'all' },

  // Eastern Cape — the point-break coast
  brucesbeauties: { name: "Bruce's Beauties", region: 'Cape St Francis, South Africa', blurb: 'The perfect wave of The Endless Summer — rarely as flawless as the film, still worth the wait.', lat: -34.198, lon: 24.847, offshoreDeg: 300, swellWindow: [190, 250], bestTide: 'all' },
  pipepe: { name: 'Pipe', region: 'Gqeberha, South Africa', blurb: "Summerstrand's reef peak, the city wave for what used to be called Port Elizabeth.", lat: -33.985, lon: 25.664, offshoreDeg: 290, swellWindow: [140, 220], bestTide: 'all' },
  nahoonreef: { name: 'Nahoon Reef', region: 'East London, South Africa', blurb: 'A hollow right reef off the river mouth, and the first surf spot in Africa to be legally protected.', lat: -32.988, lon: 27.949, offshoreDeg: 300, swellWindow: [140, 220], bestTide: 'mid' },
  mdumbi: { name: 'Mdumbi', region: 'Wild Coast, South Africa', blurb: 'A right point off a green headland with no road worth the name and no crowd.', lat: -31.937, lon: 29.178, offshoreDeg: 300, swellWindow: [130, 200], bestTide: 'all' },
  coffeebay: { name: 'Coffee Bay', region: 'Wild Coast, South Africa', blurb: 'A bay break below the Transkei hills, a long way from anywhere and better for it.', lat: -31.988, lon: 29.147, offshoreDeg: 300, swellWindow: [130, 200], bestTide: 'all' },

  // KwaZulu-Natal — warm water, and the country's densest surf population
  scottburgh: { name: 'Scottburgh', region: 'KwaZulu-Natal, South Africa', blurb: 'A right point off the rocks with a protected corner beside it, the South Coast standard.', lat: -30.287, lon: 30.754, offshoreDeg: 260, swellWindow: [110, 190], bestTide: 'all' },
  stmichaels: { name: "St Michael's-on-Sea", region: 'KwaZulu-Natal, South Africa', blurb: 'Shark-netted beach break at Margate, consistent through the winter swell season.', lat: -30.78, lon: 30.447, offshoreDeg: 260, swellWindow: [110, 190], bestTide: 'all' },
  umhlanga: { name: 'Umhlanga Rocks', region: 'KwaZulu-Natal, South Africa', blurb: 'Beach peaks under the lighthouse just north of Durban, warm enough to surf in trunks.', lat: -29.727, lon: 31.087, offshoreDeg: 250, swellWindow: [100, 180], bestTide: 'all' },
  alkantstrand: { name: 'Alkantstrand', region: 'Richards Bay, South Africa', blurb: 'Sheltered sandbars beside the harbour wall, the northernmost surf of any size in the country.', lat: -28.79, lon: 32.092, offshoreDeg: 250, swellWindow: [90, 170], bestTide: 'all' },

  // Namibia — a cold, foggy desert coast with almost nobody on it
  swakopmund: { name: 'Swakopmund', region: 'Erongo, Namibia', blurb: 'Cold Benguela-current peaks off a German colonial town at the edge of the Namib.', lat: -22.679, lon: 14.517, offshoreDeg: 90, swellWindow: [190, 250], bestTide: 'all' },
  langstrand: { name: 'Langstrand', region: 'Erongo, Namibia', blurb: 'A long open beach between Swakopmund and Walvis Bay, exposed to every South Atlantic swell.', lat: -22.833, lon: 14.533, offshoreDeg: 90, swellWindow: [190, 250], bestTide: 'all' },

  // Angola
  baiaazul: { name: 'Baía Azul', region: 'Benguela, Angola', blurb: 'A sheltered blue bay south of Benguela, mellow and almost always empty.', lat: -12.62, lon: 13.25, offshoreDeg: 100, swellWindow: [200, 285], bestTide: 'all' },
  palmeirinhas: { name: 'Ponta das Palmeirinhas', region: 'Luanda, Angola', blurb: 'Beach and point setups on the sand spit south of Luanda, past the lighthouse.', lat: -9.08, lon: 12.99, offshoreDeg: 80, swellWindow: [200, 290], bestTide: 'all' },

  // Mozambique
  pontamalongane: { name: 'Ponta Malongane', region: 'Maputo, Mozambique', blurb: 'Right-hand points down the dune coast from Ponta do Ouro, reached on sand tracks.', lat: -26.765, lon: 32.897, offshoreDeg: 265, swellWindow: [100, 180], bestTide: 'all' },
  zavora: { name: 'Závora', region: 'Inhambane, Mozambique', blurb: 'A long right reef off the point, with warm water and a lighthouse for a landmark.', lat: -24.517, lon: 35.2, offshoreDeg: 260, swellWindow: [100, 180], bestTide: 'all' },
  macaneta: { name: 'Macaneta', region: 'Maputo, Mozambique', blurb: 'Beach break over the river from the capital, the closest surf to Maputo.', lat: -25.75, lon: 32.75, offshoreDeg: 260, swellWindow: [90, 170], bestTide: 'all' },

  // Madagascar — a first entry for the fourth-largest island in the world
  lavanono: { name: 'Lavanono', region: 'Androy, Madagascar', blurb: 'A left point on the southern tip of the island, days from the nearest tarred road.', lat: -25.427, lon: 44.96, offshoreDeg: 20, swellWindow: [180, 250], bestTide: 'all' },
  anakao: { name: 'Anakao', region: 'Atsimo-Andrefana, Madagascar', blurb: 'Reef passes outside the barrier off a Vezo fishing village, reached by pirogue.', lat: -23.665, lon: 43.647, offshoreDeg: 90, swellWindow: [190, 260], bestTide: 'all' },
  libanona: { name: 'Libanona', region: 'Anosy, Madagascar', blurb: 'A protected beach break in town at Tôlanaro, the easiest wave to reach in the country.', lat: -25.04, lon: 46.995, offshoreDeg: 320, swellWindow: [150, 230], bestTide: 'all' },

  // Réunion — world-class, and heavily restricted. Surfing has been banned outside supervised
  // zones since 2013 after a run of fatal shark attacks; the blurbs say so, because turning up
  // to a spot here without knowing that is a genuine safety problem rather than a trivia point.
  saintleu: { name: 'Saint-Leu', region: 'Réunion', blurb: 'A world-class left over coral. Surfing is restricted to supervised sessions since the 2013 shark ban.', lat: -21.17, lon: 55.283, offshoreDeg: 70, swellWindow: [200, 290], bestTide: 'all' },
  boucancanot: { name: 'Boucan Canot', region: 'Réunion', blurb: 'One of the few netted, supervised zones on the island, and busy because of it.', lat: -21.025, lon: 55.228, offshoreDeg: 80, swellWindow: [230, 320], bestTide: 'all' },
  troisbassins: { name: 'Trois-Bassins', region: 'Réunion', blurb: 'A fast left down the reef, inside the area closed to surfing outside supervised sessions.', lat: -21.098, lon: 55.247, offshoreDeg: 70, swellWindow: [200, 290], bestTide: 'all' },
};
export const ORDER = ['trestles', 'blacks', 'rincon', 'wedge', 'pipeline', 'teahupoo', 'jbay', 'uluwatu', 'snapper', 'nazare', 'chicama', 'raglan', 'puertoescondido', 'hossegor', 'mundaka', 'cloudbreak', 'skeletonbay', 'pavones', 'fistral', 'anchorpoint', 'margaretriver', 'montauk', 'arugambay', 'gland', 'siargao', 'ericeira', 'desertpoint', 'tofino', 'joaquina', 'puntadelobos', 'shonan', 'kovalam', 'caesarea', 'elcotillo', 'popoyo', 'santacatalina', 'deadmans', 'muine', 'laentrada', 'montoya', 'darne', 'capesolander', 'masnou', 'capomarina',
  'malibu', 'steamerlane', 'mavericks', 'waimeabay', 'sunsetbeach', 'honoluabay', 'hookipa', 'sayulita', 'barradelacruz', 'playahermosa', 'witchsrock', 'salsabrava', 'elsunzal', 'puntaroca', 'picoalto', 'mancora', 'guardadoembau', 'itacare', 'rinconpr', 'soupbowl', 'lasanta', 'elconfital', 'supertubos', 'amado', 'thursoeast', 'bundoran', 'lacanau', 'anglet', 'dungeons', 'elandsbay', 'padangpadang', 'keramas', 'lakeypeak', 'lagundribay', 'macaronis', 'bellsbeach', 'byronbay', 'angourie', 'narrabeen', 'kirra', 'piha', 'onjuku', 'hikkaduwa', 'weligama', 'namotu', 'imsouane', 'tamarin', 'zarautz', 'croyde', 'unstad', 'jungmun', 'riyuebay', 'jinzun', 'pontadoouro', 'lennoxhead',
  'huntingtonbeach', 'oceanbeachsf', 'swamis', 'rockawaybeach', 'capehatteras', 'follybeach', 'newsmyrnabeach', 'peahi', 'alamoana', 'hanalei', 'shortsands', 'westport', 'todossantos', 'laticla', 'puntamita', 'tamarindo', 'dominical', 'venao', 'playacolorado', 'cabarete', 'lawrencetown', 'pichilemu', 'arica', 'montanita', 'maresias', 'lapaloma', 'watergatebay', 'porthleven', 'rhossili', 'lahinch', 'mullaghmore', 'biarritz', 'somo', 'carcavelos', 'sandvik', 'hashpoint', 'ngor', 'caverock', 'canggu', 'nihiwatu', 'bawa', 'launion', 'miyazaki', 'midigama', 'waao', 'pastapoint', 'oneeye', 'noosaheads', 'burleighheads', 'shipsternbluff', 'thebox', 'cactus', 'restaurants', 'shipwreckbay', 'sunsetcliffs', 'sanonofre', 'cardiffreef', 'oceansidepier', 'venturapoint', 'countyline', 'pleasurepoint', 'lindamar', 'windansea', 'elporto', 'zuma', 'sebastianinlet', 'cocoabeach', 'wrightsville', 'virginiabeach', 'longbeachny', 'narragansett', 'manasquan', 'jaws', 'rockypoint', 'queens', 'makaha', 'scorpionbay', 'sanmiguel', 'troncones', 'elzonte', 'lasflores', 'olliespoint', 'nosara', 'bocasbluff', 'lobitos', 'iquique', 'matanzas', 'saquarema', 'noronha', 'praiadorosa', 'guincho', 'sagres', 'pantin', 'rodiles', 'capbreton', 'easkey', 'porthcawl', 'saltburn', 'scheveningen', 'sylt', 'klitmoller', 'hoddevik', 'killerpoint', 'safi', 'dakhla', 'sealpoint', 'muizenberg', 'newpier', 'tofo', 'hiltonbeach', 'hollowtrees', 'bingin', 'medewi', 'tland', 'krui', 'kata', 'ikumi', 'baler', 'chickens', 'winkipop', 'crescenthead', 'duranbah', 'maroubra', 'bondi', 'manly', 'gnaraloo', 'redbluff', 'yallingup', 'stclair', 'makorori', 'fitzroybeach', 'nahariya', 'akko', 'batgalim', 'atlit', 'habonim', 'nahsholim', 'beithanania', 'michmoret', 'beityanai', 'sironit', 'poleg', 'herzliya', 'maravi', 'bananabeach', 'batyam', 'palmachim', 'ashdod', 'ashkelon', 'mardelplata', 'necochea', 'miramar', 'puntadeleste', 'itamambuca', 'imbituba', 'buchupureo', 'curanipe', 'caboblanco', 'pacasmayo', 'puntarocas', 'ayampe', 'elparedon', 'maderas', 'lasaladita', 'puntaconejo', 'bostonbay', 'playagrande', 'gaschambers', 'freightsbay', 'mountirvine', 'ribeiragrande', 'jardimdomar', 'pontapreta', 'yoff', 'busua', 'robertsport', 'burehbeach', 'caboledo', 'diani', 'batroun', 'curium', 'levanto', 'santamarinella', 'machrihanish', 'peasebay', 'thorlakshofn', 'toro', 'oostende', 'coxos', 'praiagrande', 'razo', 'menakoz', 'lafitenia', 'mulki', 'manapad', 'sultans', 'cherating', 'mykhe', 'calicoan', 'fulong', 'kamogawa', 'songjeong', 'haatafu', 'salani', 'pangopoint', 'ouano', 'vanimo', 'ppass', 'boatbasin', 'bawleypoint', 'werribeach', 'scarboroughwa', 'whangamata', 'mountmaunganui', 'sombrio', 'saltcreek', 'pacificbeach', 'oceancitymd',
  'kommetjie', 'llandudno', 'scarboroughct', 'bigbay', 'victoriabay', 'outerpool', 'buffalobay', 'wilderness', 'lookoutbeach', 'brucesbeauties', 'pipepe', 'nahoonreef', 'mdumbi', 'coffeebay', 'scottburgh', 'stmichaels', 'umhlanga', 'alkantstrand', 'swakopmund', 'langstrand', 'baiaazul', 'palmeirinhas', 'pontamalongane', 'zavora', 'macaneta', 'lavanono', 'anakao', 'libanona', 'saintleu', 'boucancanot', 'troisbassins'];
export const ONBOARDING_PICKS = ['trestles', 'pipeline', 'jbay', 'uluwatu', 'nazare', 'snapper', 'mundaka'];

export const HOUR_LABELS = ['5a', '7a', '9a', '11a', '1p', '3p', '5p', '7p'];
export const HOUR_INDICES = [5, 7, 9, 11, 13, 15, 17, 19];
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Find built-in spots by name or region.
//
// The search sheet only ever geocoded arbitrary place names, which was fine when the catalog
// was a few dozen spots you could scroll past. At 300+ there is otherwise no way to reach one
// by name, and searching for a spot that is already here would offer to add a *duplicate* of it
// as a custom spot.
//
// Ranked so an exact name match beats a name that merely starts with the query, which beats one
// that contains it, which beats a region match — otherwise typing "Bells" can put a beach in
// another hemisphere above Bells Beach.
export function searchCatalog(spots, query, limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < 2 || !spots) return [];
  const scored = [];
  for (const [id, s] of Object.entries(spots)) {
    if (!s || !s.name) continue;
    const name = s.name.toLowerCase();
    const region = String(s.region || '').toLowerCase();
    let rank = null;
    if (name === q) rank = 0;
    else if (name.startsWith(q)) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (region.includes(q)) rank = 3;
    if (rank != null) scored.push({ id, spot: s, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || a.spot.name.localeCompare(b.spot.name));
  return scored.slice(0, limit);
}
