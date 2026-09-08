import { describe, it, expect } from 'vitest';
import { placeLabels, labelRank } from './labelplacement.js';

const box = (id, x, y, rank, w = 100, h = 20) => ({ id, x, y, w, h, rank });

describe('placeLabels', () => {
  it('drops a label that would land on one already placed', () => {
    // The bug this exists for: two names in the same place, drawn on top of each other.
    const out = placeLabels([box('a', 0, 0, 1), box('b', 10, 5, 2)]);
    expect(out).toEqual(['a']);
  });

  it('keeps labels that clear each other', () => {
    const out = placeLabels([box('a', 0, 0, 1), box('b', 0, 40, 2), box('c', 200, 0, 3)]);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('gives the place to the better-ranked label, whatever order they arrive in', () => {
    const shuffled = [box('low', 0, 0, 9), box('high', 5, 5, 1)];
    expect(placeLabels(shuffled)).toEqual(['high']);
  });

  it('never draws more than the cap, however many fit', () => {
    const many = Array.from({ length: 200 }, (_, i) => box('s' + i, (i % 20) * 150, Math.floor(i / 20) * 40, i));
    expect(placeLabels(many, { maxLabels: 14 }).length).toBe(14);
  });

  it('thins a crowded coast to something readable rather than a pile', () => {
    // Fifty spots inside one small patch of screen, which is what zooming to California looks
    // like: they cannot all be drawn, and the old code drew them all anyway.
    const crowd = Array.from({ length: 50 }, (_, i) => box('c' + i, 100 + (i % 7) * 12, 200 + Math.floor(i / 7) * 8, i));
    const out = placeLabels(crowd);
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(12);
  });

  it('treats touching boxes as clashing, since abutting pills are still unreadable', () => {
    const out = placeLabels([box('a', 0, 0, 1, 100, 20), box('b', 100, 0, 2, 100, 20)]);
    expect(out).toEqual(['a']); // padding closes the 0px gap
  });

  it('ignores candidates with a missing or nonsense box instead of throwing', () => {
    const out = placeLabels([
      { id: 'nan', x: NaN, y: 0, w: 10, h: 10, rank: 0 },
      { id: 'zero', x: 0, y: 0, w: 0, h: 10, rank: 1 },
      box('ok', 300, 300, 2),
    ]);
    expect(out).toEqual(['ok']);
  });

  it('returns nothing for nothing', () => {
    expect(placeLabels([])).toEqual([]);
    expect(placeLabels(null)).toEqual([]);
  });
});

describe('labelRank', () => {
  it('prefers what is nearest the middle of the screen — what you zoomed in on', () => {
    const middle = labelRank(195, 400, 390, 800);
    const corner = labelRank(10, 20, 390, 800);
    expect(middle).toBeLessThan(corner);
  });

  it('puts every cluster ahead of every single spot', () => {
    // A count standing for sixty spots must not lose to one name that happens to sit closer in.
    const clusterFarOut = labelRank(0, 0, 390, 800, { isCluster: true });
    const spotDeadCentre = labelRank(195, 400, 390, 800, { isCluster: false });
    expect(clusterFarOut).toBeLessThan(spotDeadCentre);
  });
});
