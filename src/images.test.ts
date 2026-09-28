import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  classify,
  loadPictures,
  parseManifest,
  rawUrl,
  renderPictures,
  writeGallery,
  type ImageDecl,
  type PictureView,
} from './images.js';
import { main } from './cli.js';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as {
  PNG: {
    sync: { read(buf: Buffer): { width: number; height: number; data: Buffer }; write(png: { width: number; height: number; data: Buffer }): Buffer };
    new (opts: { width: number; height: number }): { width: number; height: number; data: Buffer };
  };
};

function solid(r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

function decl(over: Partial<ImageDecl> = {}): ImageDecl {
  return {
    id: 'blinky',
    title: 'Blinky',
    path: 'tests/benchmarks/schematics/blinky.png',
    kind: 'schematic',
    board: 'blinky',
    meta: [],
    from: 'vibes.images.json',
    ...over,
  };
}

const view: PictureView = {
  github: 'https://github.com/acme/pcbc',
  baseSha: 'BASE',
  headSha: 'HEAD',
  diffBaseUrl: 'https://github.com/acme/pcbc/raw/vibes-images/HEAD',
};

describe('a picture the base does not have', () => {
  it('shows the new picture and leaves current and difference empty', () => {
    const picture = classify(decl(), null, solid(0, 0, 0));
    expect(picture.status).toBe('added');
    expect(picture.diff).toBeNull();
    const md = renderPictures([picture], view);
    expect(md).toContain('### Blinky');
    expect(md).toContain('schematic · board `blinky` · `tests/benchmarks/schematics/blinky.png` · added');
    expect(md.match(/<img /g)).toHaveLength(1);
    expect(md).toContain('alt="Blinky, new"');
    expect(md).toContain('https://github.com/acme/pcbc/raw/HEAD/tests/benchmarks/schematics/blinky.png');
    expect(md).not.toContain('Blinky, current');
    expect(md).not.toContain('Blinky, difference');
    expect(md).toContain('|  | <img alt="Blinky, new"');
  });
});

describe('a picture that moved', () => {
  it('shows current, new, and a red difference', () => {
    const picture = classify(decl(), solid(255, 255, 255), solid(0, 0, 0));
    expect(picture.status).toBe('changed');
    expect(picture.diff).not.toBeNull();
    const decoded = PNG.sync.read(picture.diff as Buffer);
    expect(decoded.data[0]).toBe(210);
    expect(decoded.data[1]).toBe(32);
    const md = renderPictures([picture], view);
    expect(md.match(/<img /g)).toHaveLength(3);
    expect(md).toContain('/raw/BASE/tests/benchmarks/schematics/blinky.png');
    expect(md).toContain('/raw/HEAD/tests/benchmarks/schematics/blinky.png');
    expect(md).toContain('https://github.com/acme/pcbc/raw/vibes-images/HEAD/blinky.diff.png');
  });

  it('leaves the difference cell empty when the difference has nowhere to be published', () => {
    const picture = classify(decl(), solid(255, 255, 255), solid(0, 0, 0));
    const md = renderPictures([picture], { ...view, diffBaseUrl: null });
    expect(md.match(/<img /g)).toHaveLength(2);
    expect(md).not.toContain('difference');
  });

  it('treats a pixel within the threshold as agreement', () => {
    const picture = classify(decl(), solid(250, 250, 250), solid(240, 250, 250));
    expect(picture.status).toBe('changed');
    const decoded = PNG.sync.read(picture.diff as Buffer);
    expect(decoded.data[0]).toBe(236);
  });
});

describe('what the report leaves out', () => {
  it('says nothing when every picture is unchanged', () => {
    const png = solid(1, 2, 3);
    const picture = classify(decl(), png, Buffer.from(png));
    expect(picture.status).toBe('unchanged');
    expect(renderPictures([picture], view)).toBe('');
  });

  it('counts unchanged pictures only beside one that is shown', () => {
    const png = solid(1, 2, 3);
    const md = renderPictures(
      [classify(decl(), null, png), classify(decl({ id: 'buck', title: 'Buck' }), png, Buffer.from(png))],
      view,
    );
    expect(md).toContain('### Blinky');
    expect(md).not.toContain('### Buck');
    expect(md).toContain('_1 picture unchanged._');
  });

  it('shows a removed picture in the current column only', () => {
    const picture = classify(decl(), solid(1, 2, 3), null);
    const md = renderPictures([picture], view);
    expect(md.match(/<img /g)).toHaveLength(1);
    expect(md).toContain('alt="Blinky, current"');
    expect(md).toContain('· removed');
  });
});

describe('the manifest', () => {
  it('rejects a path that leaves the repo and keeps the valid rows', () => {
    const parsed = parseManifest(
      JSON.stringify({
        v: 1,
        images: [
          { id: 'ok', title: 'Ok', path: 'a/b.png', kind: 'schematic', board: 'a', note: 'first sheet' },
          { id: 'no', title: 'No', path: '../secret.png' },
        ],
      }),
      'vibes.images.json',
    );
    expect(parsed.decls).toHaveLength(1);
    expect(parsed.decls[0]?.meta).toEqual([['note', 'first sheet']]);
    expect(parsed.problems[0]).toContain('relative path');
  });

  it('encodes a path segment without eating the slashes', () => {
    expect(rawUrl('https://github.com/acme/pcbc/', 'abc', 'tests/a b.png')).toBe(
      'https://github.com/acme/pcbc/raw/abc/tests/a%20b.png',
    );
  });
});

describe('against a real base ref', () => {
  function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'vibes-img-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'vibes@example.com');
    git('config', 'user.name', 'Vibes');
    return dir;
  }

  function commit(dir: string, message: string): string {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  }

  it('reads a first picture as added, with current and difference blank', () => {
    const dir = repo();
    writeFileSync(join(dir, 'README'), 'base\n');
    const base = commit(dir, 'base');
    mkdirSync(join(dir, 'sheets'));
    writeFileSync(join(dir, 'sheets/blinky.png'), solid(9, 9, 9));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      JSON.stringify({ v: 1, images: [{ id: 'blinky', title: 'Blinky', path: 'sheets/blinky.png', kind: 'schematic', board: 'blinky' }] }),
    );
    commit(dir, 'pictures');
    const loaded = loadPictures(dir, base);
    expect(loaded.problems).toEqual([]);
    expect(loaded.pictures).toHaveLength(1);
    expect(loaded.pictures[0]?.status).toBe('added');
    expect(loaded.pictures[0]?.current).toBeNull();
    expect(loaded.pictures[0]?.diff).toBeNull();
    const gallery = join(dir, 'out');
    expect(writeGallery(gallery, loaded.pictures)).toBe(0);
    const html = readFileSync(join(gallery, 'index.html'), 'utf8');
    expect(html).toContain('blinky.new.png');
    expect(html).not.toContain('blinky.current.png');
    expect(html).not.toContain('blinky.diff.png');
  });

  it('draws the difference once the base has a picture', () => {
    const dir = repo();
    mkdirSync(join(dir, 'sheets'));
    writeFileSync(join(dir, 'sheets/blinky.png'), solid(255, 255, 255));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      JSON.stringify({ v: 1, images: [{ id: 'blinky', title: 'Blinky', path: 'sheets/blinky.png', kind: 'schematic', board: 'blinky' }] }),
    );
    const base = commit(dir, 'base');
    writeFileSync(join(dir, 'sheets/blinky.png'), solid(0, 0, 0));
    commit(dir, 'move');
    const loaded = loadPictures(dir, base);
    expect(loaded.pictures[0]?.status).toBe('changed');
    expect(writeGallery(join(dir, 'out'), loaded.pictures)).toBe(1);
    expect(readFileSync(join(dir, 'out/blinky.diff.png')).length).toBeGreaterThan(0);
  });
});

