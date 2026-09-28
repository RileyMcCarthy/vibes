/**
 * Put generated difference pictures somewhere a pull-request comment can load
 * them. They are not part of the change under review, so they live on a
 * branch the repo keeps for that purpose, one directory per review (`into`,
 * usually the head commit the comment linked).
 *
 * The files are whatever `<id>.diff.png` the gallery wrote. This module does
 * not know what the pictures are of.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { DIFF_SUFFIX } from './images.js';

export interface PublishOptions {
  readonly root: string;
  /** Directory the gallery wrote. Missing, or with no difference files, publishes nothing. */
  readonly dir: string;
  /** Branch that holds published differences. Created on the first publish. */
  readonly ref: string;
  /** Directory on that branch. A relative path, no `..`. */
  readonly into: string;
  readonly remote?: string;
  readonly message?: string;
}

export interface PublishResult {
  readonly pushed: boolean;
  readonly files: readonly string[];
}

export function diffFileNames(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(DIFF_SUFFIX)).sort();
}

function git(cwd: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function refExists(root: string, remote: string, ref: string): boolean {
  try {
    git(root, ['fetch', remote, ref]);
    return true;
  } catch {
    return false;
  }
}

/** A path we will create on the publish branch. Anything that could escape
 *  that branch is refused before git sees it. */
export function intoPath(into: string): string | null {
  if (into === '' || into.startsWith('/') || into.split('/').includes('..')) return null;
  return into;
}

/**
 * Copy the difference files onto `ref` at `into/` and push. A second publish
 * of the same bytes pushes nothing. Returns the file names that were considered.
 */
export function publishFiles(opts: PublishOptions): PublishResult {
  const into = intoPath(opts.into);
  if (into === null) throw new Error(`refusing to publish into ${JSON.stringify(opts.into)}`);
  const names = diffFileNames(opts.dir);
  if (names.length === 0) return { pushed: false, files: [] };

  const remote = opts.remote ?? 'origin';
  const tmp = mkdtempSync(join(tmpdir(), 'vibes-publish-'));
  rmSync(tmp, { recursive: true });
  const orphan = `vibes-publish-${process.pid}-${Date.now().toString(36)}`;
  let madeOrphan = false;
  try {
    if (refExists(opts.root, remote, opts.ref)) {
      git(opts.root, ['worktree', 'add', '--detach', tmp, 'FETCH_HEAD']);
    } else {
      git(opts.root, ['worktree', 'add', '--detach', tmp, 'HEAD']);
      git(tmp, ['checkout', '--orphan', orphan]);
      madeOrphan = true;
      try {
        git(tmp, ['rm', '-rf', '--quiet', '.']);
      } catch {
        // An empty tree has nothing to remove.
      }
      git(tmp, ['clean', '-fdx']);
    }

    mkdirSync(join(tmp, into), { recursive: true });
    for (const name of names) copyFileSync(join(opts.dir, name), join(tmp, into, basename(name)));
    git(tmp, ['add', '--', into]);
    try {
      git(tmp, ['diff', '--cached', '--quiet']);
      return { pushed: false, files: names };
    } catch {
      // A non-zero diff --quiet means there is something to commit.
    }
    const message = opts.message ?? `picture differences for ${into}`;
    git(tmp, [
      '-c',
      'user.email=41898282+github-actions[bot]@users.noreply.github.com',
      '-c',
      'user.name=github-actions[bot]',
      'commit',
      '-m',
      message,
    ]);
    git(tmp, ['push', remote, `HEAD:${opts.ref}`]);
    return { pushed: true, files: names };
  } finally {
    try {
      git(opts.root, ['worktree', 'remove', '--force', tmp]);
    } catch {
      rmSync(tmp, { recursive: true, force: true });
    }
    if (madeOrphan) {
      try {
        git(opts.root, ['branch', '-D', orphan]);
      } catch {
        // The branch is gone with the worktree on some git versions.
      }
    }
  }
}
