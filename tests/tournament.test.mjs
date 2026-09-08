import test from 'node:test';
import assert from 'node:assert/strict';
import { tournamentPoints, scorePlacements, rankStandings } from '../src/lib/tournament.ts';

test('agreed scoring examples remain stable', () => {
  const cases = new Map([
    [4, [6, 3, 2, 1]], [6, [7, 4, 3, 2, 1, 1]], [8, [8, 6, 4, 3, 2, 2, 1, 1]],
    [10, [9, 6, 5, 4, 3, 2, 2, 1, 1, 1]], [12, [9, 7, 6, 4, 4, 3, 2, 2, 2, 1, 1, 1]],
    [14, [10, 8, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1, 1, 1]], [16, [11, 8, 7, 6, 5, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1, 1]]
  ]);
  for (const [n, expected] of cases) assert.deepEqual(Array.from({ length: n }, (_, i) => tournamentPoints(n, i + 1)), expected);
  for (const [n, podium] of [[24, [12, 9, 8]], [32, [13, 11, 9]], [48, [14, 12, 11]], [64, [16, 13, 12]]]) {
    assert.deepEqual([1, 2, 3].map((r) => tournamentPoints(n, r)), podium);
  }
});

test('all placements are monotone integers with a unique podium and last place one', () => {
  for (let n = 4; n <= 256; n++) {
    let previous = Infinity;
    for (let rank = 1; rank <= n; rank++) {
      const points = tournamentPoints(n, rank);
      assert.ok(Number.isInteger(points) && points >= 1);
      assert.ok(points <= previous);
      if (rank <= 4) assert.ok(points < previous);
      previous = points;
    }
    assert.equal(previous, 1);
  }
});

test('exact logarithm boundaries and invalid inputs', () => {
  assert.equal(tournamentPoints(12, 3), 6);
  assert.equal(tournamentPoints(48, 3), 11);
  assert.equal(tournamentPoints(2, 2), 1);
  assert.equal(tournamentPoints(1, 1), 1);
  for (const [n, r] of [[0, 1], [4, 0], [4, 5], [4.5, 1], [4, 1.1], [NaN, 1], [Infinity, 1]]) {
    assert.throws(() => tournamentPoints(n, r));
  }
});

test('results reject duplicate players, shared ranks, gaps, and invalid placements', () => {
  for (const rows of [
    [{ memberId: 'a', rank: 1 }, { memberId: 'a', rank: 2 }],
    [{ memberId: 'a', rank: 1 }, { memberId: 'b', rank: 1 }],
    [{ memberId: 'a', rank: 1 }, { memberId: 'b', rank: 3 }],
    [{ memberId: 'a', rank: -1 }], [{ memberId: '', rank: 1 }]
  ]) assert.throws(() => scorePlacements(rows));
  assert.deepEqual(scorePlacements([{ memberId: 'b', rank: 2 }, { memberId: 'a', rank: 1 }]), [
    { memberId: 'a', rank: 1, points: 3 }, { memberId: 'b', rank: 2, points: 1 }
  ]);
});

test('league totals use competition ranking for ties', () => {
  const rows = rankStandings([
    { memberId: 'a', name: 'A', points: 10 }, { memberId: 'b', name: 'B', points: 8 },
    { memberId: 'c', name: 'C', points: 8 }, { memberId: 'd', name: 'D', points: 0 }
  ]);
  assert.deepEqual(rows.map((row) => row.rank), [1, 2, 2, 4]);
});
