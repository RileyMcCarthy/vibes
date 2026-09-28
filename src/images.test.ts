import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { main } from './cli.js';
import {
  CHANNEL_DELTA,
  cells,
  classify,
  diffBase,
  diffPng,
  loadPictures,
  parseManifest,
  rawUrl,
  renderPictureSection,
  renderPictures,
  writeGallery,
  type ImageDecl,
  type PictureView,
} from './images.js';

const require = createRequire(import.meta.url);
const { PNG } = require('pngjs') as {
  PNG: {
    sync: {
      read(buf: Buffer): { width: number; height: number; data: Buffer };
      write(png: { width: number; height: number; data: Buffer }): Buffer;
    };
    new (opts: { width: number; height: number }): { width: number; height: number; data: Buffer };
  };
};

function solid(w: number, h: number, r: number, g: number, b: number): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    png.data[o] = r;
    png.data[o + 1] = g;
    png.data[o + 2] = b;
    png.data[o + 3] = 255;
  }
  return PNG.sync.write(png);
}

function pixel(buf: Buffer, x: number, y: number): [number, number, number] {
  const img = PNG.sync.read(buf);
  const i = (img.width * y + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
}

function decl(over: Partial<ImageDecl> = {}): ImageDecl {
  return {
    id: 'overview',
    title: 'Overview',
    path: 'docs/overview.png',
    meta: [],
    from: 'vibes.images.json',
    ...over,
  };
}

const view: PictureView = {
  github: 'https://github.com/acme/app',
  baseSha: 'BASE',
  headSha: 'HEAD',
  diffBaseUrl: 'https://github.com/acme/app/raw/vibes-images/HEAD',
};

const blank: PictureView = { github: null, baseSha: null, headSha: null, diffBaseUrl: null };

describe('a picture the base does not have', () => {
  const picture = classify(decl(), null, solid(2, 2, 0, 0, 0));

  it('is added, with no difference to draw', () => {
    expect(picture.status).toBe('added');
    expect(picture.diff).toBeNull();
    const [current, next, diff] = cells(picture, view);
    expect(current.url).toBeNull();
    expect(current.bytes).toBeNull();
    expect(diff.url).toBeNull();
    expect(next.url).toBe('https://github.com/acme/app/raw/HEAD/docs/overview.png');
  });

  it('renders one image and leaves the other two cells empty', () => {
    const md = renderPictures([picture], view);
    expect(md).toContain('### Overview');
    expect(md).toContain('`docs/overview.png` · added');
    expect(md.match(/<img /g)).toHaveLength(1);
    expect(md).toContain('alt="Overview, new"');
    expect(md).not.toContain('Overview, current');
    expect(md).not.toContain('Overview, difference');
    expect(md).toContain('|  | <img alt="Overview, new"');
  });

  it('still writes the new picture locally when there is no host to link', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibes-gallery-'));
    expect(writeGallery(dir, [picture], blank)).toBe(0);
    expect(readFileSync(join(dir, 'overview.new.png')).length).toBeGreaterThan(0);
    expect(renderPictures([picture], blank)).not.toContain('<img ');
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('overview.new.png');
    expect(html).not.toContain('overview.current.png');
    expect(html).not.toContain('overview.diff.png');
  });
});