describe('the report command', () => {
  it('leads with the new picture when no behaviour changed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibes-cli-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q');
    git('config', 'user.email', 'vibes@example.com');
    git('config', 'user.name', 'Vibes');
    writeFileSync(join(dir, 'README'), 'base\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, 'a.png'), solid(3, 3, 3));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      JSON.stringify({ v: 1, images: [{ id: 'a', title: 'Alpha <sheet>', path: 'a.png', kind: 'schematic', board: 'a' }] }),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'pic');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();

    const previous = process.cwd();
    const summary = process.env['GITHUB_STEP_SUMMARY'];
    delete process.env['GITHUB_STEP_SUMMARY'];
    let out = '';
    const write = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      return true;
    }) as typeof process.stdout.write;
    process.chdir(dir);
    try {
      const code = await main([
        'report',
        '--base',
        base,
        '--github',
        'https://github.com/acme/pcbc',
        '--head',
        head,
        '--diff-dir',
        join(dir, 'gallery'),
      ]);
      expect(code).toBe(0);
    } finally {
      process.chdir(previous);
      process.stdout.write = write;
      if (summary === undefined) delete process.env['GITHUB_STEP_SUMMARY'];
      else process.env['GITHUB_STEP_SUMMARY'] = summary;
    }
    expect(out.indexOf('## Pictures')).toBeLessThan(out.indexOf('No behaviour added'));
    expect(out).toContain('Alpha &lt;sheet&gt;');
    expect(out.match(/<img /g)).toHaveLength(1);
    expect(out).toContain(`/raw/${head}/a.png`);
  });
});
