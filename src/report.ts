/**
 * Render a ledger diff for a human.
 *
 * Ordered by what a reviewer must act on, not by what the tool finds
 * interesting: broken first, then removed, then respecified, then added. The
 * headline is a sentence naming the worst thing present — a badge or a count
 * reads as "green" to someone skimming, which is how a report stops being read.
 */

import { handle, key, testKey, type Behaviour } from './ledger.js';
import type { LedgerDiff, Respecified } from './diff.js';

export function headline(d: LedgerDiff): string {
  if (d.unreported.length > 0) {
    const n = d.unreported.length;
    return `${n} behaviour${n === 1 ? '' : 's'} without a verdict — a suite failed to report.`;
  }
  if (d.broken.length > 0) {
    const n = d.broken.length;
    return `${n} behaviour${n === 1 ? '' : 's'} stopped holding.`;
  }
  if (d.removed.length > 0) {
    const n = d.removed.length;
    return `${n} behaviour${n === 1 ? '' : 's'} removed — the repo no longer claims ${n === 1 ? 'it' : 'them'}.`;
  }
  if (d.notHolding.length > 0) {
    const n = d.notHolding.length;
    return `${n} behaviour${n === 1 ? '' : 's'} not holding.`;
  }
  if (d.respecified.length > 0 && d.added.length > 0) {
    return `${d.added.length} new, ${d.respecified.length} respecified.`;
  }
  if (d.added.length > 0) {
    return `${d.added.length} new behaviour${d.added.length === 1 ? '' : 's'}.`;
  }
  if (d.respecified.length > 0) {
    return `${d.respecified.length} behaviour${d.respecified.length === 1 ? '' : 's'} respecified.`;
  }
  return 'No behaviour added, removed or respecified.';
}

/* Markdown soft-wraps a plain newline inside a list item, so every line of a
 * row has to end in two spaces or the claim, its scene and its reason render as
 * one run-on paragraph — which reads as though two separate specs collided. */
const BR = '  \n';

/**
 * One test: its condition once, then every expectation that hangs off it.
 *
 * Grouping is the point of the shape. Printing the condition again beside each
 * expectation would put back exactly the repetition that splitting them removed.
 */
/** Lines a caller wants under a row's parts: after the scene, after each
 *  expectation's sentence, after its reason. A respecified row uses these to
 *  put what a line replaced directly beneath it. */
export interface RowNotes {
  readonly scene?: readonly string[];
  readonly expectation?: (b: Behaviour) => { readonly afterThen?: readonly string[]; readonly afterWhy?: readonly string[] };
}

export function oneTest(group: readonly Behaviour[], withFile = true, notes: RowNotes = {}): string {
  const first = group[0];
  if (first === undefined) return '';

  // The condition leads, marked, and each expectation is its own nested bullet.
  // Running them together as sibling lines left no way to see where one
  // expectation ended and the next began, or which half was the condition.
  const lines = [`- **When** ${first.given}`, ...(notes.scene ?? [])];
  for (const b of group) {
    const h = handle(b);
    const n = notes.expectation?.(b) ?? {};
    lines.push(`  - ${b.then}${h === '' ? '' : ` \`${h}\``}`, ...(n.afterThen ?? []));
    if (b.why !== undefined) lines.push(`    <sub>${b.why}</sub>`);
    lines.push(...(n.afterWhy ?? []));
  }

  // Where the reader is, once, in small type: the test this came from and the
  // code it covers. Under a file heading the path is already on screen.
  // A preview of a claim that has not been collected yet has no file and no
  // test name; rendering those as empty backticks would put a defect-looking
  // artefact in front of the writer we are asking to read this line.
  const echoes = first.test.includes(first.given) || group.some((b) => first.test.includes(b.then));
  const where: string[] = [];
  if (withFile && first.file !== '') where.push(`\`${first.file}\``);
  if (!echoes && first.test !== '') where.push(`\`${first.test}\``);
  if (first.covers !== undefined && first.covers !== '') where.push(`\`${first.covers}\``);
  if (where.length > 0) lines.push(`  <sub>${where.join(' · ')}</sub>`);
  return lines.join('\n');
}


/** Expectations, in ledger order, grouped by the test they belong to. */
function byTest(items: readonly Behaviour[]): Behaviour[][] {
  const groups = new Map<string, Behaviour[]>();
  for (const b of items) {
    const g = groups.get(testKey(b)) ?? [];
    g.push(b);
    groups.set(testKey(b), g);
  }
  return [...groups.values()];
}


/*
 * A respecified claim is still a claim, and a reader judges it the way they
 * judge a new one: scene first, then the expectation. So the row is the claim
 * AS IT NOW READS, in the shape used everywhere else in the report, and each
 * sentence it replaced sits in small type directly under the one that replaced
 * it. Grouped by test, like everything else, so two expectations reworded
 * under one scene do not print the scene twice.
 *
 * The earlier shape listed was/now per field — the expectation first, in bold,
 * the scene after it, if at all. That made the reader assemble the sentence
 * from parts, and for a rewording that kept the meaning (the usual case) it
 * gave them no way to see that nothing had moved.
 */
