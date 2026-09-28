/**
 * Picture benchmarks a pull request should show beside the behaviour ledger.
 *
 * A repo lists the pictures in vibes.images.json. For each one this module
 * reads the bytes at the base ref and the bytes in the work tree and says
 * which of the three columns a reviewer can actually see:
 *
 *   added    — the base ref has no such file. Current and difference are empty.
 *   changed  — both exist and differ. All three columns, difference drawn here.
 *   removed  — the base listed it and this change does not. New and difference
 *              are empty.
 *   unchanged — byte for byte the same, so the report does not repeat it.
 *
 * The committed pictures are linked by their raw URL. A difference picture is
 * not a committed file; the caller writes it and, when it has published that
 * file, passes the URL it will live at.
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

export type ImageStatus = 'added' | 'changed' | 'removed' | 'unchanged';

export interface ImageDecl {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly kind: string | null;
  readonly board: string | null;
  /** Other string fields on the manifest entry, in file order. */
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

const ID_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const KNOWN = new Set(['id', 'title', 'path', 'kind', 'board']);

/** Grey where the pictures agree, red where a pixel moved. Same reading as a
 *  schematic bench: a channel more than 16 apart counts as moved, and a
 *  picture that grew is compared on white. */
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
      const moved = Math.max(Math.abs(o[0] - n[0]), Math.abs(o[1] - n[1]), Math.abs(o[2] - n[2])) > 16;
      const i = (width * y + x) * 4;
      out.data[i] = moved ? 210 : 236;
      out.data[i + 1] = moved ? 32 : 236;
      out.data[i + 2] = moved ? 32 : 236;
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

export function classify(
  decl: ImageDecl,
  current: Buffer | null,
  next: Buffer | null,
  currentPath: string | null = null,
): Picture {
  const savedAt = current === null ? null : (currentPath ?? decl.path);
  if (current === null && next === null) {
    return { decl, status: 'removed', currentPath: null, current: null, next: null, diff: null };
  }
  if (current === null) {
    return { decl, status: 'added', currentPath: null, current: null, next, diff: null };
  }
  if (next === null) {
    return { decl, status: 'removed', currentPath: savedAt, current, next: null, diff: null };
  }
  if (current.equals(next)) {
    return { decl, status: 'unchanged', currentPath: savedAt, current, next, diff: null };
  }
  let diff: Buffer | null = null;
  try {
    diff = diffPng(current, next);
  } catch {
    diff = null;
  }
  return { decl, status: 'changed', currentPath: savedAt, current, next, diff };
}

