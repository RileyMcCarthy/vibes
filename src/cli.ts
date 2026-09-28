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
import { postComment } from './comment.js';
import { collect } from './collect.js';
import { diffLedgers, hasRegression, isQuiet } from './diff.js';
import { diffBase, loadPictures, renderPictureSection, resolveSha, writeGallery, type PictureView } from './images.js';
import { assignNumbers, parseLedger, serializeLedger, type Behaviour } from './ledger.js';
import { publishFiles } from './publish.js';
import { combineReports, renderMarkdown } from './report.js';

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
        '  vibes collect [--write]          run every suite; --write updates ' + LEDGER + '\n' +
        '  vibes report --base REF          diff against REF and render markdown\n' +
        '  vibes publish --dir D --ref B --into P\n' +
        '                                   push difference pictures to branch B at P/\n' +
        '  vibes post --file F --repo O/R --pr N\n' +
        '                                   create or update the sticky report comment\n\n' +
        '  report flags:\n' +
        '    --github URL                   raw-link committed pictures (https://github.com/owner/repo)\n' +
        '    --head SHA                     commit the new pictures are shown from (default HEAD)\n' +
        '    --diff-dir DIR                 write current/new/difference pages (default vibes-images)\n' +
        '    --publish-ref BRANCH           with --into, the branch difference pictures will be pushed to\n' +
        '    --into PATH                    directory on that branch (usually the head sha)\n' +
        '    --diff-base-url URL            fetch differences from here instead of the publish branch\n\n' +
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

  if (cmd === 'publish') return publishCmd(root, argv, log);
  if (cmd === 'post') return postCmd(argv, log);

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

  const view = pictureView(root, argv, base, log);
  const images = loadPictures(root, base);
  for (const p of images.problems) log(`vibes: ${p}`);
  const pictureMd = renderPictureSection(images.pictures, images.problems, view);

  const diffDir = flag(argv, 'diff-dir');
  if (diffDir !== '') writeGallery(diffDir === undefined ? 'vibes-images' : diffDir, images.pictures, view);

  // Pictures lead when the ledger has nothing a reviewer must act on, so a
  // first look at the comment is the picture that changed. A busy ledger stays
  // in front: a behaviour that stopped holding outranks a picture.
  const comment = combineReports(renderMarkdown(d, { maxNew: COMMENT_MAX_NEW }), pictureMd, isQuiet(d));
  const full = combineReports(renderMarkdown(d), pictureMd, isQuiet(d));

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

function pictureView(root: string, argv: readonly string[], base: string, log: (s: string) => void): PictureView {
  let baseSha: string | null = null;
  let headSha: string | null = null;
  try {
    baseSha = resolveSha(root, base);
  } catch (e) {
    log(`vibes: could not resolve ${base} — ${(e as Error).message}`);
  }
  try {
    headSha = flag(argv, 'head') || resolveSha(root, 'HEAD');
  } catch (e) {
    log(`vibes: could not resolve the new pictures' commit — ${(e as Error).message}`);
  }
  const github = flag(argv, 'github') || githubRepo();
  return {
    github,
    baseSha,
    headSha,
    diffBaseUrl: diffBase(github, flag(argv, 'publish-ref') ?? null, flag(argv, 'into') ?? null, flag(argv, 'diff-base-url') ?? null),
  };
}

function publishCmd(root: string, argv: readonly string[], log: (s: string) => void): number {
  const dir = flag(argv, 'dir');
  const ref = flag(argv, 'ref');
  const into = flag(argv, 'into');
  if (dir === undefined || dir === '' || ref === undefined || ref === '' || into === undefined || into === '') {
    process.stderr.write('vibes publish: --dir, --ref, and --into are required\n');
    return EXIT.USAGE;
  }
  const remote = flag(argv, 'remote');
  try {
    const result = publishFiles({
      root,
      dir,
      ref,
      into,
      ...(remote !== undefined && remote !== '' ? { remote } : {}),
    });
    log(
      result.files.length === 0
        ? 'vibes: no difference pictures to publish'
        : result.pushed
          ? `vibes: published ${String(result.files.length)} difference picture(s) to ${ref}`
          : 'vibes: difference pictures already published',
    );
    return EXIT.OK;
  } catch (e) {
    log(`vibes: could not publish difference pictures — ${(e as Error).message}`);
    return EXIT.COLLECT;
  }
}

function postCmd(argv: readonly string[], log: (s: string) => void): number {
  const file = flag(argv, 'file');
  const repo = flag(argv, 'repo') || process.env['GITHUB_REPOSITORY'] || '';
  const pr = flag(argv, 'pr') || '';
  if (file === undefined || file === '' || repo === '' || pr === '') {
    process.stderr.write('vibes post: --file, --repo, and --pr are required\n');
    return EXIT.USAGE;
  }
  if (!existsSync(file)) {
    process.stderr.write(`vibes post: ${file} does not exist\n`);
    return EXIT.USAGE;
  }
  const marker = flag(argv, 'marker');
  try {
    const result = postComment({
      repo,
      pr,
      markdown: readFileSync(file, 'utf8'),
      ...(marker !== undefined && marker !== '' ? { marker } : {}),
    });
    log(`vibes: ${result.action} comment ${result.id}`);
    return EXIT.OK;
  } catch (e) {
    log(`vibes: could not post the report — ${(e as Error).message}`);
    return EXIT.COLLECT;
  }
}

/** https://github.com/owner/repo when Actions checked the repo out, else null. */
function githubRepo(): string | null {
  const server = process.env['GITHUB_SERVER_URL'];
  const repo = process.env['GITHUB_REPOSITORY'];
  if (server === undefined || server === '' || repo === undefined || repo === '') return null;
  return `${server.replace(/\/$/, '')}/${repo}`;
}