function respec(group: readonly Respecified[]): string {
  const first = group[0];
  if (first === undefined) return '';
  const byKey = new Map(group.map((r) => [key(r.after), r]));
  const sceneMoved = group.find((r) => r.fields.includes('given'));
  return oneTest(
    group.map((r) => r.after),
    true,
    {
      scene: sceneMoved === undefined ? [] : [`  <sub>was: ${sceneMoved.before.given}</sub>`],
      expectation: (b) => {
        const r = byKey.get(key(b));
        if (r === undefined) return {};
        const afterThen = r.fields.includes('then') ? [`    <sub>was: ${r.before.then}</sub>`] : [];
        const afterWhy: string[] = [];
        if (r.fields.includes('why') && r.before.why !== undefined) afterWhy.push(`    <sub>was, because: ${r.before.why}</sub>`);
        if (r.fields.includes('covers') && r.before.covers !== undefined) afterWhy.push(`    <sub>covered \`${r.before.covers}\`</sub>`);
        return { afterThen, afterWhy };
      },
    },
  );
}

/** Respecifications, grouped by the test they belong to, in ledger order. */
function respecByTest(items: readonly Respecified[]): Respecified[][] {
  const groups = new Map<string, Respecified[]>();
  for (const r of items) {
    const g = groups.get(testKey(r.after)) ?? [];
    g.push(r);
    groups.set(testKey(r.after), g);
  }
  return [...groups.values()];
}

/** What changed, before any of it is read in detail. */
function summary(d: LedgerDiff): string[] {
  const rows: [string, number][] = [
    ['stopped holding', d.broken.length],
    ['without a verdict', d.unreported.length],
    ['no longer claimed', d.removed.length],
    ['respecified', d.respecified.length],
    ['new', d.added.length],
    ['unchanged and holding', d.unchanged],
  ];
  const shown = rows.filter(([, n]) => n > 0);
  if (shown.length === 0) return [];
  return ['| | |', '|---|--:|', ...shown.map(([k, n]) => `| ${k} | ${String(n)} |`), ''];
}

export interface RenderOptions {
  /** Cap on expectations listed under "New behaviour". What is left out is
   *  said so in the report rather than cut off by whatever posts it — a report
   *  that stops mid-sentence reads as though the tool broke. */
  readonly maxNew?: number;
}

export function renderMarkdown(d: LedgerDiff, opts: RenderOptions = {}): string {
  const out: string[] = [`# ${headline(d)}`, '', ...summary(d)];

  // Everything that needs a decision comes first and stays open. Only the new
  // behaviour, which is usually the bulk and is read by browsing, is folded.
  if (d.broken.length > 0) {
    out.push('## Stopped holding', '');
    out.push(
      'These behaviours passed before this change and do not now. The claim did not change; the code did.',
      '',
    );
    for (const s of d.broken) out.push(`- **When** ${s.after.given}\n  - ${s.after.then} \`${handle(s.after)}\`\n  <sub>was ${s.before}, now ${s.after.status} · \`${s.after.file}\`</sub>`);
    out.push('');
  }

  if (d.unreported.length > 0) {
    out.push('## No verdict — the suite did not report', '');
    out.push(
      'These were in the ledger, and this run learned NOTHING about them: their whole suite declared no behaviours, usually a build or startup failure. This is not removal and it is not a pass.',
      '',
    );
    for (const b of d.unreported) out.push(`- **When** ${b.given}\n  - ${b.then} \`${handle(b)}\`\n  <sub>suite \`${b.suite}\` · \`${b.file}\`</sub>`);
    out.push('');
  }

  if (d.removed.length > 0) {
    out.push('## No longer claimed', '');
    out.push('Nothing in the repo asserts these any more.', '');
    for (const b of d.removed) out.push(`- **When** ${b.given}\n  - ${b.then} \`${handle(b)}\`\n  <sub>was in \`${b.file}\`</sub>`);
    out.push('');
  }

  if (d.respecified.length > 0) {
    out.push('## Respecified', '');
    out.push(
      'Same expectation, different words. Each row is the claim as it now reads; what it replaced is beneath it in small type. A rewording that keeps the meaning is the usual case — a row that changes what the machine is claimed to do is the one to stop on.',
      '',
    );
    for (const g of respecByTest(d.respecified)) out.push(respec(g));
    out.push('');
  }

  if (d.added.length > 0) {
    const max = opts.maxNew ?? Number.POSITIVE_INFINITY;
    out.push(`## New behaviour (${d.added.length})`, '');

    const bySuite = new Map<string, Behaviour[]>();
    for (const b of d.added) {
      const list = bySuite.get(b.suite) ?? [];
      list.push(b);
      bySuite.set(b.suite, list);
    }

    let listed = 0;
    let skipped = 0;
    for (const [suite, items] of bySuite) {
      const tests = byTest(items);
      // Folded per suite: a reviewer opens the one they own instead of
      // scrolling past every other.
      out.push(`<details><summary><b>${suite}</b> — ${String(items.length)} expectation${items.length === 1 ? '' : 's'} across ${String(tests.length)} test${tests.length === 1 ? '' : 's'}</summary>`, '');
      let lastFile = '';
      for (const g of tests) {
        const first = g[0];
        if (first === undefined) continue;
        if (listed + g.length > max) {
          skipped += g.length;
          continue;
        }
        if (first.file !== lastFile) {
          out.push(`**${first.file}**`, '');
          lastFile = first.file;
        }
        out.push(oneTest(g, false));
        listed += g.length;
      }
      out.push('', '</details>', '');
    }
    if (skipped > 0) {
      out.push(`_${String(skipped)} further expectation${skipped === 1 ? '' : 's'} are not listed here — the job summary carries the whole report._`, '');
    }
  }

  out.push('---', '');
  out.push(`_${d.unchanged} behaviour${d.unchanged === 1 ? '' : 's'} unchanged and holding._`);
  return out.join('\n') + '\n';
}