function git(root: string, args: readonly string[], encoding: 'utf8'): string;
function git(root: string, args: readonly string[], encoding: 'buffer'): Buffer;
function git(root: string, args: readonly string[], encoding: 'utf8' | 'buffer'): string | Buffer {
  return execFileSync('git', args, {
    cwd: root,
    encoding,
    maxBuffer: 1 << 28,
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
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      problems.push(`${where}: expected an object`);
      continue;
    }
    const row = raw as Record<string, unknown>;
    const id = row['id'];
    const title = row['title'];
    const path = row['path'];
    if (typeof id !== 'string' || !ID_OK.test(id)) {
      problems.push(`${where}: id must be a token of letters, digits, '.', '_' or '-'`);
      continue;
    }
    if (typeof title !== 'string' || title.trim() === '') {
      problems.push(`${where}: title must be a non-empty string`);
      continue;
    }
    if (typeof path !== 'string' || relPath(path) === null) {
      problems.push(`${where}: path must be a relative path inside the repo`);
      continue;
    }
    const kind = optionalString(row['kind']);
    const board = optionalString(row['board']);
    if (row['kind'] !== undefined && kind === null) {
      problems.push(`${where}: kind must be a string`);
      continue;
    }
    if (row['board'] !== undefined && board === null) {
      problems.push(`${where}: board must be a string`);
      continue;
    }
    const meta: [string, string][] = [];
    let metaOk = true;
    for (const [key, value] of Object.entries(row)) {
      if (KNOWN.has(key)) continue;
      if (typeof value !== 'string') {
        problems.push(`${where}: ${key} must be a string`);
        metaOk = false;
        break;
      }
      meta.push([key, value]);
    }
    if (!metaOk) continue;
    decls.push({ id, title, path, kind, board, meta, from: file });
  }
  return { decls, problems };
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function loadDecls(root: string, ref: string | null): { decls: ImageDecl[]; problems: string[] } {
  const decls: ImageDecl[] = [];
  const problems: string[] = [];
  let paths: readonly string[];
  try {
    paths = manifestPaths(root, ref);
  } catch (e) {
    return { decls: [], problems: [`could not list picture manifests${ref === null ? '' : ` at ${ref}`} — ${(e as Error).message}`] };
  }
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

/**
 * Pictures declared on either side. Head is the work tree (ref null); base is
 * a commit-ish. An id is the picture's identity across the two manifests.
 */
export function loadPictures(root: string, baseRef: string): ImageLoad {
  const problems: string[] = [];
  const head = loadDecls(root, null);
  const base = loadDecls(root, baseRef);
  problems.push(...head.problems, ...base.problems);

  const byId = new Map<string, { head?: ImageDecl; base?: ImageDecl }>();
  for (const decl of base.decls) {
    const slot = byId.get(decl.id) ?? {};
    if (slot.base !== undefined) problems.push(`${decl.from}: duplicate picture id ${decl.id}`);
    slot.base = decl;
    byId.set(decl.id, slot);
  }
  for (const decl of head.decls) {
    const slot = byId.get(decl.id) ?? {};
    if (slot.head !== undefined) problems.push(`${decl.from}: duplicate picture id ${decl.id}`);
    slot.head = decl;
    byId.set(decl.id, slot);
  }

  const pictures: Picture[] = [];
  for (const slot of byId.values()) {
    const decl = slot.head ?? slot.base;
    if (decl === undefined) continue;
    const path = slot.head?.path ?? slot.base?.path ?? decl.path;
    const basePath = slot.base?.path ?? path;
    let current: Buffer | null = null;
    let next: Buffer | null = null;
    if (slot.base !== undefined) {
      try {
        current = blobAt(root, baseRef, basePath);
      } catch (e) {
        problems.push(`${basePath}: could not read the base picture — ${(e as Error).message}`);
      }
    }
    if (slot.head !== undefined) {
      try {
        next = blobAt(root, null, path);
      } catch (e) {
        problems.push(`${path}: could not read the new picture — ${(e as Error).message}`);
      }
      if (next === null) problems.push(`${path}: declared in ${decl.from} but the file is not in the work tree`);
    }
    if (current === null && next === null) continue;
    const picture = classify(slot.head ?? decl, current, next, slot.base === undefined ? null : basePath);
    if (picture.status === 'changed' && picture.diff === null) {
      problems.push(`${path}: the picture changed but the difference could not be drawn`);
    }
    pictures.push(picture);
  }
  return { pictures, problems };
}

export interface PictureView {
  /** https://github.com/owner/repo, no trailing slash. Committed pictures are
   *  loaded from `<github>/raw/<sha>/<path>`. */
  readonly github: string | null;
  readonly baseSha: string | null;
  readonly headSha: string | null;
  /** Where published difference pictures will be fetched from, no trailing
   *  slash. A file is `<diffBaseUrl>/<id>.diff.png`. */
  readonly diffBaseUrl: string | null;
}

export function rawUrl(github: string, sha: string, path: string): string {
  const encoded = path.split('/').map((seg) => encodeURIComponent(seg)).join('/');
  return `${github.replace(/\/$/, '')}/raw/${sha}/${encoded}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function metaLine(p: Picture): string {
  const d = p.decl;
  const bits = [d.kind, d.board === null ? null : `board \`${d.board}\``, `\`${d.path}\``, p.status];
  for (const [key, value] of d.meta) bits.push(`${key} \`${value}\``);
  return bits.filter((b): b is string => b !== null && b !== '').join(' · ');
}

function img(alt: string, src: string | null): string {
  if (src === null) return '';
  return `<img alt="${esc(alt)}" src="${esc(src)}" width="360">`;
}

/**
 * The review section. Unchanged pictures are counted only when something else
 * is on screen; a change that touches no picture produces no section at all.
 * A column with no picture is an empty cell, not a placeholder word.
 */
export function renderPictures(pictures: readonly Picture[], view: PictureView): string {
  const shown = pictures.filter((p) => p.status !== 'unchanged');
  if (shown.length === 0) return '';
  const unchanged = pictures.length - shown.length;
  const lines: string[] = ['## Pictures', ''];
  for (const p of shown) {
    const current =
      p.current !== null && p.currentPath !== null && view.github !== null && view.baseSha !== null
        ? rawUrl(view.github, view.baseSha, p.currentPath)
        : null;
    const nextSrc =
      p.next !== null && view.github !== null && view.headSha !== null
        ? rawUrl(view.github, view.headSha, p.decl.path)
        : null;
    const diffSrc =
      p.diff !== null && view.diffBaseUrl !== null ? `${view.diffBaseUrl.replace(/\/$/, '')}/${p.decl.id}.diff.png` : null;
    lines.push(`### ${esc(p.decl.title)}`, '', esc(metaLine(p)), '');
    lines.push('| Current | New | Difference |', '|---|---|---|');
    lines.push(`| ${img(`${p.decl.title}, current`, current)} | ${img(`${p.decl.title}, new`, nextSrc)} | ${img(`${p.decl.title}, difference`, diffSrc)} |`, '');
  }
  if (unchanged > 0) {
    lines.push(`_${String(unchanged)} picture${unchanged === 1 ? '' : 's'} unchanged._`, '');
  }
  return lines.join('\n');
}

/** A list, without its own top heading, so it can sit under Pictures. */
export function renderImageProblems(problems: readonly string[]): string {
  if (problems.length === 0) return '';
  return ['### Could not read', '', ...problems.map((p) => `- ${p}`), ''].join('\n');
}

/** Write the difference (and copies of current and new) so a browser can open
 *  them without GitHub. Returns the number of difference files written. */
export function writeGallery(dir: string, pictures: readonly Picture[]): number {
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
    const id = p.decl.id;
    blocks.push(`<h2>${esc(p.decl.title)}</h2>`);
    blocks.push(`<p>${esc(metaLine(p).replace(/`/g, ''))}</p>`);
    blocks.push('<div class="row">');
    for (const [label, bytes, name] of [
      ['Current', p.current, `${id}.current.png`],
      ['New', p.next, `${id}.new.png`],
      ['Difference', p.diff, `${id}.diff.png`],
    ] as const) {
      if (bytes !== null) {
        writeFileSync(join(dir, name), bytes);
        if (label === 'Difference') diffs += 1;
        blocks.push(`<figure><figcaption>${label}</figcaption><img src="${name}" alt="${esc(p.decl.title)}, ${label.toLowerCase()}"></figure>`);
      } else {
        blocks.push(`<figure><figcaption>${label}</figcaption></figure>`);
      }
    }
    blocks.push('</div>');
  }
  writeFileSync(join(dir, 'index.html'), blocks.join('\n'));
  return diffs;
}

export function resolveSha(root: string, ref: string): string {
  return git(root, ['rev-parse', '--verify', `${ref}^{commit}`], 'utf8').trim();
}
