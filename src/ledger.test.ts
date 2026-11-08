/**
 * Identity is `suite/id/expect`, and nothing else. A ledger written while rows
 * still carried a citation number has to read as the same behaviours, and
 * write back without it, so moving off numbers is one `collect --write`.
 */

import { describe, expect, it } from 'vitest';
import { carryForward, key, parseLedger, serializeLedger, type Behaviour } from './ledger.js';

function b(id: string, over: Partial<Behaviour> = {}): Behaviour {
  return {
    v: 2, id, expect: 'holds', suite: 'firmware', lang: 'c',
    file: 'test/x.c', test: id, given: 'g', then: 't', status: 'pass',
    ...over,
  };
}

describe('reading a ledger written with numbers', () => {
  it('reads each numbered row as the same behaviour, without its number', () => {
    const text = `${JSON.stringify({ ...b('fw'), num: 42 })}\n`;
    const { ok, bad } = parseLedger(text);
    expect(bad).toEqual([]);
    expect(ok.map(key)).toEqual(['firmware/fw/holds']);
    expect(ok[0]).not.toHaveProperty('num');
  });

  it('writes a numbered ledger back with every number gone and the rows in the same order', () => {
    const rows = [b('a', { suite: 'control' }), b('a'), b('b'), b('b', { expect: 'second' })];
    const numbered = rows.map((r, i) => JSON.stringify({ ...r, num: i + 1 })).join('\n') + '\n';
    const written = serializeLedger(parseLedger(numbered).ok);
    expect(written).not.toContain('"num"');
    expect(written).toBe(serializeLedger(rows));
  });

  it('still refuses a row with no expectation id', () => {
    const { ok, bad } = parseLedger(`${JSON.stringify({ ...b('fw'), expect: '', num: 1 })}\n`);
    expect(ok).toEqual([]);
    expect(bad).toHaveLength(1);
  });
});

describe('a suite that could not run here', () => {
  it('keeps its committed rows instead of deleting them', () => {
    const committed = [b('fw'), b('ui', { suite: 'control' })];
    const collected = [b('ui', { suite: 'control' })];
    const out = carryForward(committed, collected, ['firmware']);
    expect(out.map(key).sort()).toEqual(['control/ui/holds', 'firmware/fw/holds']);
  });

  it('drops nothing extra when every suite reported', () => {
    const committed = [b('fw')];
    expect(carryForward(committed, [b('fw')], [])).toHaveLength(1);
  });
});
