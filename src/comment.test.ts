import { describe, expect, it } from 'vitest';
import { COMMENT_LIMIT, MARKER, commentBody, postComment, type Gh } from './comment.js';

describe('the sticky comment', () => {
  it('starts with the marker and keeps a short report whole', () => {
    const body = commentBody('# Hello\n');
    expect(body.startsWith(`${MARKER}\n# Hello\n`)).toBe(true);
    expect(body).not.toContain('Truncated');
  });

  it('cuts a report that would not fit, on a character boundary', () => {
    const text = `${'a'.repeat(COMMENT_LIMIT - 1)}é`;
    // é is two bytes, so the cut lands inside it and must step back.
    expect(Buffer.from(text).length).toBeGreaterThan(COMMENT_LIMIT);
    const body = commentBody(text, COMMENT_LIMIT);
    expect(body.startsWith(MARKER)).toBe(true);
    expect(body).toContain('Truncated');
    expect(body).not.toContain('é');
    expect(body.includes('\uFFFD')).toBe(false);
  });

  it('creates a comment when none carries the marker', () => {
    const calls: string[][] = [];
    const gh: Gh = (args) => {
      calls.push([...args]);
      if (args.includes('--paginate')) return '\n';
      return '42\n';
    };
    const result = postComment({ repo: 'acme/app', pr: '7', markdown: '# Report\n', gh });
    expect(result).toEqual({ action: 'created', id: '42' });
    const create = calls[1];
    expect(create?.[0]).toBe('api');
    expect(create).toContain('repos/acme/app/issues/7/comments');
    expect(create?.some((arg) => arg.startsWith('body=') && arg.includes(MARKER))).toBe(true);
    expect(create).not.toContain('-X');
  });

  it('updates the comment that already starts with the marker', () => {
    const calls: string[][] = [];
    const gh: Gh = (args) => {
      calls.push([...args]);
      if (args.includes('--paginate')) return '9\n15\n';
      return '';
    };
    const result = postComment({ repo: 'acme/app', pr: '7', markdown: '# Report\n', gh });
    expect(result).toEqual({ action: 'updated', id: '9' });
    expect(calls[1]).toContain('-X');
    expect(calls[1]).toContain('PATCH');
    expect(calls[1]).toContain('repos/acme/app/issues/comments/9');
  });
});
