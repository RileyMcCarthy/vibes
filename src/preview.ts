/**
 * Show a claim the way its reader will meet it.
 *
 * The report prints `**When** <given>` with the expectations nested under it,
 * so `given` and `then` are halves of one sentence that nobody ever sees whole:
 * they are written into separate arguments of a macro, reviewed as separate
 * strings, and composed only on a pull request, by which point the writer has
 * moved on. Everything the rules cannot catch lives in that gap — a scene that
 * is a thing rather than a situation, a second beat with no verb, a `then` that
 * finishes a sentence the `given` never started.
 *
 * Collecting the ledger runs every suite, which is far too slow to use while
 * writing. This renders from the committed ledger, or from the claim in your
 * editor, and runs the lint over the same text. No suite runs.
 */

import type { Behaviour } from './ledger.js';
import { testKey } from './ledger.js';
import { oneTest } from './report.js';
import { lintClaim, type Finding, type LedgerFinding, type LintOptions } from './lint.js';
import { groupByCapability, type CapabilityMap } from './capabilities.js';

export interface PreviewFilter {
  /** Substring of the test id — the usual way in. */
  readonly id?: string;
  readonly suite?: string;
  /** Substring of the test file's path. */
  readonly file?: string;
}

/** A claim being written, before any suite has run and given it an identity. */
export interface InlineClaim {
  readonly given: string;
  readonly expectations: readonly { readonly then: string; readonly why?: string }[];
  readonly covers?: string;
}

function matches(b: Behaviour, f: PreviewFilter): boolean {
  if (f.id !== undefined && !b.id.includes(f.id)) return false;
  if (f.suite !== undefined && b.suite !== f.suite) return false;
  if (f.file !== undefined && !b.file.includes(f.file)) return false;
  return true;
}

function byTest(items: readonly Behaviour[]): Behaviour[][] {
  const groups = new Map<string, Behaviour[]>();
  for (const b of items) {
    const g = groups.get(testKey(b)) ?? [];
    g.push(b);
    groups.set(testKey(b), g);
  }
  return [...groups.values()];
}

/**
 * Ledger rows, grouped by test and rendered as the report renders them.
 *
 * With a capability map this is the whole specification as a document: each
 * capability's paragraph, then the claims that hold it up. Without one it is
 * the rows in ledger order.
 */
export function previewLedger(items: readonly Behaviour[], filter: PreviewFilter = {}, caps?: CapabilityMap): string {
  const kept = items.filter((b) => matches(b, filter));
  if (caps === undefined) return byTest(kept).map((g) => oneTest(g)).join('\n\n');
  return groupByCapability(caps, kept, (b) => b)
    .map((g) => [`### ${g.title}`, '', g.statement, '', ...byTest(g.items).map((t) => oneTest(t))].join('\n'))
    .join('\n\n');
}

/** A claim that exists only in the editor, rendered as it will land. */
export function previewInline(c: InlineClaim): string {
  const group: Behaviour[] = c.expectations.map((e, i) => ({
    v: 2,
    num: 0,
    id: 'preview',
    expect: `e${String(i)}`,
    suite: '',
    lang: '',
    file: '',
    test: '',
    given: c.given,
    then: e.then,
    ...(e.why === undefined ? {} : { why: e.why }),
    ...(c.covers === undefined ? {} : { covers: c.covers }),
    status: 'pass' as const,
  }));
  return oneTest(group);
}

/** The scene belongs to the test, so its findings are reported once — not once
 *  per expectation that happens to hang off it. */
export function lintInline(c: InlineClaim, opts: LintOptions = {}): Finding[] {
  return c.expectations.flatMap((e, i) =>
    lintClaim({ given: c.given, then: e.then, ...(e.why === undefined ? {} : { why: e.why }) }, opts).filter(
      (f) => f.field !== 'given' || i === 0,
    ),
  );
}

/** One finding per line, worst first, in the shape editors jump from. */
export function formatFindings(findings: readonly (Finding | LedgerFinding)[]): string {
  const order = (f: Finding): number => (f.severity === 'error' ? 0 : 1);
  return [...findings]
    .sort((a, b) => order(a) - order(b))
    .map((f) => {
      const where = 'key' in f ? `${f.file === '' ? '(uncollected)' : f.file} · ${f.key}` : '';
      const cite = 'num' in f && f.num > 0 ? ` BH-${String(f.num)}` : '';
      const head = `${f.severity === 'error' ? 'error' : 'warn '} ${f.rule} [${f.field}]`;
      return where === '' ? `${head}: ${f.message}` : `${head} ${where}${cite}\n        ${f.message}`;
    })
    .join('\n');
}
