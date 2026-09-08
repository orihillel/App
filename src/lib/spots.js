// `swellWindow: [from, to]` is the compass arc (clockwise) a spot actually receives swell
// from, and `bestTide` is the tide it works best on ('low' | 'mid' | 'high' | 'all'). Both are
// optional: spots without them fall back to an arc derived from `offshoreDeg` — see
// lib/spotmodel.js, which explains why the derived arc is only a starting point and why the
// rule it replaced actively penalised the best waves in this list.
// The few spots the app can render before the catalog arrives.
//
// Copied verbatim from spots.catalog.js -- which is the whole 400-spot list, now loaded in its
// own chunk so the first render does not wait for 30KB of it (see loadCatalog below). These
// are the onboarding picks plus the default go-to spot, which between them cover every screen
// that can appear before the catalog lands.
//
// spots.test.js asserts these are byte-identical to their catalog entries, so the copy cannot
// quietly drift from the original.
export const SEED_SPOTS = {
  trestles: { name: 'Lower Trestles', region: 'San Clemente, CA', blurb: 'Cobblestone point wrapping into long, workable walls. Best before the wind fills in.', lat: 33.3825, lon: -117.5972, offshoreDeg: 60, swellWindow: [180, 230], bestTide: 'mid' },
  pipeline: { name: 'Pipeline', region: 'Oahu, Hawaii', blurb: "World-famous reef barrel on the North Shore. Heavy, shallow, and unforgiving when it's on.", lat: 21.6647, lon: -158.0538, offshoreDeg: 200, swellWindow: [290, 350], bestTide: 'mid' },
  jbay: { name: 'Jeffreys Bay', region: 'Eastern Cape, South Africa', blurb: 'Long, high-speed right point — one of the best walls in the world when it lines up.', lat: -34.0489, lon: 24.9087, offshoreDeg: 325, swellWindow: [190, 240], bestTide: 'all' },
  uluwatu: { name: 'Uluwatu', region: 'Bali, Indonesia', blurb: "Dramatic reef break beneath a clifftop temple, with several sections down the point.", lat: -8.8290, lon: 115.0870, offshoreDeg: 50, swellWindow: [200, 250], bestTide: 'mid' },
  nazare: { name: 'Nazaré', region: 'Portugal', blurb: 'Home to some of the biggest waves ever surfed, thanks to an underwater canyon offshore.', lat: 39.6033, lon: -9.0705, offshoreDeg: 85, swellWindow: [280, 330], bestTide: 'all' },
  snapper: { name: 'Snapper Rocks', region: 'Gold Coast, Australia', blurb: 'The Superbank — impossibly long, fast right points when the sand banks line up.', lat: -28.1590, lon: 153.5470, offshoreDeg: 250, swellWindow: [100, 160], bestTide: 'all' },
  mundaka: { name: 'Mundaka', region: 'Basque Country, Spain', blurb: 'A world-class left river-mouth wave that peels around a sandbar.', lat: 43.4070, lon: -2.6990, offshoreDeg: 180, swellWindow: [300, 340], bestTide: 'mid' },
};

