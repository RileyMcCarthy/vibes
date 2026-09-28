/**
 * Pictures a pull request should show beside the behaviour ledger.
 *
 * A repo lists them in vibes.images.json. The only fields Vibes understands
 * are the id, the title, and the path. Every other string on an entry is
 * metadata the repo chose, printed beside the picture and never interpreted.
 *
 * For each id this module reads the bytes at the base ref and the bytes in
 * the work tree:
 *
 *   added     — the base ref has no such file. Current and difference are empty.
 *   changed   — both exist and differ. All three columns; the difference is drawn here.
 *   removed   — the base listed it and this change does not. New and difference are empty.
 *   unchanged — byte for byte the same, so the report does not repeat it.
 *
 * Committed pictures are linked by their raw URL. A difference picture is not
 * a committed file. `cells` is the one place that decides which of the three
 * columns has bytes and which has a URL; the markdown and the HTML gallery
 * both render that.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

interface PngImage {
  width: number;
  height: number;
  data: Buffer;
}

interface PngCtor {
  sync: {
    read(buf: Buffer): PngImage;
    write(png: PngImage): Buffer;
  };
  new (opts: { width: number; height: number }): PngImage;
}

const { PNG } = require('pngjs') as { PNG: PngCtor };

export const MANIFEST = 'vibes.images.json';

/** A difference file is `<id>.diff.png`. `publish` looks for the same suffix. */
export const DIFF_SUFFIX = '.diff.png';

/** A channel this far from its pair has moved. At or under it, the pixel agrees.
 *  Out-of-range pixels (a picture that grew) are compared against white. */
export const CHANNEL_DELTA = 16;
const AGREE: readonly [number, number, number] = [236, 236, 236];
const MOVED: readonly [number, number, number] = [210, 32, 32];

export type ImageStatus = 'added' | 'changed' | 'removed' | 'unchanged';

export interface ImageDecl {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  /** String fields other than id, title, and path, in file order. */
  readonly meta: readonly (readonly [string, string])[];
  readonly from: string;
}

export interface Picture {
  readonly decl: ImageDecl;
  readonly status: ImageStatus;
  /** Path of `current` at the base ref. A rename keeps the old URL working. */
  readonly currentPath: string | null;
  readonly current: Buffer | null;
  readonly next: Buffer | null;
  readonly diff: Buffer | null;
}

export interface ImageLoad {
  readonly pictures: readonly Picture[];
  readonly problems: readonly string[];
}

/** One column of the review. `bytes` is what a local gallery can write.
 *  `url` is what a comment can load. Either may be absent. */
export interface Cell {
  readonly label: 'Current' | 'New' | 'Difference';
  readonly bytes: Buffer | null;
  readonly url: string | null;
  readonly filename: string;
}

export interface PictureView {
  /** https://github.com/owner/repo, no trailing slash. */
  readonly github: string | null;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  /** Where published difference pictures will be fetched from, no trailing
   *  slash. A file is `<diffBaseUrl>/<id>.diff.png`. */
  readonly diffBaseUrl: string | null;
}

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RESERVED = new Set(['id', 'title', 'path']);

/** Where difference pictures are published, or the explicit URL when one was given. */
export function diffBase(github: string | null, ref: string | null, into: string | null, explicit: string | null): string | null {
  if (explicit !== null && explicit !== '') return explicit.replace(/\/$/, '');
  if (github !== null && github !== '' && ref !== null && ref !== '' && into !== null && into !== '') {
    return `${github.replace(/\/$/, '')}/raw/${ref}/${into}`;
  }
  return null;
}

export function rawUrl(github: string, sha: string, path: string): string {
  const encoded = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `${github.replace(/\/$/, '')}/raw/${sha}/${encoded}`;
}

/** The three columns, in review order. A column with nothing to show has
 *  neither bytes nor a URL, which is an empty cell — not a placeholder word. */
export function cells(p: Picture, view: PictureView): readonly [Cell, Cell, Cell] {
  const id = p.decl.id;
  const github = view.github;
  return [
    {
      label: 'Current',
      bytes: p.current,
      filename: `${id}.current.png`,
      url:
        p.current !== null && p.currentPath !== null && github !== null && view.baseSha !== null
          ? rawUrl(github, view.baseSha, p.currentPath)
          : null,
    },
    {
      label: 'New',
      bytes: p.next,
      filename: `${id}.new.png`,
      url:
        p.next !== null && github !== null && view.headSha !== null
          ? rawUrl(github, view.headSha, p.decl.path)
          : null,
    },
    {
      label: 'Difference',
      bytes: p.diff,
      filename: `${id}${DIFF_SUFFIX}`,
      url: p.diff !== null && view.diffBaseUrl !== null ? `${view.diffBaseUrl.replace(/\/$/, '')}/${id}${DIFF_SUFFIX}` : null,
    },
  ];
}

