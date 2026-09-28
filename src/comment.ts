/**
 * One sticky pull-request comment for a Vibes report.
 *
 * The comment is found by a marker on its first line and edited in place, so
 * the page shows the latest report and does not fill with history. The body
 * is cut to what GitHub will store; the job summary keeps the rest.
 */

import { execFileSync } from 'node:child_process';

export const MARKER = '<!-- vibes-ledger -->';

/** GitHub caps an issue comment at 65,536 characters. Leave room for the
 *  marker and the note that says the rest is in the job summary. */
export const COMMENT_LIMIT = 60_000;

const TRUNCATED = '\n\n_Truncated — the full report is in the job summary._\n';

export function commentBody(markdown: string, limit = COMMENT_LIMIT, marker = MARKER): string {
  const bytes = Buffer.from(markdown);
  let body = markdown;
  if (bytes.length > limit) body = `${cutBytes(markdown, limit)}${TRUNCATED}`;
  if (!body.endsWith('\n')) body += '\n';
  return `${marker}\n${body}`;
}

/** Cut on a character boundary so the comment stays valid text. */
function cutBytes(text: string, limit: number): string {
  const buf = Buffer.from(text);
  let end = limit;
  while (end > 0 && ((buf[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString('utf8');
}

export type Gh = (args: readonly string[]) => string;

export interface PostOptions {
  readonly repo: string;
  readonly pr: string;
  readonly markdown: string;
  readonly marker?: string;
  readonly gh?: Gh;
}

export interface PostResult {
  readonly action: 'created' | 'updated';
  readonly id: string;
}

function ghApi(args: readonly string[]): string {
  return execFileSync('gh', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Create the comment, or replace the one that already starts with the marker. */
export function postComment(opts: PostOptions): PostResult {
  const marker = opts.marker ?? MARKER;
  const gh = opts.gh ?? ghApi;
  const body = commentBody(opts.markdown, COMMENT_LIMIT, marker);
  const listed = gh([
    'api',
    `repos/${opts.repo}/issues/${opts.pr}/comments`,
    '--paginate',
    '--jq',
    `.[] | select(.body | startswith(${JSON.stringify(marker)})) | .id`,
  ]);
  const id = listed.split('\n').map((line) => line.trim()).find((line) => line !== '');
  if (id !== undefined) {
    gh(['api', '-X', 'PATCH', `repos/${opts.repo}/issues/comments/${id}`, '-f', `body=${body}`]);
    return { action: 'updated', id };
  }
  const created = gh([
    'api',
    `repos/${opts.repo}/issues/${opts.pr}/comments`,
    '-f',
    `body=${body}`,
    '--jq',
    '.id',
  ]).trim();
  return { action: 'created', id: created };
}
