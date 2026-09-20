import { describe, expect, it } from 'vitest';
import { diffLedgers } from './diff.js';
import type { Behaviour } from './ledger.js';
import { renderMarkdown } from './report.js';
import { parseCapabilities } from './capabilities.js';

function row(over: {
  id: string;
  then: string;
  given?: string;
  why?: string;
  covers?: string;
  file?: string;
  test?: string;
  num?: number;
  expect?: string;
  status?: Behaviour['status'];
}): Behaviour {
  const b: Behaviour = {
    v: 2,
    num: over.num ?? 1,
    id: over.id,
    expect: over.expect ?? 'holds',
    suite: 'control',
    lang: 'ts',
    file: over.file ?? 'src/x.ts',
    test: over.test ?? 't',
    given: over.given ?? 'a situation',
    then: over.then,
    status: over.status ?? 'pass',
  };
  return {
    ...b,
    ...(over.why !== undefined ? { why: over.why } : {}),
    ...(over.covers !== undefined ? { covers: over.covers } : {}),
  };
}

describe('a respecification is a changed claim', () => {
  it('does not list a why-only rewrite as respecified', () => {
    const before = [
      row({
        id: 'gcode.comment-cannot-change-command',
        then: 'a rapid move to zero with a trailing comment naming a different move is still a rapid move to zero',
        why: 'the worst shape of the defect turned a rapid-to-zero into a full-speed move to a far target',
      }),
    ];
    const after = [
      row({
        id: 'gcode.comment-cannot-change-command',
        then: 'a rapid move to zero with a trailing comment naming a different move is still a rapid move to zero',
        why: 'a comment must never change where the gantry goes',
      }),
    ];
    const d = diffLedgers(before, after);
    expect(d.respecified).toHaveLength(0);
    expect(d.unchanged).toBe(1);
    expect(renderMarkdown(d)).not.toContain('gcode.comment-cannot-change-command');
    expect(renderMarkdown(d)).not.toContain('also changed');
  });

  it('does not list a covers-only or file-only move as respecified', () => {
    const before = [
      row({ id: 'a', then: 'the machine stays disabled', covers: 'old.c#fn', file: 'test/old.c' }),
    ];
    const after = [
      row({ id: 'a', then: 'the machine stays disabled', covers: 'new.c#fn', file: 'test/new.c' }),
    ];
    const d = diffLedgers(before, after);
    expect(d.respecified).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  it('lists a changed claim with the old and new sentences, and nests a rewritten reason under because', () => {
    const before = [
      row({
        id: 'gcode.relative-moves-are-not-offset',
        then: 'a relative move is not offset by the gauge length, because it is a distance rather than a destination',
        why: 'old reason',
      }),
    ];
    const after = [
      row({
        id: 'gcode.relative-moves-are-not-offset',
        then: 'a relative move is not offset by the gauge length, because it states a distance to travel',
        why: 'new reason',
      }),
    ];
    const md = renderMarkdown(diffLedgers(before, after));
    expect(md).toContain('1 behaviour respecified');
    // The row IS the claim as it now reads, in the shape every other row has,
    // so a reader judges it the same way. What it replaced sits under it.
    expect(md).toContain(
      '- **When** a situation\n' +
        '  - a relative move is not offset by the gauge length, because it states a distance to travel `BH-1`\n' +
        '    <sub>was: a relative move is not offset by the gauge length, because it is a distance rather than a destination</sub>\n' +
        '    <sub>new reason</sub>\n' +
        '    <sub>was, because: old reason</sub>',
    );
    expect(md).not.toMatch(/because was/);
    expect(md).not.toContain('also changed');
    expect(md).not.toContain('now:');
  });

  it('heads a group with its file and names the test in the row', () => {
    const md = renderMarkdown(
      diffLedgers(
        [],
        [row({ id: 'a', then: 'the machine stays disabled', file: 'test/foo.c', test: 'test_stays_disabled' })],
      ),
    );
    // The path is the heading over the group, so the row does not repeat it.
    expect(md).toContain('**test/foo.c**');
    expect(md).toContain('`test_stays_disabled`');
    expect(md).not.toContain('`test/foo.c#');
  });

  it('lists a changed scene the same way', () => {
    const d = diffLedgers(
      [row({ id: 'a', then: 'the machine stays disabled', given: 'old scene' })],
      [row({ id: 'a', then: 'the machine stays disabled', given: 'new scene' })],
    );
    expect(d.respecified).toHaveLength(1);
    expect(d.respecified[0]?.fields).toEqual(['given']);
    const md = renderMarkdown(d);
    expect(md).toContain('- **When** new scene\n  <sub>was: old scene</sub>\n  - the machine stays disabled `BH-1`');
  });

  it('prints one scene for two expectations reworded under it', () => {
    const before = [
      row({ id: 'a', expect: 'x', then: 'old x', given: 'old scene' }),
      row({ id: 'a', expect: 'y', then: 'old y', given: 'old scene', num: 2 }),
    ];
    const after = [
      row({ id: 'a', expect: 'x', then: 'new x', given: 'new scene' }),
      row({ id: 'a', expect: 'y', then: 'new y', given: 'new scene', num: 2 }),
    ];
    const md = renderMarkdown(diffLedgers(before, after));
    const section = md.slice(md.indexOf('## Respecified'));
    expect(section.match(/\*\*When\*\*/g)).toHaveLength(1);
    expect(section.match(/<sub>was: old scene<\/sub>/g)).toHaveLength(1);
    expect(section).toContain('  - new x `BH-1`\n    <sub>was: old x</sub>');
    expect(section).toContain('  - new y `BH-2`\n    <sub>was: old y</sub>');
  });

  it('does not print the claim twice when the test is named after it', () => {
    // The TypeScript binding names a test `${then} [${id}]`.
    const then = 'a pause keeps its duration in milliseconds';
    const md = renderMarkdown(
      // The TypeScript binding builds this name, so it carries the claim.
      diffLedgers([], [row({ id: 'x.pause', then, file: 'src/a.test.ts', test: `${then} [x.pause]` })], []),
    );
    // The file is the heading over the group; the row carries only the
    // runner's name for the test, and not when that name is the claim again.
    expect(md).toContain('**src/a.test.ts**');
    expect(md).not.toContain(`src/a.test.ts#${then}`);
    expect(md).not.toContain(`\`${then} [x.pause]\``);
  });

  it('keeps the test name when it is a symbol rather than the claim', () => {
    const md = renderMarkdown(
      diffLedgers([], [row({ id: 'y.z', then: 'a core that stops is a fault', file: 'test/t.c', test: 'test_core_stops' })], []),
    );
    expect(md).toContain('**test/t.c**');
    expect(md).toContain('`test_core_stops`');
  });

  it('shows no handle for a behaviour removed against a pre-numbering ledger', () => {
    // main's ledger predates numbering, so its rows carry no num at all.
    const legacy = { ...row({ id: 'old.claim', then: 'a claim from before numbering' }), num: undefined as unknown as number };
    const md = renderMarkdown(diffLedgers([legacy], [], []));
    expect(md).toContain('a claim from before numbering');
    expect(md).not.toContain('BH-undefined');
    expect(md).not.toContain('BH-NaN');
  });

  it('cites a numbered behaviour on its row', () => {
    const md = renderMarkdown(diffLedgers([], [row({ id: 'x.y', then: 'a claim', num: 42 })], []));
    expect(md).toContain('BH-42');
  });
});

describe('a report with a capability map', () => {
  const caps = parseCapabilities(
    '## Test data logging `monitor`\n\nEvery sample is written to the card as it happens.\n\n## Motion `motion`\n\nHow the gantry moves.\n',
  );

  it('leads with a table of which capabilities changed, and how', () => {
    const md = renderMarkdown(
      diffLedgers(
        [row({ id: 'monitor.old', then: 'old claim' })],
        [row({ id: 'monitor.old', then: 'new claim' }), row({ id: 'motion.new', then: 'a move', num: 2 })],
      ),
      { capabilities: caps },
    );
    expect(md).toContain('| capability | respecified | new |');
    expect(md).toContain('| Test data logging | 1 |  |');
    expect(md).toContain('| Motion |  | 1 |');
  });

  it('heads each section with the capability and prints its paragraph once', () => {
    const md = renderMarkdown(
      diffLedgers(
        [row({ id: 'monitor.a', then: 'old', num: 1 }), row({ id: 'monitor.b', then: 'gone', num: 2 })],
        [row({ id: 'monitor.a', then: 'new', num: 1 }), row({ id: 'monitor.c', then: 'added', num: 3 })],
      ),
      { capabilities: caps },
    );
    // removed → respecified → new, all under the one capability
    expect(md.match(/### Test data logging/g)).toHaveLength(2);
    expect(md).toContain('<details><summary><b>Test data logging</b> — 1 expectation across 1 test</summary>');
    expect(md.match(/Every sample is written to the card as it happens\./g)).toHaveLength(1);
    // The paragraph came with the first appearance, which is the removal.
    expect(md.indexOf('Every sample')).toBeLessThan(md.indexOf('## Respecified'));
    expect(md).not.toContain('**src/x.ts**');
  });

  it('shows an area no capability declares as uncharted rather than hiding it', () => {
    const md = renderMarkdown(diffLedgers([], [row({ id: 'sd.write', then: 'the records land in the file' })]), {
      capabilities: caps,
    });
    expect(md).toContain('<b>Uncharted — `control/sd`</b>');
    expect(md).toContain('No capability declares `control/sd`');
  });

  it('renders exactly as before when the repo has no map', () => {
    const md = renderMarkdown(diffLedgers([], [row({ id: 'sd.write', then: 'the records land in the file' })]));
    expect(md).toContain('<details><summary><b>control</b>');
    expect(md).not.toContain('capability');
  });
});