/** Grey where the pictures agree, red where a pixel moved. */
export function diffPng(saved: Buffer, next: Buffer): Buffer {
  const old = PNG.sync.read(saved);
  const nxt = PNG.sync.read(next);
  const width = Math.max(old.width, nxt.width);
  const height = Math.max(old.height, nxt.height);
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = sample(old, x, y);
      const n = sample(nxt, x, y);
      const moved =
        Math.max(Math.abs(o[0] - n[0]), Math.abs(o[1] - n[1]), Math.abs(o[2] - n[2])) > CHANNEL_DELTA;
      const rgb = moved ? MOVED : AGREE;
      const i = (width * y + x) * 4;
      out.data[i] = rgb[0];
      out.data[i + 1] = rgb[1];
      out.data[i + 2] = rgb[2];
      out.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(out);
}

function sample(img: PngImage, x: number, y: number): readonly [number, number, number] {
  if (x >= img.width || y >= img.height) return [255, 255, 255];
  const i = (img.width * y + x) * 4;
  return [img.data[i] ?? 255, img.data[i + 1] ?? 255, img.data[i + 2] ?? 255];
}

function picture(
  decl: ImageDecl,
  status: ImageStatus,
  currentPath: string | null,
  current: Buffer | null,
  next: Buffer | null,
  diff: Buffer | null,
): Picture {
  return { decl, status, currentPath, current, next, diff };
}

export function classify(
  decl: ImageDecl,
  current: Buffer | null,
  next: Buffer | null,
  currentPath: string | null = null,
): Picture {
  const savedAt = current === null ? null : (currentPath ?? decl.path);
  if (current === null) return picture(decl, 'added', null, null, next, null);
  if (next === null) return picture(decl, 'removed', savedAt, current, null, null);
  if (current.equals(next)) return picture(decl, 'unchanged', savedAt, current, next, null);
  let diff: Buffer | null = null;
  try {
    diff = diffPng(current, next);
  } catch {
    diff = null;
  }
  return picture(decl, 'changed', savedAt, current, next, diff);
}

function git(root: string, args: readonly string[], encoding: 'utf8'): string;
function git(root: string, args: readonly string[], encoding: 'buffer'): Buffer;
function git(root: string, args: readonly string[], encoding: 'utf8' | 'buffer'): string | Buffer {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 1 << 28,
    // A missing path is handled by the caller. git's "fatal:" line would
    // otherwise leak into every first-adoption log.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/** Tracked manifests. Untracked ones are invisible, same rule as suites: a
 *  picture nobody committed is not part of the review. */
export function manifestPaths(root: string, ref: string | null): readonly string[] {
  const names =
    ref === null
      ? git(root, ['ls-files', '-z', `*${MANIFEST}`], 'utf8')
      : git(root, ['ls-tree', '-r', '--name-only', '-z', ref], 'utf8');
  return names.split('\0').filter((p) => p.endsWith(MANIFEST));
}

function textAt(root: string, ref: string | null, path: string): string | null {
  if (ref === null) {
    const abs = join(root, path);
    return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
  }
  try {
    return git(root, ['show', `${ref}:${path}`], 'utf8');
  } catch {
    return null;
  }
}

export function blobAt(root: string, ref: string | null, path: string): Buffer | null {
  if (ref === null) {
    const abs = join(root, path);
    return existsSync(abs) ? readFileSync(abs) : null;
  }
  try {
    return git(root, ['show', `${ref}:${path}`], 'buffer');
  } catch {
    return null;
  }
}

function relPath(value: string): string | null {
  if (value === '' || value.startsWith('/') || value.split('/').includes('..')) return null;
  return value;
}

/** One manifest file. `problems` names every entry that cannot be shown; the
 *  rest still load, so one bad row does not hide the other pictures. */
export function parseManifest(text: string, file: string): { decls: ImageDecl[]; problems: string[] } {
  const problems: string[] = [];
  let doc: unknown;
  try {
    doc = JSON.parse(text) as unknown;
  } catch (e) {
    return { decls: [], problems: [`${file}: not valid JSON — ${(e as Error).message}`] };
  }
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) {
    return { decls: [], problems: [`${file}: expected an object`] };
  }
  const rec = doc as Record<string, unknown>;
  if (rec['v'] !== 1) {
    return { decls: [], problems: [`${file}: schema v${String(rec['v'])} unsupported (expects v1)`] };
  }
  if (!Array.isArray(rec['images'])) {
    return { decls: [], problems: [`${file}: images must be a list`] };
  }
  const decls: ImageDecl[] = [];
  for (const [index, raw] of rec['images'].entries()) {
    const where = `${file}: images[${String(index)}]`;
    const parsed = parseEntry(raw, where);
    if (typeof parsed === 'string') problems.push(parsed);
    else decls.push({ ...parsed, from: file });
  }
  return { decls, problems };
}

