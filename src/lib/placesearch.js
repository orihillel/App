// Folding a place name down to what someone actually types on a phone.
//
// Two things kept the catalog search from finding spots that were already in it. Accents:
// "Nazaré" is what the list says, "Nazare" is what an English keyboard produces, and a plain
// substring match found nothing -- 83 of the 718 spots carry a character that is not on that
// keyboard, the most famous wave in the world among them. Punctuation: "Peʻahi (Jaws)" and
// "Ha'atafu" have marks nobody types either.
//
// Apostrophes and the Hawaiian ʻokina close up rather than becoming spaces, because "Peʻahi" is
// typed "Peahi", not "Pe ahi". Everything else that is not a letter or digit becomes a space,
// so "P-Pass" still answers to "p pass".
const COMBINING = /[̀-ͯ]/g;
const CLOSERS = /['‘’`´ʻʼ]/g;

// Letters that are their own codepoint rather than a letter plus an accent, so NFD leaves them
// untouched and stripping combining marks does nothing for them. Kept as a table because the
// catalog is hand-edited: the next Danish or Icelandic spot someone adds should be findable
// without anyone remembering this file exists.
const TRANSLIT = { ø: 'o', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd', ł: 'l', ħ: 'h', đ: 'd', ı: 'i', ß: 'ss' };

export function foldText(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(COMBINING, '')
    .toLowerCase()
    .replace(CLOSERS, '')
    .replace(/[^a-z0-9]/g, (ch) => TRANSLIT[ch] || ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// The country (and state) a region names only implicitly.
//
// The catalog writes regions the way a surfer would say them -- "San Clemente, CA", "Oahu,
// Hawaii", "Cornwall, England" -- which means the country is often missing entirely, and a US
// state is sometimes an abbreviation. Someone searching "California" or "USA" or "United
// Kingdom" should still reach those spots, so each region segment contributes the names it
// stands for as well as itself.
//
// Keyed on a whole folded segment, never a substring: "CA" as a substring would match Cascais.
// Every entry here is a plain geographic fact -- a state, a territory, or an overseas region of
// the country it maps to -- not a guess about which country a spot "feels" like.
const SEGMENT_ALIASES = {
  usa: 'united states america',
  ca: 'california usa united states america',
  california: 'usa united states america',
  hawaii: 'usa united states america',
  'puerto rico': 'usa united states america',
  guam: 'usa united states america',
  uk: 'united kingdom britain',
  england: 'uk united kingdom britain',
  scotland: 'uk united kingdom britain',
  wales: 'uk united kingdom britain',
  'northern ireland': 'uk united kingdom britain',
  bermuda: 'uk united kingdom britain',
  'canary islands': 'spain',
  azores: 'portugal',
  'french polynesia': 'france',
  reunion: 'france',
  martinique: 'france',
  guadeloupe: 'france',
  'new caledonia': 'france',
  'faroe islands': 'denmark',
  uae: 'united arab emirates',
};

// Everything one spot can be found by, folded and flattened into a single string: its name, each
// part of its region, and whatever country those parts imply.
//
// Split on commas before folding, because folding turns the commas into spaces and the segment
// boundaries are what the alias table keys on.
//
// Cached per spot object: this runs for all 718 spots on every keystroke, and folding them fresh
// each time measured 3.25ms a keystroke on a desktop, which is a frame budget a phone does not
// have. The catalog replaces spot objects rather than mutating them (see setSpots in App.jsx),
// so an edited spot is a new key and recomputes on its own.
const CACHE = new WeakMap();
export function spotSearchText(spot) {
  if (!spot) return '';
  const hit = CACHE.get(spot);
  if (hit !== undefined) return hit;
  const segments = String(spot.region || '').split(',').map(foldText).filter(Boolean);
  const implied = segments.map((seg) => SEGMENT_ALIASES[seg]).filter(Boolean);
  const text = [foldText(spot.name), ...segments, ...implied].join(' ');
  CACHE.set(spot, text);
  return text;
}
