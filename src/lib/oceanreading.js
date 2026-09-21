// Turning one sampled grid cell into words.
//
// Split out of the globe component because it is the honest half of tap-to-read and deserves
// tests of its own: what a reading says when there is nothing to say matters more than what it
// says when there is. A cell with no value is land, ice, or a point the upstream model does not
// cover, and the one thing this must never do is print a number for it.
//
// Why tap-to-read exists at all: a colour ramp carries eight or nine levels from a patch the
// size of a grid cell, and measured under 50,000 lux -- a phone on a beach in sun -- the swell
// ramp keeps about a third of its contrast, which drops the step from a 1m sea to a 1.5m one
// to around 4 dE, under the threshold at which anyone can see it. A number survives sunlight,
// colour-blindness, and the shifting surround that makes matching a cell against a legend
// unreliable even indoors.

const M_TO_FT = 3.28084;
const KPH_TO_MPH = 0.621371;

// The value with its unit, or null when the grid has no reading here.
//
// Wave heights get a decimal because the interesting range is 0-3m and whole metres would
// throw away most of it; wind speeds are whole numbers because nobody cares about a third of a
// kilometre an hour and a decimal there reads as false precision.
export function formatReadingValue(value, layer, units) {
  if (value == null || !Number.isFinite(value)) return null;
  const metric = units !== 'imperial';
  if (layer === 'wind') {
    return Math.round(metric ? value : value * KPH_TO_MPH) + (metric ? 'kph' : 'mph');
  }
  return (metric ? value : value * M_TO_FT).toFixed(1) + (metric ? 'm' : 'ft');
}

// Where the tap landed, in the form a chart plotter would use.
export function formatReadingPlace(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return Math.abs(lat).toFixed(1) + (lat >= 0 ? 'N' : 'S') + ' '
    + Math.abs(lon).toFixed(1) + (lon >= 0 ? 'E' : 'W');
}

// The line under the number.
//
// `fromDeg` is the bearing the swell or wind comes *from*, which is what every marine feed
// reports and the opposite of the way the arrows on the globe point. Saying "from" out loud is
// what stops the two conventions being mistaken for each other -- the arrows say where it is
// going, this says where it came from, and both are labelled.
export function readingDescription(reading, compass) {
  if (!reading) return null;
  if (reading.value == null || !Number.isFinite(reading.value)) {
    return 'No reading here — land, ice, or outside the model';
  }
  const what = reading.layer === 'wind' ? 'wind' : 'swell';
  const dir = reading.fromDeg != null && Number.isFinite(reading.fromDeg) && compass
    ? ' from ' + compass(reading.fromDeg)
    : '';
  return what + dir;
}
