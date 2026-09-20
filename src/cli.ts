/**
 * vibes — what behaviour does this change add, and what stopped holding?
 *
 *   vibes collect            run every suite, print the ledger
 *   vibes collect --write    ... and update the committed ledger
 *   vibes report --base REF  diff the ledger against REF and render
 *   vibes preview            render a claim as its reader will meet it
 *   vibes lint               the decidable half of CLAIMS.md
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from './collect.js';
import { diffLedgers, hasRegression } from './diff.js';
import { assignNumbers, parseLedger, serializeLedger, type Behaviour } from './ledger.js';
import { renderMarkdown } from './report.js';
import { countBySeverity, lintLedger, type LintOptions } from './lint.js';
import { formatFindings, lintInline, previewInline, previewLedger, type PreviewFilter } from './preview.js';

export const LEDGER = 'behaviours.jsonl';
/** Optional, repo-root: `{ "allow": ["flush"] }` — words this repo's operators
 *  genuinely use, which the default vocabulary would otherwise flag. */
export const LINT_CONFIG = 'vibes.lint.json';
/** High-water mark for behaviour numbers. Separate from the ledger because it
 *  must remember numbers whose behaviours have been deleted — that is the whole
 *  point of it. On a merge conflict, keep the larger number. */
export const COUNTER = 'behaviours.next';

const EXIT = { OK: 0, REGRESSION: 1, USAGE: 2, COLLECT: 3, LINT: 4 } as const;

/** Expectations listed under "New behaviour" in the PR comment. Enough to read
 *  a normal change whole; a bulk import says how much it held back. */
const COMMENT_MAX_NEW = 120;

function repoRoot(): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
}

/** Committed ledger at a ref. Absent is not an error: the first run has no
 *  baseline, and everything is legitimately new. */
function ledgerAt(root: string, ref: string): Behaviour[] {
  try {
    const text = execFileSync('git', ['show', `${ref}:${LEDGER}`], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 1 << 28,
      // Absent-at-base is handled below; git's "fatal: path ... not in" line
      // would otherwise leak into every first-adoption log.
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseLedger(text).ok;
  } catch {
    return [];
  }
}

/** The committed ledger as it stands on disk, for carrying numbers forward. */
function committedLedger(root: string): Behaviour[] {
  const p = join(root, LEDGER);
  return existsSync(p) ? parseLedger(readFileSync(p, 'utf8')).ok : [];
}

function highWater(root: string): number {
  const p = join(root, COUNTER);
  if (!existsSync(p)) return 0;
  const n = Number.parseInt(readFileSync(p, 'utf8').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith('--') ? '' : v;
}

/** Every occurrence — a test has several expectations, so `--then` repeats. */
function flags(argv: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== `--${name}`) continue;
    const v = argv[i + 1];
    if (v !== undefined && !v.startsWith('--')) out.push(v);
  }
  return out;
}

function lintOptions(root: string, argv: readonly string[]): LintOptions {
  const words: string[] = [];
  const p = join(root, LINT_CONFIG);
  if (existsSync(p)) {
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8')) as { allow?: unknown };
      if (Array.isArray(cfg.allow)) words.push(...cfg.allow.filter((w): w is string => typeof w === 'string'));
    } catch {
      // A malformed config must not stop a lint from running; it only ever
      // widens what is allowed, so the strict reading is the safe fallback.
    }
  }
  const inline = flag(argv, 'allow');
  if (inline !== undefined && inline !== '') words.push(...inline.split(',').map((w) => w.trim()));
  return { allow: words };
}