function parseEntry(raw: unknown, where: string): Omit<ImageDecl, 'from'> | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return `${where}: expected an object`;
  const row = raw as Record<string, unknown>;
  const id = row['id'];
  const title = row['title'];
  const path = row['path'];
  if (typeof id !== 'string' || !ID_OK.test(id)) {
    return `${where}: id must be a token of letters, digits, '.', '_' or '-'`;
  }
  if (typeof title !== 'string' || title.trim() === '') return `${where}: title must be a non-empty string`;
  if (typeof path !== 'string' || relPath(path) === null) return `${where}: path must be a relative path inside the repo`;
  const meta: [string, string][] = [];
  for (const [key, value] of Object.entries(row)) {
    if (RESERVED.has(key)) continue;
    if (typeof value !== 'string') return `${where}: ${key} must be a string`;
    meta.push([key, value]);
  }
  return { id, title, path, meta };
}

interface Slot {
  head: ImageDecl | null;
  base: ImageDecl | null;
}

function loadDecls(root: string, ref: string | null): { decls: ImageDecl[]; problems: string[] } {
  const problems: string[] = [];
  let paths: readonly string[];
  try {
    paths = manifestPaths(root, ref);
  } catch (e) {
    return { decls: [], problems: [`could not list picture manifests${ref === null ? '' : ` at ${ref}`} — ${(e as Error).message}`] };
  }
  const decls: ImageDecl[] = [];
  for (const file of paths) {
    const text = textAt(root, ref, file);
    if (text === null) {
      problems.push(`${file}: listed but unreadable`);
      continue;
    }
    const parsed = parseManifest(text, file);
    decls.push(...parsed.decls);
    problems.push(...parsed.problems);
  }
  return { decls, problems };
}

function remember(map: Map<string, Slot>, order: string[], side: 'head' | 'base', decl: ImageDecl, problems: string[]): void {
  if (!order.includes(decl.id)) order.push(decl.id);
  const slot = map.get(decl.id) ?? { head: null, base: null };
  if (slot[side] !== null) {
    problems.push(`${decl.from}: duplicate picture id ${decl.id}`);
    return;
  }
  slot[side] = decl;
  map.set(decl.id, slot);
}

/**
 * Pictures declared on either side. Head is the work tree; base is a
 * commit-ish. Order is the head manifest, then pictures that exist only at
 * the base. An id is the picture's identity across the two manifests.
 */
export function loadPictures(root: string, baseRef: string): ImageLoad {
  const problems: string[] = [];
  const head = loadDecls(root, null);
  const base = loadDecls(root, baseRef);
  problems.push(...head.problems, ...base.problems);
  // A base ref we could not read is not "the base has no pictures". Reporting
  // every current picture as added would hide that the comparison did not happen.
  if (base.problems.some((p) => p.startsWith('could not list picture manifests'))) {
    return { pictures: [], problems };
  }

  const byId = new Map<string, Slot>();
  const order: string[] = [];
  for (const decl of head.decls) remember(byId, order, 'head', decl, problems);
  for (const decl of base.decls) remember(byId, order, 'base', decl, problems);

  const pictures: Picture[] = [];
  for (const id of order) {
    const slot = byId.get(id);
    if (slot === undefined) continue;
    const decl = slot.head ?? slot.base;
    if (decl === null) continue;
    const path = slot.head?.path ?? decl.path;
    const basePath = slot.base?.path ?? path;
    let current: Buffer | null = null;
    let next: Buffer | null = null;
    if (slot.base !== null) current = blobAt(root, baseRef, basePath);
    if (slot.head !== null) {
      next = blobAt(root, null, path);
      if (next === null) problems.push(`${path}: declared in ${decl.from} but the file is not in the work tree`);
    }
    if (current === null && next === null) continue;
    const shown = classify(decl, current, next, slot.base === null ? null : basePath);
    if (shown.status === 'changed' && shown.diff === null) {
      problems.push(`${path}: the picture changed but the difference could not be drawn`);
    }
    pictures.push(shown);
  }
  return { pictures, problems };
}

