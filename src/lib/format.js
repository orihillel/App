export function formatWaveRange(str, units) {
  const parts = String(str).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return str;
  if (units === 'metric') return (parts[0] * 0.3048).toFixed(1) + '-' + (parts[1] * 0.3048).toFixed(1);
  return parts[0] + '-' + parts[1];
}
export function formatWaveNum(ft, units) {
  return units === 'metric' ? (ft * 0.3048).toFixed(1) : Math.round(ft);
}
export function formatHeight(ft, units) {
  return units === 'metric' ? (ft * 0.3048).toFixed(1) : ft.toFixed(1);
}
export function formatSpeed(mph, units) {
  return units === 'metric' ? Math.round(mph * 1.60934) : mph;
}
export function waveUnit(units) { return units === 'metric' ? 'M' : 'FT'; }
export function heightUnit(units) { return units === 'metric' ? 'm' : 'ft'; }
export function speedUnit(units) { return units === 'metric' ? 'kph' : 'mph'; }
export function barHeight(wave) {
  const parts = String(wave).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 10;
  const avg = (parts[0] + parts[1]) / 2;
  return 8 + avg * 3;
}
export function hourLabel12(h) {
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return h12 + (h < 12 ? 'a' : 'p');
}
export function waveAvg(wave) {
  const parts = String(wave).split('-').map(Number);
  if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) return 0;
  return (parts[0] + parts[1]) / 2;
}
export function leadTimeLabel(lt) {
  if (lt === '1h') return '1 hour before';
  if (lt === '1d') return '1 day before';
  if (lt === '2d') return '2 days before';
  return '3 days before';
}
// Replaces missing points with the nearest known one, so a gap in a series draws as a flat
// run rather than a spike.
//
// linePath min/max-scales whatever array it is handed, so a stand-in value has to be a height
// the series could actually have had. Substituting zero was harmless while every tide was
// modeled on mean sea level and zero meant mid-tide; on a chart datum, where the whole curve
// is positive and zero is the lowest water there has ever been, it drags the floor of the
// chart down and flattens the real tide into the top of it.
export function fillGaps(values) {
  const out = values.slice();
  let last = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i] == null) out[i] = last;
    else last = out[i];
  }
  // Anything still missing is a run at the very start, before the first known value.
  const first = out.find((v) => v != null);
  return out.map((v) => (v == null ? (first == null ? 0 : first) : v));
}

export function linePath(values, width, height, pad) {
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (width - pad * 2) + pad;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i === 0 ? 'M' + p[0] + ',' + p[1] : 'L' + p[0] + ',' + p[1])).join(' ');
  return { pts, d };
}
