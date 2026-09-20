/**
 * The map is the spec's table of contents, so what matters is that nothing
 * falls through it silently: a heading that names no area, an area two
 * headings both claim, an area no heading claims — each has to surface.
 */

import { describe, expect, it } from 'vitest';
import { areaOf, capabilityFor, groupByCapability, parseCapabilities } from './capabilities.js';
import type { Behaviour } from './ledger.js';

const row = (id: string, suite = 'firmware'): Behaviour => ({
  v: 2, num: 1, id, expect: 'holds', suite, lang: 'c', file: 'test/x.c', test: 't',
  given: 'a scene', then: 'an outcome', status: 'pass',
});

const FILE = `# What the machine claims to do

Preamble the tool ignores.

## Test data logging \`firmware/monitor\`

Every sample taken during a test is written to the card as it happens.

## Motion profiles \`profile\` \`profiles\`

What the operator authors, and how it is kept.
`;

describe('reading the capabilities file', () => {
  it('reads a title, its area keys and its paragraph', () => {
    const map = parseCapabilities(FILE);
    expect(map.problems).toEqual([]);
    expect(map.capabilities.map((c) => c.title)).toEqual(['Test data logging', 'Motion profiles']);
    expect(map.capabilities[1]?.keys).toEqual(['profile', 'profiles']);
    expect(map.capabilities[0]?.statement).toBe('Every sample taken during a test is written to the card as it happens.');
  });

  it('refuses a heading that names no area, and one with no paragraph', () => {
    const map = parseCapabilities('## Just a title\n\ntext\n\n## Empty `x`\n');
    expect(map.problems.some((p) => p.includes('names no area'))).toBe(true);
    expect(map.problems.some((p) => p.includes('no paragraph'))).toBe(true);
  });

  it('refuses an area two headings both claim', () => {
    const map = parseCapabilities('## One `a`\n\nx\n\n## Two `a`\n\ny\n');
    expect(map.problems).toEqual(['`a` is claimed by both "One" and "Two"']);
  });
});

describe('finding a claim\'s capability', () => {
  const map = parseCapabilities(FILE);

  it('takes the area from the id, up to its first dot', () => {
    expect(areaOf(row('monitor.logging-writes-a-row'))).toBe('monitor');
    expect(areaOf(row('nodot'))).toBe('nodot');
  });

  it('prefers the suite-qualified key, and falls back to the bare area', () => {
    expect(capabilityFor(map, row('monitor.x', 'firmware'))?.title).toBe('Test data logging');
    expect(capabilityFor(map, row('monitor.x', 'control'))).toBeUndefined();
    expect(capabilityFor(map, row('profiles.x', 'control'))?.title).toBe('Motion profiles');
  });
});

describe('grouping under capabilities', () => {
  const map = parseCapabilities(FILE);

  it('keeps the file\'s order, and puts uncharted areas after it, each under its own heading', () => {
    const groups = groupByCapability(
      map,
      [row('zz.later', 'control'), row('profile.a', 'control'), row('monitor.a'), row('aa.first', 'control')],
      (b) => b,
    );
    expect(groups.map((g) => g.title)).toEqual([
      'Test data logging',
      'Motion profiles',
      'Uncharted — `control/aa`',
      'Uncharted — `control/zz`',
    ]);
    expect(groups[2]?.charted).toBe(false);
    expect(groups[2]?.statement).toContain('vibes.capabilities.md');
  });

  it('leaves out a capability nothing in the list belongs to', () => {
    expect(groupByCapability(map, [row('monitor.a')], (b) => b).map((g) => g.title)).toEqual(['Test data logging']);
  });
});
