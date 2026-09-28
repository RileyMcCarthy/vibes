import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { diffFileNames, intoPath, publishFiles } from './publish.js';

function bare(): { origin: string; src: string } {
  const root = mkdtempSync(join(tmpdir(), 'vibes-pub-'));
  const origin = join(root, 'origin.git');
  const src = join(root, 'src');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['clone', '-q', origin, src]);
  execFileSync('git', ['config', 'user.email', 'vibes@example.com'], { cwd: src });
  execFileSync('git', ['config', 'user.name', 'Vibes'], { cwd: src });
  writeFileSync(join(src, 'README'), 'base\n');
  execFileSync('git', ['add', 'README'], { cwd: src });
  execFileSync('git', ['commit', '-q', '-m', 'base'], { cwd: src });
  execFileSync('git', ['push', '-q', 'origin', 'HEAD:main'], { cwd: src });
  return { origin, src };
}

describe('publishing difference pictures', () => {
  it('refuses a path that leaves the branch', () => {
    expect(intoPath('../out')).toBeNull();
    expect(intoPath('/tmp/out')).toBeNull();
    expect(intoPath('abc123')).toBe('abc123');
  });

  it('creates the branch, then adds a later directory without dropping the first', () => {
    const { origin, src } = bare();
    const dir = join(src, 'out');
    mkdirSync(dir);
    writeFileSync(join(dir, 'overview.diff.png'), 'one');
    writeFileSync(join(dir, 'notes.txt'), 'not a difference');
    const first = publishFiles({ root: src, dir, ref: 'vibes-images', into: 'aaa' });
    expect(first).toEqual({ pushed: true, files: ['overview.diff.png'] });

    writeFileSync(join(dir, 'detail.diff.png'), 'two');
    const second = publishFiles({ root: src, dir, ref: 'vibes-images', into: 'bbb' });
    expect(second.pushed).toBe(true);
    expect(second.files).toEqual(['detail.diff.png', 'overview.diff.png']);

    const tree = execFileSync('git', ['ls-tree', '-r', '--name-only', 'vibes-images'], {
      cwd: origin,
      encoding: 'utf8',
    });
    expect(tree.trim().split('\n').sort()).toEqual(['aaa/overview.diff.png', 'bbb/detail.diff.png', 'bbb/overview.diff.png']);
    expect(execFileSync('git', ['show', 'vibes-images:aaa/overview.diff.png'], { cwd: origin, encoding: 'utf8' })).toBe('one');
  });

  it('pushes nothing when the same bytes are published again', () => {
    const { src } = bare();
    const dir = join(src, 'out');
    mkdirSync(dir);
    writeFileSync(join(dir, 'overview.diff.png'), 'same');
    publishFiles({ root: src, dir, ref: 'vibes-images', into: 'aaa' });
    const again = publishFiles({ root: src, dir, ref: 'vibes-images', into: 'aaa' });
    expect(again).toEqual({ pushed: false, files: ['overview.diff.png'] });
  });

  it('publishes nothing when the directory has no difference files', () => {
    const { src } = bare();
    expect(diffFileNames(join(src, 'missing'))).toEqual([]);
    const result = publishFiles({ root: src, dir: src, ref: 'vibes-images', into: 'aaa' });
    expect(result).toEqual({ pushed: false, files: [] });
  });

  it('refuses to publish outside the branch', () => {
    const { src } = bare();
    const dir = join(src, 'out');
    mkdirSync(dir);
    writeFileSync(join(dir, 'overview.diff.png'), 'x');
    expect(() => publishFiles({ root: src, dir, ref: 'vibes-images', into: '../elsewhere' })).toThrow(/refusing/);
  });
});
