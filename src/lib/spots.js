// Seed spot data. See HANDOFF.md for provenance notes — most of these were
// re-verified against real sources, a few were corrected (see git history).
export const SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA', blurb: 'Cobblestone point wrapping into long, workable walls. Best before the wind fills in.', lat: 33.3825, lon: -117.5972, offshoreDeg: 60 },
  blacks: { name: 'Blacks Beach', region: 'La Jolla, CA', blurb: 'Deep submarine canyon keeps it offshore-groomed most of the day. Powerful and hollow.', lat: 32.8991, lon: -117.2528, offshoreDeg: 90 },
  rincon: { name: 'Rincon', region: 'Santa Barbara, CA', blurb: 'Long, playful walls peeling down the point. Small today, but silky smooth.', lat: 34.3739, lon: -119.4763, offshoreDeg: 350 },
  wedge: { name: 'The Wedge', region: 'Newport Beach, CA', blurb: 'Ledgy, close-interval peaks off the jetty. Heavy, and not for the faint of heart.', lat: 33.5952, lon: -117.8822, offshoreDeg: 30 },
  pipeline: { name: 'Pipeline', region: 'Oahu, Hawaii', blurb: "World-famous reef barrel on the North Shore. Heavy, shallow, and unforgiving when it's on.", lat: 21.6647, lon: -158.0538, offshoreDeg: 200 },
  teahupoo: { name: "Teahupo'o", region: 'Tahiti, French Polynesia', blurb: 'One of the heaviest, thickest waves on the planet, breaking over shallow coral.', lat: -17.8570, lon: -149.2680, offshoreDeg: 20 },
  jbay: { name: 'Jeffreys Bay', region: 'Eastern Cape, South Africa', blurb: 'Long, high-speed right point — one of the best walls in the world when it lines up.', lat: -34.0489, lon: 24.9087, offshoreDeg: 325 },
  uluwatu: { name: 'Uluwatu', region: 'Bali, Indonesia', blurb: "Dramatic reef break beneath a clifftop temple, with several sections down the point.", lat: -8.8290, lon: 115.0870, offshoreDeg: 50 },
  snapper: { name: 'Snapper Rocks', region: 'Gold Coast, Australia', blurb: 'The Superbank — impossibly long, fast right points when the sand banks line up.', lat: -28.1590, lon: 153.5470, offshoreDeg: 250 },
  nazare: { name: 'Nazaré', region: 'Portugal', blurb: 'Home to some of the biggest waves ever surfed, thanks to an underwater canyon offshore.', lat: 39.6033, lon: -9.0705, offshoreDeg: 85 },
  chicama: { name: 'Chicama', region: 'La Libertad, Peru', blurb: 'The longest left-hand point wave in the world — rides can last over a minute.', lat: -7.7000, lon: -79.4500, offshoreDeg: 135 },
  raglan: { name: 'Raglan', region: 'Waikato, New Zealand', blurb: 'Classic left point break, one of the most consistent walls in the Southern Hemisphere.', lat: -37.8010, lon: 174.8710, offshoreDeg: 95 },
  puertoescondido: { name: 'Puerto Escondido', region: 'Oaxaca, Mexico', blurb: "Nicknamed the Mexican Pipeline — a powerful, sandy-bottom beach break barrel.", lat: 15.8720, lon: -97.0767, offshoreDeg: 15 },
  hossegor: { name: 'Hossegor', region: 'France', blurb: 'Punchy, powerful Atlantic beach breaks that host a stop on the world tour.', lat: 43.6640, lon: -1.4400, offshoreDeg: 90 },
  mundaka: { name: 'Mundaka', region: 'Basque Country, Spain', blurb: 'A world-class left river-mouth wave that peels around a sandbar.', lat: 43.4070, lon: -2.6990, offshoreDeg: 180 },
  cloudbreak: { name: 'Cloudbreak', region: 'Mamanuca Islands, Fiji', blurb: 'A world-class reef pass left, breaking over shallow coral in the open ocean.', lat: -17.8600, lon: 177.2000, offshoreDeg: 130 },
  skeletonbay: { name: 'Skeleton Bay', region: 'Namibia', blurb: 'A freakishly long, mechanical sand-point left along a remote desert coastline.', lat: -22.9590, lon: 14.4930, offshoreDeg: 165 },
  pavones: { name: 'Pavones', region: 'Golfo Dulce, Costa Rica', blurb: 'One of the longest lefts in the world, wrapping into a jungle-lined bay.', lat: 8.3830, lon: -83.1500, offshoreDeg: 25 },
  fistral: { name: 'Fistral Beach', region: 'Newquay, Cornwall, UK', blurb: "The UK's best-known beach break, exposed to the full force of the Atlantic.", lat: 50.4160, lon: -5.1020, offshoreDeg: 90 },
  anchorpoint: { name: 'Anchor Point', region: 'Taghazout, Morocco', blurb: 'A classic North African right point, long and mellow when it wraps in clean.', lat: 30.5460, lon: -9.7100, offshoreDeg: 85 },
  margaretriver: { name: 'Margaret River', region: 'Western Australia', blurb: 'Powerful, chilly reef and point breaks along a wild stretch of coastline.', lat: -33.9750, lon: 115.0750, offshoreDeg: 90 },
  montauk: { name: 'Montauk', region: 'New York, USA', blurb: 'Classic East Coast beach and reef breaks at the tip of Long Island.', lat: 41.0500, lon: -71.9200, offshoreDeg: 330 },
  arugambay: { name: 'Arugam Bay', region: 'Sri Lanka', blurb: "A long, sandy-bottomed right point on Sri Lanka's east coast.", lat: 6.8400, lon: 81.8300, offshoreDeg: 270 },
  gland: { name: 'G-Land', region: 'East Java, Indonesia', blurb: 'A legendary, remote left reef break inside a jungle bay.', lat: -8.7304, lon: 114.3526, offshoreDeg: 35 },
  siargao: { name: 'Siargao (Cloud 9)', region: 'Philippines', blurb: 'A hollow, powerful reef pass that put the Philippines on the surfing map.', lat: 9.8000, lon: 126.1660, offshoreDeg: 270 },
  ericeira: { name: 'Ericeira', region: 'Portugal', blurb: 'A World Surfing Reserve with a cluster of quality points and reefs.', lat: 38.9630, lon: -9.4160, offshoreDeg: 90 },
  desertpoint: { name: 'Desert Point', region: 'Lombok, Indonesia', blurb: 'One of the fastest, longest tube rides on Earth, over sharp reef.', lat: -8.8900, lon: 116.0400, offshoreDeg: 60 },
  tofino: { name: 'Tofino', region: 'Vancouver Island, Canada', blurb: 'Cold-water Pacific beach breaks framed by old-growth rainforest.', lat: 49.1530, lon: -125.9066, offshoreDeg: 90 },
  joaquina: { name: 'Joaquina', region: 'Florianópolis, Brazil', blurb: 'A popular sandy beach break on Floripa island, consistent and crowd-friendly.', lat: -27.6280, lon: -48.4480, offshoreDeg: 270 },
  puntadelobos: { name: 'Punta de Lobos', region: 'Pichilemu, Chile', blurb: "A powerful, rocky left point on Chile's rugged central coast.", lat: -34.4110, lon: -72.0270, offshoreDeg: 90 },
  shonan: { name: 'Shonan', region: 'Kanagawa, Japan', blurb: "Tokyo's home break — accessible and consistent, a train ride from the city.", lat: 35.3060, lon: 139.4870, offshoreDeg: 0 },
  kovalam: { name: 'Kovalam', region: 'Kerala, India', blurb: "A mellow beach break on India's southwestern coast, warm water year-round.", lat: 8.4004, lon: 76.9787, offshoreDeg: 90 },
  caesarea: { name: 'Caesarea', region: 'Israel', blurb: 'A Mediterranean reef break beside the ruins of an ancient Roman harbor.', lat: 32.5000, lon: 34.9040, offshoreDeg: 90 },
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
};
export const ORDER = ['trestles', 'blacks', 'rincon', 'wedge', 'pipeline', 'teahupoo', 'jbay', 'uluwatu', 'snapper', 'nazare', 'chicama', 'raglan', 'puertoescondido', 'hossegor', 'mundaka', 'cloudbreak', 'skeletonbay', 'pavones', 'fistral', 'anchorpoint', 'margaretriver', 'montauk', 'arugambay', 'gland', 'siargao', 'ericeira', 'desertpoint', 'tofino', 'joaquina', 'puntadelobos', 'shonan', 'kovalam', 'caesarea', 'elcotillo', 'popoyo', 'santacatalina', 'deadmans', 'muine', 'laentrada', 'montoya', 'darne', 'capesolander', 'masnou', 'capomarina'];
export const ONBOARDING_PICKS = ['trestles', 'pipeline', 'jbay', 'uluwatu', 'nazare', 'snapper', 'mundaka'];

export const HOUR_LABELS = ['5a', '7a', '9a', '11a', '1p', '3p', '5p', '7p'];
export const HOUR_INDICES = [5, 7, 9, 11, 13, 15, 17, 19];
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
