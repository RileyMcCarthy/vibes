/**
 * The lint exists to catch what a human reading two strings does not, so what
 * matters about each rule is both halves: the claim it must catch, and the
 * ordinary English it must leave alone. Every false-positive case here is one
 * the first draft of that rule actually flagged in a live ledger.
 */

import { describe, expect, it } from 'vitest';
import { lintClaim, lintLedger, longestSharedRun, type Finding } from './lint.js';
import type { Behaviour } from './ledger.js';

const rules = (fs: readonly Finding[]): string[] => fs.map((f) => f.rule);

const claim = (given: string, then: string, over: Partial<Parameters<typeof lintClaim>[0]> = {}) =>
  lintClaim({ given, then, ...over });

describe('the frame the report supplies', () => {
  it('rejects a given that brings its own "when"', () => {
    expect(rules(claim('when the door opens', 'motion stops'))).toContain('frame');
  });

  it('rejects a then that starts with "then"', () => {
    expect(rules(claim('the door opens', 'then motion stops'))).toContain('frame');
  });

  it('leaves a scene and an outcome alone', () => {
    expect(claim('an open door while a test is running', 'motion stops')).toEqual([]);
  });
});

describe('names from the code', () => {
  it('catches snake_case and MACRO_CASE', () => {
    expect(rules(claim('a stopped core', 'app_control reports a fault'))).toContain('identifier');
    expect(rules(claim('a stopped core', 'the badge reads FORCE_GAUGE_COMMUNICATION'))).toContain('identifier');
  });

  it('catches a call', () => {
    expect(rules(claim('a stopped core', 'motionEnabled() returns false'))).toContain('identifier');
  });

  it('leaves camel-humped English alone', () => {
    // The first draft flagged "GitHub" and "KiB" as identifiers.
    expect(claim('a report larger than 64 KiB', 'GitHub receives the attachment')).toEqual([]);
  });

  it('allows a name the repo says is real vocabulary', () => {
    const opts = { allow: ['public_repo'] };
    expect(lintClaim({ given: 'a token with public_repo scope', then: 'the login is reported' }, opts)).toEqual([]);
  });
});

describe('a spec says what the machine does', () => {
  it('catches a contrast and a defect story', () => {
    expect(rules(claim('lost power', 'the power fault is raised, not a tripped switch'))).toContain('contrast');
    expect(rules(claim('a dwell', 'one pause is produced', { why: 'fixes a defect where the pause doubled' })))
      .toContain('contrast');
  });

  it('does not read "is used to" as "used to"', () => {
    // Passive voice, not a past habit: "the hook IS USED TO clear the log".
    expect(claim('a debug hook that is used to clear the log', 'the dump shows the event')).toEqual([]);
  });

  it('leaves a product that files bug reports alone', () => {
    expect(claim('an issue report', 'the form targets the app-bug template')).toEqual([]);
    expect(rules(claim('two reads of one frame', 'each keeps its byte count', { why: 'that difference is usually the bug' })))
      .toContain('contrast');
  });
});

describe('machinery the reader never sees', () => {
  it('warns on a claim about an internal step', () => {
    const f = claim('a start with a leftover byte on the link', 'the leftover is flushed before the read-back');
    expect(rules(f)).toContain('internals');
    expect(f[0]?.severity).toBe('warn');
  });

  it('honours an allowance scoped to the file where the word is real', () => {
    const opts = { allow: [{ words: ['stub'], in: 'src/firmware/' }] };
    const where = (file: string) =>
      rules(lintClaim({ given: 'a flash load', then: 'the image carries the 496-byte flash-boot stub', file }, opts));
    expect(where('src/firmware/p2loader.test.ts')).toEqual([]);
    expect(where('src/domain/gcode.test.ts')).toContain('internals');
  });
});

describe('claims that could caption any test', () => {
  it('catches the adverbs', () => {
    expect(rules(claim('a move', 'the gantry moves correctly'))).toContain('vague');
  });
});

describe('a scene that reads as a sentence', () => {
  it('warns on a participle that is also a past tense', () => {
    expect(rules(claim('a byte left on the link by an abandoned exchange, then a start', 'the start completes')))
      .toContain('garden-path');
  });

  it('leaves noun compounds alone', () => {
    // "a test run", "a direct read", "a saved set" — seventeen of these were
    // flagged before the rule required a preposition after the participle.
    expect(claim('a test run that finished', 'the summary is written')).toEqual([]);
    expect(claim('a direct read of the same channel', 'the reply is delivered')).toEqual([]);
  });
});

describe('a then that hands back the scene', () => {
  it('measures the longest shared run', () => {
    expect(longestSharedRun('a start is waiting to begin', 'refused while a start is waiting to begin')).toBe(6);
    expect(longestSharedRun('one of the cores stops reporting', 'the machine reports a core fault')).toBeLessThan(6);
  });

  it('warns only when the run is long enough to be the scene', () => {
    const restated = claim(
      'a start and a jog attempted while a start is waiting to begin',
      'both are refused while a start is waiting to begin',
    );
    expect(rules(restated)).toContain('restates');
    expect(rules(claim('a 1 mm extension on a 10 mm gauge', 'strain is 10 percent'))).not.toContain('restates');
  });
});

describe('an expectation id is identity', () => {
  it('rejects an ordinal', () => {
    expect(rules(claim('a fault', 'motion stops', { expect: 'second' }))).toContain('ordinal-id');
    expect(rules(claim('a fault', 'motion stops', { expect: 'motion-off' }))).not.toContain('ordinal-id');
  });
});

describe('linting a ledger', () => {
  const row = (over: Partial<Behaviour>): Behaviour => ({
    v: 2, num: 1, id: 'ads122.start', expect: 'holds', suite: 'firmware', lang: 'c',
    file: 'test/x.c', test: 'test_x', given: 'when a start', then: 'the start completes',
    status: 'pass', ...over,
  });

  it('reports a scene once, however many expectations hang off it', () => {
    const findings = lintLedger([
      row({ expect: 'one-thing' }),
      row({ expect: 'another-thing', then: 'the converter is running' }),
    ]);
    expect(findings.filter((f) => f.field === 'given')).toHaveLength(1);
  });

  it('carries the identity a reader can grep for', () => {
    const [first] = lintLedger([row({})]);
    expect(first?.key).toBe('firmware/ads122.start/holds');
    expect(first?.num).toBe(1);
  });
});
