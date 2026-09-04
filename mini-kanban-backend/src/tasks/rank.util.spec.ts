import { between, first, last, rebalance } from './rank.util';

describe('rank.util', () => {
  describe('first() / last()', () => {
    it('first() is the empty string — sorts before everything', () => {
      expect(first()).toBe('');
      expect(first() < 'a').toBe(true);
    });

    it('last() is a single fixed sentinel character', () => {
      expect(last()).toBe('z');
    });
  });

  describe('between() — midpoint', () => {
    it('computes a value strictly between two ordinary ranks', () => {
      const mid = between('a', 'z');
      expect(mid > 'a').toBe(true);
      expect(mid < 'z').toBe(true);
    });

    it('is deterministic for the same inputs', () => {
      expect(between('a', 'z')).toBe(between('a', 'z'));
    });

    it('rejects a >= b', () => {
      expect(() => between('b', 'a')).toThrow();
      expect(() => between('a', 'a')).toThrow();
    });
  });

  describe('between() — insert at start', () => {
    it('midpoint of first() and the current first rank sorts before it', () => {
      const currentFirst = 'm';
      const newFirst = between(first(), currentFirst);
      expect(newFirst < currentFirst).toBe(true);
      expect(newFirst > first()).toBe(true);
    });

    it('repeated inserts at the start keep producing smaller ranks, in order', () => {
      let rank = 'm';
      const produced: string[] = [rank];
      for (let i = 0; i < 20; i++) {
        rank = between(first(), rank);
        produced.push(rank);
      }
      const sorted = [...produced].sort();
      expect(produced.slice().reverse()).toEqual(sorted);
    });
  });

  describe('between() — insert at end', () => {
    it('midpoint of the current last rank and last() sorts after it', () => {
      const currentLast = 'm';
      const newLast = between(currentLast, last());
      expect(newLast > currentLast).toBe(true);
      expect(newLast < last()).toBe(true);
    });

    it('repeated inserts at the end keep producing larger ranks, in order, never reaching last()', () => {
      let rank = 'm';
      const produced: string[] = [rank];
      for (let i = 0; i < 20; i++) {
        rank = between(rank, last());
        expect(rank < last()).toBe(true);
        produced.push(rank);
      }
      const sorted = [...produced].sort();
      expect(produced).toEqual(sorted);
    });
  });

  describe('between() — adjacent strings', () => {
    it('handles single-character adjacent ranks by growing the result', () => {
      // 'y' and 'z' are consecutive in the base-36 alphabet — no integer
      // digit sits between them, so the algorithm must extend.
      const mid = between('y', 'z');
      expect(mid.length).toBeGreaterThan(1);
      expect(mid > 'y').toBe(true);
      expect(mid < 'z').toBe(true);
    });

    it('handles adjacent ranks sharing a multi-character prefix', () => {
      const mid = between('ay', 'az');
      expect(mid > 'ay').toBe(true);
      expect(mid < 'az').toBe(true);
      expect(mid.startsWith('ay')).toBe(true);
    });

    it('can keep bisecting an adjacent pair indefinitely without colliding', () => {
      const lo = 'y';
      let hi = 'z';
      for (let i = 0; i < 10; i++) {
        const mid = between(lo, hi);
        expect(mid > lo).toBe(true);
        expect(mid < hi).toBe(true);
        hi = mid; // keep narrowing from the same side to force repeated adjacency
      }
    });
  });

  describe('rebalance()', () => {
    it('returns an empty array for an empty input', () => {
      expect(rebalance([])).toEqual([]);
    });

    it('returns one rank, strictly within the keyspace, for a single item', () => {
      const [rank] = rebalance(['ignored-value']);
      expect(rank > first()).toBe(true);
      expect(rank < last()).toBe(true);
    });

    it('preserves relative order for many items, regardless of the input values', () => {
      // The input strings are deliberately garbage/overlong — rebalance()
      // must ignore their actual values and only use position + count.
      const junkInput = Array.from(
        { length: 50 },
        () => 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
      );
      const result = rebalance(junkInput);

      expect(result).toHaveLength(50);
      const sorted = [...result].sort();
      expect(result).toEqual(sorted); // already in ascending order
      // No duplicates.
      expect(new Set(result).size).toBe(50);
    });

    it('keeps every generated rank strictly inside (first(), last())', () => {
      const result = rebalance(new Array(200).fill(''));
      for (const rank of result) {
        expect(rank > first()).toBe(true);
        expect(rank < last()).toBe(true);
      }
    });

    it('produces ranks usable immediately afterward for further inserts', () => {
      const [a, b, c] = rebalance(['x', 'y', 'z']);
      const between_a_b = between(a, b);
      const between_b_c = between(b, c);
      expect(a < between_a_b).toBe(true);
      expect(between_a_b < b).toBe(true);
      expect(b < between_b_c).toBe(true);
      expect(between_b_c < c).toBe(true);
    });
  });
});
