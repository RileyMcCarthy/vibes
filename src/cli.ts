/**
 * vibes — what behaviour does this change add, and what stopped holding?
 *
 *   vibes collect            run every suite, print the ledger
 *   vibes collect --write    ... and update the committed ledger
 *   vibes report --base REF  diff the ledger against REF and render
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect } from './collect.js';
import { diffLedgers, hasRegression, type LedgerDiff } from './diff.js';
import { loadPictures, renderImageProblems, renderPictures, resolveSha, writeGallery, type PictureView } from './images.js';
import { assignNumbers, parseLedger, serializeLedger, type Behaviour } from './ledger.js';
import { renderMarkdown } from './report.js';

export const LEDGER = 'behaviours.jsonl';
/** High-water mark for behaviour numbers. Separate from the ledger because it
 *  must remember numbers whose behaviours have been deleted — that is the whole
 *  point of it. On a merge conflict, keep the larger number. */
export const COUNTER = 'behaviours.next';

const EXIT = { OK: 0, REGRESSION: 1, USAGE: 2, COLLECT: 3 } as const;

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

export async function main(argv: readonly string[]): Promise<number> {
  const cmd = argv[0] ?? 'report';
  const root = repoRoot();
  const log = (s: string): void => { process.stderr.write(`${s}\n`); };

  if (cmd === '--help' || cmd === 'help') {
    process.stdout.write(
      'vibes — what behaviour does this change add, and what stopped holding?\n\n' +
        '  vibes collect [--write]     run every suite; --write updates ' + LEDGER + '\n' +
        '  vibes report --base REF     diff against REF and render markdown\n\n' +
        '    --github URL              raw-link committed pictures (https://github.com/owner/repo)\n' +
        '    --head SHA                commit the new pictures are shown from (default HEAD)\n' +
        '    --diff-dir DIR            write current/new/difference pages (default vibes-images)\n' +
        '    --diff-base-url URL       where published difference pictures can be fetched\n\n' +
        'Exit: 0 ok · 1 a behaviour broke or was removed · 2 usage · 3 a suite could not run\n',
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

  let baseSha: string | null = null;
  let headSha: string | null = null;
  try {
    baseSha = resolveSha(root, base);
    headSha = flag(argv, 'head') || resolveSha(root, 'HEAD');
  } catch (e) {
    log(`vibes: could not resolve the picture commits — ${(e as Error).message}`);
  }
  const images = loadPictures(root, base);
  for (const p of images.problems) log(`vibes: ${p}`);

  const github = flag(argv, 'github') || githubRepo();
  const diffBase = flag(argv, 'diff-base-url') || null;
  const view: PictureView = { github, baseSha, headSha, diffBaseUrl: diffBase };
  const pictureBody = renderPictures(images.pictures, view);
  const pictureProblems = renderImageProblems(images.problems);
  const pictureMd =
    pictureBody === '' && pictureProblems === ''
      ? ''
      : pictureBody === ''
        ? `## Pictures\n\n${pictureProblems}`
        : `${pictureBody}\n${pictureProblems}`;

  const diffDir = flag(argv, 'diff-dir');
  if (diffDir !== '') writeGallery(diffDir === undefined ? 'vibes-images' : diffDir, images.pictures);

  // Pictures lead when the ledger has nothing a reviewer must act on, so a
  // first look at the comment is the sheet that changed. A busy ledger stays
  // in front: a behaviour that stopped holding outranks a picture.
  const behaviourFull = renderMarkdown(d);
  const behaviourComment = renderMarkdown(d, { maxNew: COMMENT_MAX_NEW });
  const comment = joinReport(behaviourComment, pictureMd, behaviourQuiet(d));
  const full = joinReport(behaviourFull, pictureMd, behaviourQuiet(d));

  // Two renderings of the same diff. A PR comment is capped by GitHub at 64 KiB
  // and a big change blows past that, so the comment lists a readable slice and
  // says what it left out; the job summary, which has room, carries all of it.
  process.stdout.write(comment);

  const summary = process.env['GITHUB_STEP_SUMMARY'];
  if (summary !== undefined && summary !== '') appendFileSync(summary, full);

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
  if (hasRegression(d)) return EXIT.REGRESSION;
  if (images.problems.length > 0) return EXIT.COLLECT;
  return EXIT.OK;
}

/** Nothing in the ledger needs a decision, so a picture section can lead. */
function behaviourQuiet(d: LedgerDiff): boolean {
  return (
    d.added.length === 0 &&
    d.removed.length === 0 &&
    d.respecified.length === 0 &&
    d.broken.length === 0 &&
    d.unreported.length === 0 &&
    d.notHolding.length === 0
  );
}

function joinReport(behaviour: string, pictures: string, picturesFirst: boolean): string {
  if (pictures === '') return behaviour;
  const pictureBlock = pictures.endsWith('\n') ? pictures : `${pictures}\n`;
  return picturesFirst ? `${pictureBlock}\n${behaviour}` : `${behaviour}\n${pictureBlock}`;
}

/** https://github.com/owner/repo when Actions checked the repo out, else null. */
function githubRepo(): string | null {
  const server = process.env['GITHUB_SERVER_URL'];
  const repo = process.env['GITHUB_REPOSITORY'];
  if (server === undefined || server === '' || repo === undefined || repo === '') return null;
  return `${server.replace(/\/$/, '')}/${repo}`;
}
