/**
 * Two open branches both take the next free numbers. Whichever merges second
 * has to settle its own: these are the properties that make that safe — a
 * number on the base never moves, a branch's numbers never land on one the base
 * has used, and settling twice changes nothing.
 */

import { describe, expect, it } from 'vitest';
import {
  carryForward,
  duplicateNumbers,
  isConflictMarker,
  key,
  parseCounter,
  renumber,
  type Behaviour,
} from './ledger.js';

function b(id: string, num: number, over: Partial<Behaviour> = {}): Behaviour {
  return {
    v: 2, num, id, expect: 'holds', suite: 'firmware', lang: 'c',
    file: 'test/x.c', test: id, given: 'g', then: 't', status: 'pass',
    ...over,
  };
}

const nums = (bs: readonly Behaviour[]) => Object.fromEntries(bs.map((x) => [key(x), x.num]));

describe('settling a branch against its base', () => {
  it('moves a branch that took the same numbers as one merged before it past the base', () => {
    // Both branches started at 10. The other one merged first with 11 and 12.
    const base = [b('old', 10), b('theirs-a', 11), b('theirs-b', 12)];
    const head = [...base, b('mine-a', 11), b('mine-b', 12)];
    const r = renumber(base, 12, head, 12);
    expect(nums(r.numbered)).toEqual({
      'firmware/old/holds': 10,
      'firmware/theirs-a/holds': 11,
      'firmware/theirs-b/holds': 12,
      'firmware/mine-a/holds': 13,
      'firmware/mine-b/holds': 14,
    });
    expect(r.highWater).toBe(14);
    expect(r.moved).toEqual([
      { key: 'firmware/mine-a/holds', from: 11, to: 13 },
      { key: 'firmware/mine-b/holds', from: 12, to: 14 },
    ]);
  });

  it('moves only the rows that collide, so a citation of the others stays true', () => {
    const base = [b('theirs', 11)];
    const head = [...base, b('mine-z', 11), b('mine-a', 12)];
    const r = renumber(base, 11, head, 12);
    expect(nums(r.numbered)).toMatchObject({ 'firmware/mine-z/holds': 13, 'firmware/mine-a/holds': 12 });
    expect(r.moved).toEqual([{ key: 'firmware/mine-z/holds', from: 11, to: 13 }]);
  });

  it('moves the colliding rows in the order they were numbered', () => {
    const base = [b('theirs-a', 11), b('theirs-b', 12)];
    const head = [...base, b('zulu', 11), b('alpha', 12)];
    const r = renumber(base, 12, head, 12);
    expect(nums(r.numbered)).toMatchObject({ 'firmware/zulu/holds': 13, 'firmware/alpha/holds': 14 });
  });

  it('settles two new rows that hold the same number', () => {
    const r = renumber([], 0, [b('one', 3), b('two', 3)], 3);
    expect(nums(r.numbered)).toEqual({ 'firmware/one/holds': 3, 'firmware/two/holds': 4 });
  });

  it('never lands on the number of a behaviour the base has deleted', () => {
    // The base used 11 and deleted it; its counter remembers.
    const r = renumber([b('old', 10)], 11, [b('old', 10), b('mine', 11)], 11);
    expect(nums(r.numbered)['firmware/mine/holds']).toBe(12);
  });

  it('leaves a branch alone when its numbers are already past the base', () => {
    const base = [b('old', 10)];
    const head = [b('old', 10), b('mine', 11)];
    const r = renumber(base, 10, head, 11);
    expect(r.moved).toEqual([]);
    expect(r.numbered).toEqual(head);
    expect(r.highWater).toBe(11);
  });

  it('changes nothing the second time', () => {
    const base = [b('theirs', 11)];
    const first = renumber(base, 11, [...base, b('mine', 11)], 11);
    const second = renumber(base, 11, first.numbered, first.highWater);
    expect(second.moved).toEqual([]);
    expect(second.highWater).toBe(first.highWater);
  });

  it('gives a behaviour the base has its base number back', () => {
    const r = renumber([b('old', 10)], 10, [b('old', 99)], 99);
    expect(nums(r.numbered)['firmware/old/holds']).toBe(10);
  });

  it('settles a number the base itself holds twice by moving all but one holder', () => {
    const base = [b('alpha', 7), b('beta', 7), b('gamma', 8)];
    const r = renumber(base, 8, base, 8);
    expect(nums(r.numbered)).toEqual({ 'firmware/alpha/holds': 7, 'firmware/beta/holds': 9, 'firmware/gamma/holds': 8 });
    expect(duplicateNumbers(r.numbered).size).toBe(0);
  });

  it('settles that duplicate by history when given a base from before it', () => {
    // beta held 7 first; alpha arrived later on a stale branch.
    const before = [b('beta', 7)];
    const now = [b('alpha', 7), b('beta', 7), b('gamma', 8)];
    const r = renumber(before, 7, now, 8);
    expect(nums(r.numbered)).toEqual({ 'firmware/alpha/holds': 9, 'firmware/beta/holds': 7, 'firmware/gamma/holds': 8 });
  });

  it('keeps two suites that share a test id apart', () => {
    const base = [b('same', 5)];
    const head = [b('same', 5), b('same', 5, { suite: 'control' })];
    const r = renumber(base, 5, head, 5);
    expect(nums(r.numbered)).toEqual({ 'firmware/same/holds': 5, 'control/same/holds': 6 });
  });
});

describe('finding a number held twice', () => {
  it('names every holder', () => {
    const dups = duplicateNumbers([b('a', 1), b('b', 1), b('c', 2)]);
    expect([...dups]).toEqual([[1, ['firmware/a/holds', 'firmware/b/holds']]]);
  });

  it('is empty for a well-numbered ledger', () => {
    expect(duplicateNumbers([b('a', 1), b('b', 2)]).size).toBe(0);
  });
});

describe('the counter mid-merge', () => {
  it('reads a plain counter', () => {
    expect(parseCounter('1288\n')).toBe(1288);
  });

  it('reads the larger side of a conflicted counter instead of zero', () => {
    expect(parseCounter('<<<<<<< HEAD\n1264\n=======\n1261\n>>>>>>> origin/main\n')).toBe(1264);
  });

  it('reads an absent or garbled counter as zero', () => {
    expect(parseCounter('')).toBe(0);
    expect(parseCounter('nope')).toBe(0);
  });

  it('recognises git conflict markers and nothing else', () => {
    expect(isConflictMarker('<<<<<<< HEAD')).toBe(true);
    expect(isConflictMarker('=======')).toBe(true);
    expect(isConflictMarker('>>>>>>> origin/main')).toBe(true);
    expect(isConflictMarker('{"v":2,"num":1}')).toBe(false);
  });
});

describe('a suite that could not run here', () => {
  it('keeps its committed rows instead of deleting them', () => {
    const committed = [b('fw', 1), b('ui', 2, { suite: 'control' })];
    const collected = [b('ui', 0, { suite: 'control' })];
    const out = carryForward(committed, collected, ['firmware']);
    expect(out.map(key).sort()).toEqual(['control/ui/holds', 'firmware/fw/holds']);
  });

  it('drops nothing extra when every suite reported', () => {
    const committed = [b('fw', 1)];
    expect(carryForward(committed, [b('fw', 0)], [])).toHaveLength(1);
  });
});