export function resolveSha(root: string, ref: string): string {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`], 'utf8').trim();
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metaLine(p: Picture): string {
  const bits = [`\`${p.decl.path}\``, p.status];
  for (const [key, value] of p.decl.meta) bits.push(`${key} \`${value}\``);
  return bits.join(' · ');
}

function img(alt: string, src: string | null): string {
  if (src === null) return '';
  return `<img alt="${esc(alt)}" src="${esc(src)}" width="360">`;
}

/**
 * The review section. Unchanged pictures are counted only when something else
 * is on screen; a change that touches no picture produces no section at all.
 */
export function renderPictures(pictures: readonly Picture[], view: PictureView): string {
  const shown = pictures.filter((p) => p.status !== 'unchanged');
  if (shown.length === 0) return '';
  const unchanged = pictures.length - shown.length;
  const lines: string[] = ['## Pictures', ''];
  for (const p of shown) {
    const row = cells(p, view).map((c) => img(`${p.decl.title}, ${c.label.toLowerCase()}`, c.url));
    lines.push(`### ${esc(p.decl.title)}`, '', esc(metaLine(p)), '');
    lines.push('| Current | New | Difference |', '|---|---|---|', `| ${row.join(' | ')} |`, '');
  }
  if (unchanged > 0) lines.push(`_${String(unchanged)} picture${unchanged === 1 ? '' : 's'} unchanged._`, '');
  return lines.join('\n');
}

/** A list, without its own top heading, so it can sit under Pictures. */
export function renderImageProblems(problems: readonly string[]): string {
  if (problems.length === 0) return '';
  return ['### Could not read', '', ...problems.map((p) => `- ${p}`), ''].join('\n');
}

/** Pictures, then anything that could not be read. Neither means no section. */
export function renderPictureSection(pictures: readonly Picture[], problems: readonly string[], view: PictureView): string {
  const body = renderPictures(pictures, view);
  const errs = renderImageProblems(problems);
  if (body === '' && errs === '') return '';
  if (body === '') return `## Pictures\n\n${errs}`;
  if (errs === '') return body;
  return `${body}\n${errs}`;
}

/** Write the three columns so a browser can open them without GitHub.
 *  Returns how many difference files were written. */
export function writeGallery(dir: string, pictures: readonly Picture[], view: PictureView): number {
  const shown = pictures.filter((p) => p.status !== 'unchanged');
  if (shown.length === 0) return 0;
  mkdirSync(dir, { recursive: true });
  let diffs = 0;
  const blocks: string[] = [
    '<!DOCTYPE html><meta charset=utf-8><title>Pictures</title>',
    '<style>body{font:16px sans-serif;background:#111;color:#eee;margin:24px} img{max-width:100%;background:#fff} figure{margin:0} .row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin:24px 0} figcaption{color:#aaa;margin-bottom:6px}</style>',
    '<h1>Pictures</h1>',
    '<p>Current, new, and the pixels that moved. An empty column is a picture this change does not have.</p>',
  ];
  for (const p of shown) {
    blocks.push(`<h2>${esc(p.decl.title)}</h2>`);
    blocks.push(`<p>${esc(metaLine(p).replace(/`/g, ''))}</p>`);
    blocks.push('<div class="row">');
    for (const cell of cells(p, view)) {
      if (cell.bytes !== null) {
        writeFileSync(join(dir, cell.filename), cell.bytes);
        if (cell.label === 'Difference') diffs += 1;
        blocks.push(`<figure><figcaption>${cell.label}</figcaption><img src="${cell.filename}" alt="${esc(p.decl.title)}, ${cell.label.toLowerCase()}"></figure>`);
      } else {
        blocks.push(`<figure><figcaption>${cell.label}</figcaption></figure>`);
      }
    }
    blocks.push('</div>');
  }
  writeFileSync(join(dir, 'index.html'), blocks.join('\n'));
  return diffs;
}