export async function main(argv: readonly string[]): Promise<number> {
  const cmd = argv[0] ?? 'report';
  const root = repoRoot();
  const log = (s: string): void => { process.stderr.write(`${s}\n`); };

  if (cmd === '--help' || cmd === 'help') {
    process.stdout.write(
      'vibes — what behaviour does this change add, and what stopped holding?\n\n' +
        '  vibes collect [--write]     run every suite; --write updates ' + LEDGER + '\n' +
        '  vibes report --base REF     diff against REF and render markdown\n' +
        '  vibes preview --given G --then T [--then T2] [--why W] [--covers C]\n' +
        '                              render a claim you are writing, and lint it\n' +
        '  vibes preview [--id X] [--suite S] [--file F]\n' +
        '                              render claims already in ' + LEDGER + '\n' +
        '  vibes lint [--id X] [--suite S] [--file F] [--allow w,w] [--warn-only]\n' +
        '                              check ' + LEDGER + ' against the decidable half of CLAIMS.md\n\n' +
        'preview and lint run NO suites — they read what is committed, or what you type.\n\n' +
        'Exit: 0 ok · 1 a behaviour broke or was removed · 2 usage · 3 a suite could not run\n' +
        '      4 a claim needs rewriting\n',
    );
    return EXIT.OK;
  }

  if (cmd === 'collect') {
    const r = collect(root, log);
    for (const p of r.problems) log(`vibes: ${p}`);
    if (r.behaviours.length === 0 && r.problems.length > 0) return EXIT.COLLECT;
    const assigned = assignNumbers(committedLedger(root), r.behaviours, highWater(root));
    const text = serializeLedger(assigned.numbered);
    if (argv.includes('--write')) {
      writeFileSync(join(root, LEDGER), text);
      writeFileSync(join(root, COUNTER), `${String(assigned.highWater)}\n`);
      log(`vibes: wrote ${LEDGER} — ${r.behaviours.length} behaviour(s), numbers up to BH-${String(assigned.highWater)}`);
    } else {
      process.stdout.write(text);
    }
    return EXIT.OK;
  }

  /* preview and lint are the writing loop, so neither may run a suite: a check
   * that costs a full test run is a check nobody runs while writing, which is
   * how the rules came to be enforced only on pull requests. */
  if (cmd === 'preview' || cmd === 'lint') {
    const opts = lintOptions(root, argv);
    const filter: PreviewFilter = {};
    for (const k of ['id', 'suite', 'file'] as const) {
      const v = flag(argv, k);
      if (v !== undefined && v !== '') Object.assign(filter, { [k]: v });
    }

    const given = flag(argv, 'given');
    const thens = flags(argv, 'then');
    if (cmd === 'preview' && given !== undefined && given !== '') {
      if (thens.length === 0) {
        process.stderr.write('vibes preview: --given needs at least one --then\n');
        return EXIT.USAGE;
      }
      const whys = flags(argv, 'why');
      const covers = flag(argv, 'covers');
      const claim = {
        given,
        expectations: thens.map((t, i) => {
          const w = whys[i];
          return w === undefined ? { then: t } : { then: t, why: w };
        }),
        ...(covers === undefined || covers === '' ? {} : { covers }),
      };
      process.stdout.write(`${previewInline(claim)}\n`);
      const findings = lintInline(claim, opts);
      if (findings.length > 0) process.stdout.write(`\n${formatFindings(findings)}\n`);
      // Read it aloud. The lint cannot hear a sentence with no main clause.
      return countBySeverity(findings).errors > 0 ? EXIT.LINT : EXIT.OK;
    }

    const ledger = committedLedger(root);
    if (ledger.length === 0) {
      process.stderr.write(`vibes ${cmd}: ${LEDGER} is empty or missing — run \`vibes collect --write\` first\n`);
      return EXIT.USAGE;
    }

    if (cmd === 'preview') {
      const text = previewLedger(ledger, filter);
      if (text === '') {
        process.stderr.write(`vibes preview: nothing in ${LEDGER} matches\n`);
        return EXIT.USAGE;
      }
      process.stdout.write(`${text}\n`);
      return EXIT.OK;
    }

    const scoped = ledger.filter((b) => {
      if (filter.id !== undefined && !b.id.includes(filter.id)) return false;
      if (filter.suite !== undefined && b.suite !== filter.suite) return false;
      if (filter.file !== undefined && !b.file.includes(filter.file)) return false;
      return true;
    });
    const findings = lintLedger(scoped, opts);
    if (findings.length > 0) process.stdout.write(`${formatFindings(findings)}\n\n`);
    const { errors, warnings } = countBySeverity(findings);
    process.stdout.write(
      `${String(scoped.length)} claim(s) linted — ${String(errors)} error(s), ${String(warnings)} warning(s)\n`,
    );
    if (argv.includes('--warn-only')) return EXIT.OK;
    return errors > 0 ? EXIT.LINT : EXIT.OK;
  }

  if (cmd !== 'report') {
    process.stderr.write(`vibes: unknown command "${cmd}"\n`);
    return EXIT.USAGE;
  }

  const base = flag(argv, 'base');
  if (base === undefined || base === '') {
    process.stderr.write('vibes report: --base REF is required\n');
    return EXIT.USAGE;
  }

  const r = collect(root, log);
  for (const p of r.problems) log(`vibes: ${p}`);
  if (r.behaviours.length === 0 && r.problems.length > 0) return EXIT.COLLECT;

  const numbered = assignNumbers(committedLedger(root), r.behaviours, highWater(root)).numbered;
  const d = diffLedgers(ledgerAt(root, base), numbered, r.silentSuites);

  // Two renderings of the same diff. A PR comment is capped by GitHub at 64 KiB
  // and a big change blows past that, so the comment lists a readable slice and
  // says what it left out; the job summary, which has room, carries all of it.
  process.stdout.write(renderMarkdown(d, { maxNew: COMMENT_MAX_NEW }));

  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, renderMarkdown(d));

  // The committed ledger drifting from reality makes every future diff wrong,
  // so say so — but do not fail on it, because a PR that adds behaviour will
  // legitimately differ until the author runs `collect --write`.
  const committed = join(root, LEDGER);
  if (existsSync(committed) && readFileSync(committed, 'utf8') !== serializeLedger(numbered)) {
    log(`vibes: ${LEDGER} is out of date — run \`vibes collect --write\` and commit it`);
  }

  // A suite that failed to report is a collection failure even when every
  // OTHER suite is green — silence must not be able to hide inside a pass.
  if (d.unreported.length > 0) return EXIT.COLLECT;
  return hasRegression(d) ? EXIT.REGRESSION : EXIT.OK;
}