// The whole catalog, fetched on demand. Vite gives this its own chunk because the import is
// dynamic, so it downloads alongside the app rather than inside it, and caches separately.
let catalogPromise = null;
export function loadCatalog() {
  // Memoised: several views ask for this independently and none of them should trigger a
  // second fetch or a second parse of a 400-entry object.
  if (!catalogPromise) {
    catalogPromise = import('./spots.catalog.js')
      .then((m) => m.CATALOG)
      .catch((e) => { catalogPromise = null; throw e; }); // let a failed load be retried
  }
  return catalogPromise;
}
export const ORDER = ['trestles', 'blacks', 'rincon', 'wedge', 'pipeline', 'teahupoo', 'jbay', 'uluwatu', 'snapper', 'nazare', 'chicama', 'raglan', 'puertoescondido', 'hossegor', 'mundaka', 'cloudbreak', 'skeletonbay', 'pavones', 'fistral', 'anchorpoint', 'margaretriver', 'montauk', 'arugambay', 'gland', 'siargao', 'ericeira', 'desertpoint', 'tofino', 'joaquina', 'puntadelobos', 'shonan', 'kovalam', 'caesarea', 'elcotillo', 'popoyo', 'santacatalina', 'deadmans', 'muine', 'laentrada', 'montoya', 'darne', 'capesolander', 'masnou', 'capomarina',
  'malibu', 'steamerlane', 'mavericks', 'waimeabay', 'sunsetbeach', 'honoluabay', 'hookipa', 'sayulita', 'barradelacruz', 'playahermosa', 'witchsrock', 'salsabrava', 'elsunzal', 'puntaroca', 'picoalto', 'mancora', 'guardadoembau', 'itacare', 'rinconpr', 'soupbowl', 'lasanta', 'elconfital', 'supertubos', 'amado', 'thursoeast', 'bundoran', 'lacanau', 'anglet', 'dungeons', 'elandsbay', 'padangpadang', 'keramas', 'lakeypeak', 'lagundribay', 'macaronis', 'bellsbeach', 'byronbay', 'angourie', 'narrabeen', 'kirra', 'piha', 'onjuku', 'hikkaduwa', 'weligama', 'namotu', 'imsouane', 'tamarin', 'zarautz', 'croyde', 'unstad', 'jungmun', 'riyuebay', 'jinzun', 'pontadoouro', 'lennoxhead',
  'huntingtonbeach', 'oceanbeachsf', 'swamis', 'rockawaybeach', 'capehatteras', 'follybeach', 'newsmyrnabeach', 'peahi', 'alamoana', 'hanalei', 'shortsands', 'westport', 'todossantos', 'laticla', 'puntamita', 'tamarindo', 'dominical', 'venao', 'playacolorado', 'cabarete', 'lawrencetown', 'pichilemu', 'arica', 'montanita', 'maresias', 'lapaloma', 'watergatebay', 'porthleven', 'rhossili', 'lahinch', 'mullaghmore', 'biarritz', 'somo', 'carcavelos', 'sandvik', 'hashpoint', 'ngor', 'caverock', 'canggu', 'nihiwatu', 'bawa', 'launion', 'miyazaki', 'midigama', 'waao', 'pastapoint', 'oneeye', 'noosaheads', 'burleighheads', 'shipsternbluff', 'thebox', 'cactus', 'restaurants', 'shipwreckbay', 'sunsetcliffs', 'sanonofre', 'cardiffreef', 'oceansidepier', 'venturapoint', 'countyline', 'pleasurepoint', 'lindamar', 'windansea', 'elporto', 'zuma', 'sebastianinlet', 'cocoabeach', 'wrightsville', 'virginiabeach', 'longbeachny', 'narragansett', 'manasquan', 'jaws', 'rockypoint', 'queens', 'makaha', 'scorpionbay', 'sanmiguel', 'troncones', 'elzonte', 'lasflores', 'olliespoint', 'nosara', 'bocasbluff', 'lobitos', 'iquique', 'matanzas', 'saquarema', 'noronha', 'praiadorosa', 'guincho', 'sagres', 'pantin', 'rodiles', 'capbreton', 'easkey', 'porthcawl', 'saltburn', 'scheveningen', 'sylt', 'klitmoller', 'hoddevik', 'killerpoint', 'safi', 'dakhla', 'sealpoint', 'muizenberg', 'newpier', 'tofo', 'hiltonbeach', 'hollowtrees', 'bingin', 'medewi', 'tland', 'krui', 'kata', 'ikumi', 'baler', 'chickens', 'winkipop', 'crescenthead', 'duranbah', 'maroubra', 'bondi', 'manly', 'gnaraloo', 'redbluff', 'yallingup', 'stclair', 'makorori', 'fitzroybeach', 'nahariya', 'akko', 'batgalim', 'atlit', 'habonim', 'nahsholim', 'beithanania', 'michmoret', 'beityanai', 'sironit', 'poleg', 'herzliya', 'maravi', 'bananabeach', 'batyam', 'palmachim', 'ashdod', 'ashkelon', 'mardelplata', 'necochea', 'miramar', 'puntadeleste', 'itamambuca', 'imbituba', 'buchupureo', 'curanipe', 'caboblanco', 'pacasmayo', 'puntarocas', 'ayampe', 'elparedon', 'maderas', 'lasaladita', 'puntaconejo', 'bostonbay', 'playagrande', 'gaschambers', 'freightsbay', 'mountirvine', 'ribeiragrande', 'jardimdomar', 'pontapreta', 'yoff', 'busua', 'robertsport', 'burehbeach', 'caboledo', 'diani', 'batroun', 'curium', 'levanto', 'santamarinella', 'machrihanish', 'peasebay', 'thorlakshofn', 'toro', 'oostende', 'coxos', 'praiagrande', 'razo', 'menakoz', 'lafitenia', 'mulki', 'manapad', 'sultans', 'cherating', 'mykhe', 'calicoan', 'fulong', 'kamogawa', 'songjeong', 'haatafu', 'salani', 'pangopoint', 'ouano', 'vanimo', 'ppass', 'boatbasin', 'bawleypoint', 'werribeach', 'scarboroughwa', 'whangamata', 'mountmaunganui', 'sombrio', 'saltcreek', 'pacificbeach', 'oceancitymd',
  'kommetjie', 'llandudno', 'scarboroughct', 'bigbay', 'victoriabay', 'outerpool', 'buffalobay', 'wilderness', 'lookoutbeach', 'brucesbeauties', 'pipepe', 'nahoonreef', 'mdumbi', 'coffeebay', 'scottburgh', 'stmichaels', 'umhlanga', 'alkantstrand', 'swakopmund', 'langstrand', 'baiaazul', 'palmeirinhas', 'pontamalongane', 'zavora', 'macaneta', 'lavanono', 'anakao', 'libanona', 'saintleu', 'boucancanot', 'troisbassins',
  'termales', 'palomino', 'playaelagua', 'playabaracoa', 'surfersbeach', 'tartane', 'lemoule', 'kalonero', 'falasarna', 'sile', 'kilyos', 'chalupy', 'tjornuvik', 'asparuhovo', 'gonio', 'ghajntuffieha', 'bizerte', 'zeralda', 'agami', 'mughsayl', 'masirah', 'ramin', 'hawkesbay', 'coxsbazar', 'ngwesaung', 'varkala', 'serenitybeach', 'ummsuqeim', 'nouakchott', 'kotupoint', 'assinie', 'tarkwabay', 'kribi', 'santana', 'mayumba', 'pointenoire', 'paje', 'anseintendance', 'khalaktyrsky', 'backbeach', 'titiana', 'avanapassage', 'tsurigasaki', 'shimoda', 'habushiura', 'houhai', 'jukdo', 'cannonbeach', 'pascuales', 'nexpa', 'horseshoebay', 'elpalmar', 'cabedelo', 'latorche', 'capomannu'];
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
