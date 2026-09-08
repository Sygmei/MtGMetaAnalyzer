/** League scoring v1: 1 + floor(2.5 * log2(participants / rank)). */
export const SCORING_VERSION = 'log2-2.5-v1';

export function tournamentPoints(participants: number, rank: number): number {
  if (!Number.isSafeInteger(participants) || participants < 1 || !Number.isSafeInteger(rank) || rank < 1 || rank > participants) {
    throw new Error('Rank must be between 1 and the number of participants.');
  }
  // (N / r)^5 >= 2^(2k) iff the bonus is at least k. Integer arithmetic
  // keeps exact boundaries from rounding down because of floating point error.
  const numerator = BigInt(participants) ** 5n;
  const denominator = BigInt(rank) ** 5n;
  let bonus = Math.floor(2.5 * Math.log2(participants / rank));
  while (numerator < (denominator << BigInt(2 * bonus))) bonus--;
  while (numerator >= (denominator << BigInt(2 * (bonus + 1)))) bonus++;
  return 1 + bonus;
}

export type Placement = { memberId: string; rank: number };

export function scorePlacements(placements: Placement[]) {
  const members = new Set<string>();
  const ranks = new Set<number>();
  for (const row of placements) {
    if (!row.memberId || members.has(row.memberId)) throw new Error('Each player can appear only once.');
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > placements.length || ranks.has(row.rank)) {
      throw new Error('Enter each rank from 1 to the participant count exactly once.');
    }
    members.add(row.memberId);
    ranks.add(row.rank);
  }
  return placements.map((row) => ({ ...row, points: tournamentPoints(placements.length, row.rank) })).sort((a, b) => a.rank - b.rank);
}

export function rankStandings<T extends { memberId: string; name: string; points: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name) || a.memberId.localeCompare(b.memberId));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || row.points !== sorted[index - 1].points) rank = index + 1;
    return { ...row, rank };
  });
}