describe('a picture that moved', () => {
  it('shows all three columns and paints a moved pixel red', () => {
    const picture = classify(decl(), solid(2, 2, 255, 255, 255), solid(2, 2, 0, 0, 0));
    expect(picture.status).toBe('changed');
    expect(pixel(picture.diff as Buffer, 0, 0)).toEqual([210, 32, 32]);
    const md = renderPictures([picture], view);
    expect(md.match(/<img /g)).toHaveLength(3);
    expect(md).toContain('/raw/BASE/docs/overview.png');
    expect(md).toContain('/raw/HEAD/docs/overview.png');
    expect(md).toContain('https://github.com/acme/app/raw/vibes-images/HEAD/overview.diff.png');
  });

  it('leaves the difference cell empty when it has nowhere to be published', () => {
    const picture = classify(decl(), solid(2, 2, 255, 255, 255), solid(2, 2, 0, 0, 0));
    const md = renderPictures([picture], { ...view, diffBaseUrl: null });
    expect(md.match(/<img /g)).toHaveLength(2);
    expect(md).not.toContain('alt="Overview, difference"');
  });

  it('treats a channel at the threshold as agreement and one past it as movement', () => {
    const base = solid(1, 1, 250, 250, 250);
    const agree = diffPng(base, solid(1, 1, 250 - CHANNEL_DELTA, 250, 250));
    const moved = diffPng(base, solid(1, 1, 250 - CHANNEL_DELTA - 1, 250, 250));
    expect(pixel(agree, 0, 0)).toEqual([236, 236, 236]);
    expect(pixel(moved, 0, 0)).toEqual([210, 32, 32]);
  });

  it('paints the new margin red when the picture grew', () => {
    const old = solid(1, 1, 255, 255, 255);
    const next = new PNG({ width: 2, height: 1 });
    next.data[0] = next.data[1] = next.data[2] = 255;
    next.data[3] = 255;
    next.data[4] = next.data[5] = next.data[6] = 0;
    next.data[7] = 255;
    const diff = diffPng(old, PNG.sync.write(next));
    expect(pixel(diff, 0, 0)).toEqual([236, 236, 236]);
    expect(pixel(diff, 1, 0)).toEqual([210, 32, 32]);
  });

  it('keeps the two pictures when the difference cannot be drawn', () => {
    const picture = classify(decl(), solid(1, 1, 0, 0, 0), Buffer.from('not a png'));
    expect(picture.status).toBe('changed');
    expect(picture.diff).toBeNull();
    expect(cells(picture, view)[2].url).toBeNull();
  });
});

describe('what the report leaves out', () => {
  it('says nothing when every picture is unchanged', () => {
    const png = solid(1, 1, 1, 2, 3);
    const picture = classify(decl(), png, Buffer.from(png));
    expect(picture.status).toBe('unchanged');
    expect(renderPictures([picture], view)).toBe('');
    const dir = mkdtempSync(join(tmpdir(), 'vibes-gallery-'));
    expect(writeGallery(dir, [picture], view)).toBe(0);
  });

  it('counts unchanged pictures only beside one that is shown', () => {
    const png = solid(1, 1, 1, 2, 3);
    const md = renderPictures(
      [classify(decl(), null, png), classify(decl({ id: 'other', title: 'Other' }), png, Buffer.from(png))],
      view,
    );
    expect(md).toContain('### Overview');
    expect(md).not.toContain('### Other');
    expect(md).toContain('_1 picture unchanged._');
  });

  it('shows a removed picture in the current column only', () => {
    const picture = classify(decl(), solid(1, 1, 1, 2, 3), null);
    const md = renderPictures([picture], view);
    expect(md.match(/<img /g)).toHaveLength(1);
    expect(md).toContain('alt="Overview, current"');
    expect(md).toContain('· removed');
  });
});

describe('the manifest', () => {
  it('keeps every extra string as metadata, in file order, and drops a bad row', () => {
    const parsed = parseManifest(
      JSON.stringify({
        v: 1,
        images: [
          { id: 'ok', title: 'Ok', path: 'a/b.png', note: 'first', kind: 'screen' },
          { id: 'no', title: 'No', path: '../secret.png' },
          { id: 'bad', title: 'Bad', path: 'c.png', zoom: 2 },
        ],
      }),
      'vibes.images.json',
    );
    expect(parsed.decls).toHaveLength(1);
    expect(parsed.decls[0]?.meta).toEqual([
      ['note', 'first'],
      ['kind', 'screen'],
    ]);
    expect(parsed.problems[0]).toContain('path must be a relative path inside the repo');
    expect(parsed.problems[1]).toContain('zoom must be a string');
    const md = renderPictures([classify(parsed.decls[0] as ImageDecl, null, solid(1, 1, 0, 0, 0))], view);
    expect(md).toContain('`a/b.png` · added · note `first` · kind `screen`');
  });

  it('rejects an unknown schema instead of guessing', () => {
    const parsed = parseManifest(JSON.stringify({ v: 2, images: [] }), 'vibes.images.json');
    expect(parsed.decls).toEqual([]);
    expect(parsed.problems[0]).toContain('schema v2 unsupported');
  });

  it('escapes a title and encodes a path segment without eating the slashes', () => {
    const md = renderPictures([classify(decl({ title: 'A <b>' }), null, solid(1, 1, 0, 0, 0))], view);
    expect(md).toContain('### A &lt;b&gt;');
    expect(rawUrl('https://github.com/acme/app/', 'abc', 'docs/a b.png')).toBe(
      'https://github.com/acme/app/raw/abc/docs/a%20b.png',
    );
  });

  it('builds the difference URL from the publish branch unless one was given', () => {
    expect(diffBase('https://github.com/acme/app/', 'vibes-images', 'abc', null)).toBe(
      'https://github.com/acme/app/raw/vibes-images/abc',
    );
    expect(diffBase('https://github.com/acme/app', 'vibes-images', 'abc', 'https://cdn.example/d/')).toBe(
      'https://cdn.example/d',
    );
    expect(diffBase(null, 'vibes-images', 'abc', null)).toBeNull();
  });
});

