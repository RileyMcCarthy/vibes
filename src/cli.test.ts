/**
 * The exit code is what CI acts on, so it has to mean one thing: the ledger
 * could not be built. A behaviour that broke or was removed is the report's
 * headline instead — a broken test already fails its own suite, and a removal
 * is usually the change — so a red ledger job is never a correct PR.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from './cli.js';

async function run(dir: string, args: string[]): Promise<{ code: number; out: string }> {
  const previous = process.cwd();
  const summary = process.env['GITHUB_STEP_SUMMARY'];
  delete process.env['GITHUB_STEP_SUMMARY'];
  let out = '';
  const write = process.stdout.write;
  const writeErr = process.stderr.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  process.chdir(dir);
  try {
    const code = await main(args);
    return { code, out };
  } finally {
    process.chdir(previous);
    process.stdout.write = write;
    process.stderr.write = writeErr;
    if (summary === undefined) delete process.env['GITHUB_STEP_SUMMARY'];
    else process.env['GITHUB_STEP_SUMMARY'] = summary;
  }
}

function repo(): { dir: string; commit: (msg: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'vibes-cli-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'vibes@example.com');
  git('config', 'user.name', 'Vibes');
  return {
    dir,
    commit: (msg) => {
      git('add', '-A');
      git('commit', '-q', '--allow-empty', '-m', msg);
      return git('rev-parse', 'HEAD').trim();
    },
  };
}

/** A declaration as a binding writes it, before the collector joins status. */
function declared(test: string, then: string): Record<string, unknown> {
  return { v: 2, id: test, expect: 'holds', lang: 'c', file: 't.c', test, given: 'a scene', then };
}

/** A suite that declares `rows` and reports each test's verdict as Unity does. */
function suite(dir: string, rows: readonly Record<string, unknown>[], verdicts: Record<string, 'PASS' | 'FAIL'>): void {
  const declare = rows.map((r) => `printf '%s\\n' '${JSON.stringify(r)}' >> "$VIBES_BEHAVIOURS"`);
  const report = Object.entries(verdicts).map(([t, v]) => `echo "t.c:1:${t}:${v}"`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'vibes.suite.json'),
    JSON.stringify({ v: 1, name: 'unit', lang: 'c', cmd: [...declare, ...report, 'true'].join('; '), results: 'unity-stdout' }),
  );
}

/** The committed ledger as a repo that used citation numbers last wrote it. */
function numberedLedger(rows: readonly Record<string, unknown>[], suiteName = 'unit'): string {
  return rows.map((r, i) => JSON.stringify({ ...r, suite: suiteName, status: 'pass', num: i + 1 })).join('\n') + '\n';
}

describe('the report exit code', () => {
  it('passes when a behaviour is removed, and lists the removal', async () => {
    const { dir, commit } = repo();
    const a = declared('test_a', 'the first claim holds');
    const b = declared('test_b', 'the second claim holds');
    suite(dir, [a, b], { test_a: 'PASS', test_b: 'PASS' });
    writeFileSync(join(dir, 'behaviours.jsonl'), numberedLedger([a, b]));
    const base = commit('base');
    suite(dir, [a], { test_a: 'PASS' });
    commit('drop b');

    const { code, out } = await run(dir, ['report', '--base', base, '--diff-dir', '']);
    expect(code).toBe(0);
    expect(out).toContain('# 1 behaviour removed');
    expect(out).toContain('## No longer claimed');
    expect(out).toContain('the second claim holds');
    expect(out).not.toContain('BH-');
  });

  it('passes when a behaviour stopped holding, and leads with it', async () => {
    const { dir, commit } = repo();
    const a = declared('test_a', 'the first claim holds');
    const b = declared('test_b', 'the second claim holds');
    suite(dir, [a, b], { test_a: 'PASS', test_b: 'PASS' });
    writeFileSync(join(dir, 'behaviours.jsonl'), numberedLedger([a, b]));
    const base = commit('base');
    suite(dir, [a], { test_a: 'FAIL' });
    commit('break a, drop b');

    const { code, out } = await run(dir, ['report', '--base', base, '--diff-dir', '']);
    expect(code).toBe(0);
    expect(out).toContain('# 1 behaviour stopped holding.');
    expect(out.indexOf('## Stopped holding')).toBeLessThan(out.indexOf('## No longer claimed'));
  });

  it('fails when a suite declared nothing, because its behaviours have no verdict', async () => {
    const { dir, commit } = repo();
    const a = declared('test_a', 'the first claim holds');
    suite(join(dir, 'speaks'), [declared('test_s', 'a claim that still runs')], { test_s: 'PASS' });
    mkdirSync(join(dir, 'silent'), { recursive: true });
    writeFileSync(join(dir, 'silent', 'vibes.suite.json'), JSON.stringify({ v: 1, name: 'quiet', lang: 'c', cmd: 'true', results: 'unity-stdout' }));
    writeFileSync(join(dir, 'behaviours.jsonl'), numberedLedger([a], 'quiet'));
    const base = commit('base');

    const { code, out } = await run(dir, ['report', '--base', base, '--diff-dir', '']);
    expect(code).toBe(3);
    expect(out).toContain('without a verdict');
  });
});

describe('moving a numbered ledger off numbers', () => {
  it('is one collect --write, including the rows of a suite that could not run', async () => {
    const { dir, commit } = repo();
    const kept = declared('test_q', 'a claim from a suite that did not start');
    suite(join(dir, 'speaks'), [declared('test_s', 'a claim that still runs')], { test_s: 'PASS' });
    mkdirSync(join(dir, 'silent'), { recursive: true });
    writeFileSync(join(dir, 'silent', 'vibes.suite.json'), JSON.stringify({ v: 1, name: 'quiet', lang: 'c', cmd: 'true', results: 'unity-stdout' }));
    writeFileSync(join(dir, 'behaviours.jsonl'), numberedLedger([kept], 'quiet'));
    commit('numbered');

    const { code } = await run(dir, ['collect', '--write']);
    expect(code).toBe(0);
    const written = readFileSync(join(dir, 'behaviours.jsonl'), 'utf8');
    expect(written).not.toContain('"num"');
    expect(written).toContain('a claim from a suite that did not start');
    expect(written).toContain('a claim that still runs');
  });
});
