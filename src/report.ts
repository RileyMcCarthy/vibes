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
import { groupByCapability, type CapabilityMap } from './capabilities.js';

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
  /** When a repo has declared its capabilities, every section groups under
   *  them, each paragraph is printed once, and the report leads with
   *  capability-level change. Without one, rows group by suite and file. */
  readonly capabilities?: CapabilityMap;
}

/* Where a reader starts when there is a map: which capabilities this change
 * touched, and how. Counts, not sentences — the sentences are below, and a
 * reviewer who owns one capability goes straight to it. */
function byCapabilityTable(caps: CapabilityMap, d: LedgerDiff): string[] {
  const cols = [
    ['stopped holding', d.broken.map((s) => s.after)],
    ['no verdict', d.unreported],
    ['removed', d.removed],
    ['respecified', d.respecified.map((r) => r.after)],
    ['new', d.added],
  ] as const;
  const counts = new Map<string, number[]>();
  cols.forEach(([, items], ci) => {
    for (const g of groupByCapability(caps, items, (b) => b)) {
      const row = counts.get(g.title) ?? new Array<number>(cols.length).fill(0);
      row[ci] = g.items.length;
      counts.set(g.title, row);
    }
  });
  if (counts.size === 0) return [];
  // Keep the file's order, uncharted last: groupByCapability already yields
  // that order per column, and Map insertion order across columns follows it.
  const used = cols.map((_, ci) => [...counts.values()].some((r) => (r[ci] ?? 0) > 0));
  const head = ['capability', ...cols.filter((_, ci) => used[ci]).map(([name]) => name)];
  const lines = [`| ${head.join(' | ')} |`, `|---|${head.slice(1).map(() => '--:').join('|')}|`];
  for (const [title, row] of counts) {
    const cells = row.filter((_, ci) => used[ci]).map((n) => (n === 0 ? '' : String(n)));
    lines.push(`| ${title} | ${cells.join(' | ')} |`);
  }
  return [...lines, ''];
}

export function renderMarkdown(d: LedgerDiff, opts: RenderOptions = {}): string {
  const out: string[] = [`# ${headline(d)}`, '', ...summary(d)];
  const caps = opts.capabilities;
  if (caps !== undefined) out.push(...byCapabilityTable(caps, d));

  /* A capability's paragraph is printed the first time it appears in reading
   * order (broken → no verdict → removed → respecified → new), and the heading
   * alone after that. Three copies of one paragraph in one report would bury
   * the rows it was meant to introduce. */
  const told = new Set<string>();
  const section = <T>(items: readonly T[], of: (t: T) => Behaviour, render: (group: readonly T[]) => string[]): void => {
    if (caps === undefined) {
      out.push(...render(items));
      return;
    }
    for (const g of groupByCapability(caps, items, of)) {
      out.push(`### ${g.title}`, '');
      if (!told.has(g.key)) {
        told.add(g.key);
        out.push(g.statement, '');
      }
      out.push(...render(g.items), '');
    }
  };

  // Everything that needs a decision comes first and stays open. Only the new
  // behaviour, which is usually the bulk and is read by browsing, is folded.
  if (d.broken.length > 0) {
    out.push('## Stopped holding', '');
    out.push(
      'These behaviours passed before this change and do not now. The claim did not change; the code did.',
      '',
    );
    section(d.broken, (s) => s.after, (items) =>
      items.map((s) => `- **When** ${s.after.given}\n  - ${s.after.then} \`${handle(s.after)}\`\n  <sub>was ${s.before}, now ${s.after.status} · \`${s.after.file}\`</sub>`),
    );
    out.push('');
  }

  if (d.unreported.length > 0) {
    out.push('## No verdict — the suite did not report', '');
    out.push(
      'These were in the ledger, and this run learned NOTHING about them: their whole suite declared no behaviours, usually a build or startup failure. This is not removal and it is not a pass.',
      '',
    );
    section(d.unreported, (b) => b, (items) =>
      items.map((b) => `- **When** ${b.given}\n  - ${b.then} \`${handle(b)}\`\n  <sub>suite \`${b.suite}\` · \`${b.file}\`</sub>`),
    );
    out.push('');
  }

  if (d.removed.length > 0) {
    out.push('## No longer claimed', '');
    out.push('Nothing in the repo asserts these any more.', '');
    section(d.removed, (b) => b, (items) =>
      items.map((b) => `- **When** ${b.given}\n  - ${b.then} \`${handle(b)}\`\n  <sub>was in \`${b.file}\`</sub>`),
    );
    out.push('');
  }

  if (d.respecified.length > 0) {
    out.push('## Respecified', '');
    out.push(
      'Same expectation, different words. Each row is the claim as it now reads; what it replaced is beneath it in small type. A rewording that keeps the meaning is the usual case — a row that changes what the machine is claimed to do is the one to stop on.',
      '',
    );
    section(d.respecified, (r) => r.after, (items) => respecByTest(items).map((g) => respec(g)));
    out.push('');
  }

  if (d.added.length > 0) {
    const max = opts.maxNew ?? Number.POSITIVE_INFINITY;
    out.push(`## New behaviour (${d.added.length})`, '');
    let listed = 0;
    let skipped = 0;

    /* Folded per group — a suite without a map, a capability with one — so a
     * reviewer opens the one they own instead of scrolling past every other. */
    const fold = (title: string, items: readonly Behaviour[], intro: readonly string[], withFileHeadings: boolean): void => {
      const tests = byTest(items);
      out.push(`<details><summary><b>${title}</b> — ${String(items.length)} expectation${items.length === 1 ? '' : 's'} across ${String(tests.length)} test${tests.length === 1 ? '' : 's'}</summary>`, '');
      out.push(...intro);
      let lastFile = '';
      for (const g of tests) {
        const first = g[0];
        if (first === undefined) continue;
        if (listed + g.length > max) {
          skipped += g.length;
          continue;
        }
        if (withFileHeadings && first.file !== lastFile) {
          out.push(`**${first.file}**`, '');
          lastFile = first.file;
        }
        out.push(oneTest(g, !withFileHeadings));
        listed += g.length;
      }
      out.push('', '</details>', '');
    };

    if (caps === undefined) {
      const bySuite = new Map<string, Behaviour[]>();
      for (const b of d.added) {
        const list = bySuite.get(b.suite) ?? [];
        list.push(b);
        bySuite.set(b.suite, list);
      }
      for (const [suite, items] of bySuite) fold(suite, items, [], true);
    } else {
      for (const g of groupByCapability(caps, d.added, (b) => b)) {
        const intro = told.has(g.key) ? [] : [g.statement, ''];
        told.add(g.key);
        fold(g.title, g.items, intro, false);
      }
    }
    if (skipped > 0) {
      out.push(`_${String(skipped)} further expectation${skipped === 1 ? '' : 's'} are not listed here — the job summary carries the whole report._`, '');
    }
  }

  out.push('---', '');
  out.push(`_${d.unchanged} behaviour${d.unchanged === 1 ? '' : 's'} unchanged and holding._`);
  return out.join('\n') + '\n';
}