describe('against a real base ref', () => {
  function repo(): { dir: string; git: (...args: string[]) => string } {
    const dir = mkdtempSync(join(tmpdir(), 'vibes-img-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'vibes@example.com');
    git('config', 'user.name', 'Vibes');
    return { dir, git };
  }

  function commit(dir: string, message: string): string {
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
  }

  function manifest(images: unknown[]): string {
    return JSON.stringify({ v: 1, images });
  }

  it('does not call every picture new when the base ref cannot be read', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'overview.png'), solid(1, 1, 1, 1, 1));
    writeFileSync(join(dir, 'vibes.images.json'), manifest([{ id: 'overview', title: 'Overview', path: 'overview.png' }]));
    commit(dir, 'pictures');
    const loaded = loadPictures(dir, 'refs/does-not-exist');
    expect(loaded.pictures).toEqual([]);
    expect(loaded.problems[0]).toContain('could not list picture manifests');
  });

  it('reads a first picture as added, with current and difference blank', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'README'), 'base\n');
    const base = commit(dir, 'base');
    writeFileSync(join(dir, 'overview.png'), solid(1, 1, 9, 9, 9));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      manifest([{ id: 'overview', title: 'Overview', path: 'overview.png', note: 'the screen' }]),
    );
    commit(dir, 'pictures');
    const loaded = loadPictures(dir, base);
    expect(loaded.problems).toEqual([]);
    expect(loaded.pictures.map((p) => p.status)).toEqual(['added']);
    expect(loaded.pictures[0]?.current).toBeNull();
    expect(loaded.pictures[0]?.diff).toBeNull();
  });

  it('draws the difference once the base has a picture, and follows a rename', () => {
    const { dir } = repo();
    mkdirSync(join(dir, 'old'));
    writeFileSync(join(dir, 'old/shot.png'), solid(1, 1, 255, 255, 255));
    writeFileSync(join(dir, 'vibes.images.json'), manifest([{ id: 'shot', title: 'Shot', path: 'old/shot.png' }]));
    const base = commit(dir, 'base');
    mkdirSync(join(dir, 'new'));
    writeFileSync(join(dir, 'new/shot.png'), solid(1, 1, 0, 0, 0));
    writeFileSync(join(dir, 'vibes.images.json'), manifest([{ id: 'shot', title: 'Shot', path: 'new/shot.png' }]));
    execFileSync('git', ['add', '-A'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'move'], { cwd: dir });
    const loaded = loadPictures(dir, base);
    expect(loaded.pictures[0]?.status).toBe('changed');
    expect(loaded.pictures[0]?.currentPath).toBe('old/shot.png');
    const md = renderPictures(loaded.pictures, { ...view, baseSha: base, headSha: 'HEAD' });
    expect(md).toContain(`/raw/${base}/old/shot.png`);
    expect(md).toContain('/raw/HEAD/new/shot.png');
    const gallery = join(dir, 'out');
    expect(writeGallery(gallery, loaded.pictures, view)).toBe(1);
    expect(readFileSync(join(gallery, 'shot.diff.png')).length).toBeGreaterThan(0);
  });

  it('lists the head manifest first and a removed picture after it', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'a.png'), solid(1, 1, 1, 1, 1));
    writeFileSync(join(dir, 'c.png'), solid(1, 1, 2, 2, 2));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      manifest([
        { id: 'a', title: 'A', path: 'a.png' },
        { id: 'c', title: 'C', path: 'c.png' },
      ]),
    );
    const base = commit(dir, 'base');
    writeFileSync(join(dir, 'b.png'), solid(1, 1, 3, 3, 3));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      manifest([
        { id: 'b', title: 'B', path: 'b.png' },
        { id: 'a', title: 'A', path: 'a.png' },
      ]),
    );
    commit(dir, 'head');
    const loaded = loadPictures(dir, base);
    expect(loaded.pictures.map((p) => `${p.decl.id}:${p.status}`)).toEqual(['b:added', 'a:unchanged', 'c:removed']);
  });

  it('reports a duplicate id and a picture that is not a png, and still shows the good row', () => {
    const { dir } = repo();
    writeFileSync(join(dir, 'now.png'), solid(1, 1, 5, 5, 5));
    writeFileSync(join(dir, 'vibes.images.json'), manifest([{ id: 'bad', title: 'Bad', path: 'now.png' }]));
    const base = commit(dir, 'old picture');
    writeFileSync(join(dir, 'good.png'), solid(1, 1, 4, 4, 4));
    writeFileSync(join(dir, 'now.png'), Buffer.from('not a png'));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      manifest([
        { id: 'good', title: 'Good', path: 'good.png' },
        { id: 'good', title: 'Again', path: 'good.png' },
        { id: 'bad', title: 'Bad', path: 'now.png' },
      ]),
    );
    commit(dir, 'head');
    const loaded = loadPictures(dir, base);
    expect(loaded.problems.some((p) => p.includes('duplicate picture id good'))).toBe(true);
    expect(loaded.problems.some((p) => p.includes('could not be drawn'))).toBe(true);
    expect(loaded.pictures.map((p) => p.decl.id)).toEqual(['good', 'bad']);
    expect(loaded.pictures[1]?.diff).toBeNull();
    const section = renderPictureSection(loaded.pictures, loaded.problems, view);
    expect(section.indexOf('### Good')).toBeLessThan(section.indexOf('### Could not read'));
  });
});

