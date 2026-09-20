/**
 * Preview has one job: show the writer the composed line. So what is tested is
 * that it composes exactly what the report composes — a preview that renders a
 * different sentence than the pull request will is worse than none.
 */

import { describe, expect, it } from 'vitest';
import { previewInline, previewLedger, lintInline, formatFindings } from './preview.js';
import { renderMarkdown } from './report.js';
import { diffLedgers } from './diff.js';
import type { Behaviour } from './ledger.js';

const row = (over: Partial<Behaviour> = {}): Behaviour => ({
  v: 2, num: 42, id: 'ads122.start-drains-stale-bytes', expect: 'start-succeeds',
  suite: 'firmware', lang: 'c', file: 'test/test_ads.c', test: 'test_start',
  given: 'a start of the load-cell ADC with a leftover byte on the link',
  then: 'the start completes and the converter is converting',
  status: 'pass', ...over,
});

describe('previewing a claim being written', () => {
  it('renders the frame the reader will meet', () => {
    const text = previewInline({
      given: 'a start of the load-cell ADC with a leftover byte on the link',
      expectations: [{ then: 'the start completes and the converter is converting' }],
    });
    expect(text).toBe(
      '- **When** a start of the load-cell ADC with a leftover byte on the link\n' +
        '  - the start completes and the converter is converting',
    );
  });

  it('shows a reason under the expectation it belongs to', () => {
    const text = previewInline({
      given: 'a leftover byte on the link',
      expectations: [
        { then: 'the configuration is verified', why: 'one request, one reply' },
        { then: 'the start completes' },
      ],
    });
    expect(text).toContain('  - the configuration is verified\n    <sub>one request, one reply</sub>');
    expect(text).toContain('  - the start completes');
  });

  it('carries no empty citation, file or test name for a claim that has none', () => {
    // A claim not yet collected has no number and no file; rendering those as
    // empty backticks would look like a defect in the tool.
    expect(previewInline({ given: 'a scene', expectations: [{ then: 'an outcome' }] })).not.toContain('``');
  });

  it('composes what the report composes', () => {
    const b = row();
    const reported = renderMarkdown(diffLedgers([], [b], []));
    const previewed = previewInline({ given: b.given, expectations: [{ then: b.then }] });
    // Same two lines, modulo the citation the ledger has and a draft does not.
    for (const line of previewed.split('\n')) {
      expect(reported).toContain(line.replace(/\s+$/, ''));
    }
  });

  it('lints the scene once, not once per expectation', () => {
    const findings = lintInline({
      given: 'a byte left on the link by an abandoned exchange, then a start',
      expectations: [{ then: 'the start completes' }, { then: 'the converter is converting' }],
    });
    expect(findings.filter((f) => f.rule === 'garden-path')).toHaveLength(1);
  });
});

describe('previewing what is already committed', () => {
  it('groups a test\'s expectations under one scene', () => {
    const text = previewLedger([row(), row({ expect: 'config-verified', then: 'the configuration is verified' })]);
    expect(text.match(/\*\*When\*\*/g)).toHaveLength(1);
    expect(text).toContain('`BH-42`');
  });

  it('narrows by id, suite and file', () => {
    const items = [row(), row({ num: 43, id: 'gcode.dwell', suite: 'control', file: 'src/domain/gcode.test.ts' })];
    expect(previewLedger(items, { id: 'ads122' })).toContain('load-cell');
    expect(previewLedger(items, { suite: 'control' })).not.toContain('`BH-42`');
    expect(previewLedger(items, { file: 'src/domain' }).match(/\*\*When\*\*/g)).toHaveLength(1);
  });
});

describe('reporting findings to whoever wrote the claim', () => {
  it('puts errors before warnings', () => {
    const text = formatFindings([
      { rule: 'internals', severity: 'warn', field: 'then', message: 'w' },
      { rule: 'frame', severity: 'error', field: 'given', message: 'e' },
    ]);
    expect(text.indexOf('error')).toBeLessThan(text.indexOf('warn'));
  });
});
