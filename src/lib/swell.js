import { degToCompass } from './rating.js';

// Sea state is not one wave. At any moment there is usually a long-period groundswell that
// travelled in from a distant storm, plus a short-period wind swell raised by whatever the
// local wind is doing — and they can arrive from completely different directions.
//
// The app used to collapse all of that into one height and one period, which throws away the
// distinction that matters most: 2ft at 14s from the south-west is a clean, powerful,
// well-spaced day, and 2ft at 6s from the west is junk. Same number on the front of the card.
// Every serious forecast (MSW, Windguru, Surfline) breaks the trains out for exactly this
// reason, and Open-Meteo already returns them separately as swell_wave_* and wind_wave_*.

// Below this a train is not worth listing — it is a ripple riding on the one that matters, and
// naming it just makes the card busier.
const MIN_LISTED_FT = 0.5;

export function describeTrain(heightFt, periodS, directionDeg) {
  if (heightFt == null || heightFt < MIN_LISTED_FT) return null;
  return {
    heightFt,
    period: periodS != null ? Math.round(periodS) : null,
    deg: directionDeg,
    dir: directionDeg != null ? degToCompass(directionDeg) : null,
    kind: classifyTrain(periodS),
  };
}

// The period is what separates a swell that has travelled from one being made locally right
// now. The thresholds match the ones conditionsScore already uses to reward period, so the
// label and the rating never disagree with each other.
export function classifyTrain(periodS) {
  if (periodS == null) return 'swell';
  if (periodS >= 12) return 'groundswell';
  if (periodS >= 9) return 'mid-period';
  return 'windswell';
}

// Both trains, biggest first, with anything negligible dropped.
export function swellTrains({ swellHeightFt, swellPeriod, swellDeg, windWaveHeightFt, windWavePeriod, windWaveDeg }) {
  const trains = [
    describeTrain(swellHeightFt, swellPeriod, swellDeg),
    describeTrain(windWaveHeightFt, windWavePeriod, windWaveDeg),
  ].filter(Boolean);
  trains.sort((a, b) => b.heightFt - a.heightFt);
  return trains;
}

// Wetsuit guidance from water temperature.
//
// Ranges follow the thicknesses wetsuit makers themselves publish. Deliberately a range rather
// than one answer, because tolerance varies enormously between people and the boundaries are
// not sharp — the point is to answer "what do I take to the beach", not to be prescriptive.
const WETSUITS = [
  { maxC: 5.5, suit: '6/5mm + hood, boots, gloves' },
  { maxC: 9.5, suit: '5/4mm + hood and boots' },
  { maxC: 13, suit: '4/3mm + boots' },
  { maxC: 16.5, suit: '3/2mm full suit' },
  { maxC: 20.5, suit: '2mm spring suit' },
  { maxC: 23.5, suit: 'Shorty or boardshorts' },
  { maxC: Infinity, suit: 'Boardshorts' },
];

export function wetsuitFor(tempC) {
  if (tempC == null || Number.isNaN(tempC)) return null;
  return WETSUITS.find((w) => tempC <= w.maxC).suit;
}

export function cToF(c) { return c == null ? null : (c * 9) / 5 + 32; }