describe('the report command', () => {
  async function run(dir: string, args: string[]): Promise<{ code: number; out: string }> {
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
      const code = await main(args);
      return { code, out };
    } finally {
      process.chdir(previous);
      process.stdout.write = write;
      if (summary === undefined) delete process.env['GITHUB_STEP_SUMMARY'];
      else process.env['GITHUB_STEP_SUMMARY'] = summary;
    }
  }

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
    writeFileSync(join(dir, 'a.png'), solid(1, 1, 3, 3, 3));
    writeFileSync(
      join(dir, 'vibes.images.json'),
      JSON.stringify({ v: 1, images: [{ id: 'a', title: 'Alpha <screen>', path: 'a.png', note: 'welcome' }] }),
    );
    git('add', '-A');
    git('commit', '-q', '-m', 'pic');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    const { code, out } = await run(dir, [
      'report',
      '--base',
      base,
      '--github',
      'https://github.com/acme/app',
      '--head',
      head,
      '--publish-ref',
      'vibes-images',
      '--into',
      head,
      '--diff-dir',
      join(dir, 'gallery'),
    ]);
    expect(code).toBe(0);
    expect(out.indexOf('## Pictures')).toBeLessThan(out.indexOf('No behaviour added'));
    expect(out).toContain('Alpha &lt;screen&gt;');
    expect(out).toContain('note `welcome`');
    expect(out.match(/<img /g)).toHaveLength(1);
    expect(out).toContain(`/raw/${head}/a.png`);
  });

  it('fails the run when a manifest cannot be read, and still prints why', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vibes-cli-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir });
    git('init', '-q');
    git('config', 'user.email', 'vibes@example.com');
    git('config', 'user.name', 'Vibes');
    writeFileSync(join(dir, 'README'), 'base\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim();
    writeFileSync(join(dir, 'vibes.images.json'), '{');
    git('add', '-A');
    git('commit', '-q', '-m', 'bad');
    const { code, out } = await run(dir, ['report', '--base', base, '--diff-dir', join(dir, 'gallery')]);
    expect(code).toBe(3);
    expect(out).toContain('not valid JSON');
  });

  it('documents publish and post', async () => {
    const { code, out } = await run(process.cwd(), ['help']);
    expect(code).toBe(0);
    expect(out).toContain('vibes publish');
    expect(out).toContain('vibes post');
    expect(out).toContain('--publish-ref');
  });
});
