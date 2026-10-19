/**
 * The behaviour ledger: what this repo says it does, derived from its tests.
 *
 * One record per behaviour, emitted by a language binding (see
 * bindings/SCHEMA.md) and joined to pass/fail by the collector. The committed
 * ledger doubles as documentation — it is a readable list of everything the
 * system claims, which a diff then makes reviewable.
 *
 * Nothing here knows any language. Bindings speak the languages; this speaks
 * one schema.
 */

/** Whether the behaviour held on the run that produced this record. */
export type Status = 'pass' | 'fail' | 'skip' | 'did-not-report';

export interface Behaviour {
  readonly v: 2;
  /** Short handle for citing this expectation — BH-42. Assigned on first
   *  collection, carried forever, never reused. NOT the identity. */
  readonly num: number;
  /** The TEST's stable id. Several expectations share it. */
  readonly id: string;
  /** This expectation's stable id, unique within the test. Identity is
   *  `suite/id/expect`, so rewording one expectation is a change to that
   *  expectation and not a reshuffle of its siblings. */
  readonly expect: string;
  readonly suite: string;
  readonly lang: string;
  /** Repo-relative, normalised by the collector from three path conventions. */
  readonly file: string;
  /** The runner's own name for the test. Only used to join status. */
  readonly test: string;
  /** The CONDITION the test sets up. Shared by every expectation of that test. */
  readonly given: string;
  /** One expectation for that condition, and nothing else. It does NOT restate
   *  the condition — the report shows both. */
  readonly then: string;
  /** `path#symbol` the behaviour exercises, so a reader can find the code. */
  readonly covers?: string;
  /** The standing requirement this expectation serves, when the claim does not
   *  already carry it. */
  readonly why?: string;
  readonly status: Status;
}


export function parseLedger(text: string): { ok: Behaviour[]; bad: string[] } {
  const ok: Behaviour[] = [];
  const bad: string[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const b = JSON.parse(line) as Behaviour;
      // v1 had one expectation per test, welded into `then`. It is not read
      // here: silently treating a v1 record as v2 would give every one of its
      // expectations the same identity.
      if (b.v !== 2) {
        bad.push(`schema v${String(b.v)} is not supported (expects v2): ${line.slice(0, 80)}`);
        continue;
      }
      if (typeof b.id !== 'string' || b.id === '') {
        bad.push(`record has no id: ${line.slice(0, 80)}`);
        continue;
      }
      if (typeof b.expect !== 'string' || b.expect === '') {
        bad.push(`record has no expect id: ${line.slice(0, 80)}`);
        continue;
      }
      ok.push(b);
    } catch (e) {
      bad.push(`unparseable line: ${(e as Error).message}`);
    }
  }
  return { ok, bad };
}

/** Bytewise stable, so two runs on the same tree write identical files. */
export function serializeLedger(items: readonly Behaviour[]): string {
  const sorted = [...items].sort((a, b) => {
    if (a.suite !== b.suite) return a.suite < b.suite ? -1 : 1;
    if (a.id !== b.id) return a.id < b.id ? -1 : 1;
    return a.expect < b.expect ? -1 : a.expect > b.expect ? 1 : 0;
  });
  return sorted.map((b) => JSON.stringify(b)).join('\n') + (sorted.length > 0 ? '\n' : '');
}

/**
 * How a behaviour is cited outside the ledger, or '' for a record written
 * before numbering existed.
 *
 * The base side of a diff is whatever was committed then, so a behaviour
 * REMOVED against a pre-numbering ledger has no number to show. Rendering
 * "BH-undefined" beside a real claim would put an obvious defect in front of
 * every reviewer; showing nothing is honest and reads fine.
 */
export function handle(b: Behaviour): string {
  return typeof b.num === 'number' && Number.isFinite(b.num) && b.num > 0 ? `BH-${String(b.num)}` : '';
}

/**
 * Carry every number forward, and give anything new the next one that has
 * never been used.
 *
 * `highWater` is what makes a citation trustworthy. Numbering from the highest
 * number currently in the ledger would hand a deleted behaviour's number to the
 * next new one, and a review comment pointing at BH-42 would quietly start
 * meaning a different claim. So the counter only ever goes up, including past
 * numbers whose behaviours are gone.
 *
 * New behaviours are numbered in `suite/id` order so two runs on the same tree
 * agree on who got which.
 */
export function assignNumbers(
  committed: readonly Behaviour[],
  collected: readonly Behaviour[],
  highWater: number,
): { numbered: Behaviour[]; highWater: number } {
  const known = new Map<string, number>();
  for (const b of committed) if (typeof b.num === 'number') known.set(key(b), b.num);

  let next = Math.max(highWater, ...[...known.values()], 0) + 1;
  const ordered = [...collected].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const numbered = ordered.map((b) => {
    const existing = known.get(key(b));
    if (existing !== undefined) return { ...b, num: existing };
    const n = next;
    next += 1;
    return { ...b, num: n };
  });
  return { numbered, highWater: next - 1 };
}

/** Identity is `suite/id/expect`. Two suites may use the same local test id,
 *  and one test's expectations are told apart by their own ids. */
export function key(b: Behaviour): string {
  return `${b.suite}/${b.id}/${b.expect}`;
}

/** The test a behaviour belongs to, for grouping expectations in a report. */
export function testKey(b: Behaviour): string {
  return `${b.suite}/${b.id}`;
}

/** Numbers held by more than one behaviour, each with every key holding it. */
export function duplicateNumbers(items: readonly Behaviour[]): Map<number, string[]> {
  const holders = new Map<number, string[]>();
  for (const b of items) {
    if (typeof b.num !== 'number' || b.num <= 0) continue;
    const list = holders.get(b.num) ?? [];
    list.push(key(b));
    holders.set(b.num, list);
  }
  for (const [n, keys] of [...holders]) if (keys.length < 2) holders.delete(n);
  return holders;
}

/**
 * The high-water mark in a counter file. Every integer line counts and the
 * largest wins, so a file still holding a merge conflict — `<<<<<<<`, both
 * sides' numbers, `>>>>>>>` — reads as the larger side instead of as zero.
 */
export function parseCounter(text: string): number {
  let best = 0;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!/^\d+$/.test(t)) continue;
    const n = Number.parseInt(t, 10);
    if (n > best) best = n;
  }
  return best;
}

/** Git's conflict markers, which a ledger mid-merge carries between its rows. */
export function isConflictMarker(line: string): boolean {
  return /^(<{7}|={7}|>{7}|\|{7})( |$)/.test(line);
}

export interface Renumbered {
  readonly numbered: Behaviour[];
  readonly highWater: number;
  /** Every number that changed, so the author can fix a citation they wrote. */
  readonly moved: readonly { readonly key: string; readonly from: number; readonly to: number }[];
}

/**
 * Make a branch's numbers safe to merge onto `base`.
 *
 * A number is only permanent once it is on the base branch. Until then a
 * branch's new behaviours hold PROVISIONAL numbers, taken from whatever the
 * counter said when the branch last collected — and two open branches take the
 * same ones. This is the step that settles them, run after merging the base in:
 *
 * - a behaviour the base already has gets the base's number back, always;
 * - a new behaviour keeps its number when that number is past the base's
 *   high-water mark and no other new behaviour holds it;
 * - every other new behaviour moves, in its existing order, past both.
 *
 * Only the colliding rows move, so a citation already written for one that
 * did not collide stays true, and running this twice changes nothing.
 *
 * A number the base itself holds twice is settled too: the holder this branch
 * still has at that number keeps it, else the first in key order, and the rest
 * move. The base cannot say which came first; pass an older `base` that
 * predates the duplicate to settle it by history, and the result then also
 * checks clean against the base that still has the duplicate.
 */
export function renumber(
  base: readonly Behaviour[],
  baseHighWater: number,
  head: readonly Behaviour[],
  headHighWater: number,
): Renumbered {
  const baseNum = new Map<string, number>();
  const claimed = new Set<number>();
  // Where the base holds a number twice, the holder the branch already keeps
  // at that number wins, so a branch that settled the duplicate stays settled.
  const headNum = new Map(head.map((b) => [key(b), b.num]));
  const keepsItsNumber = (b: Behaviour): number => (headNum.get(key(b)) === b.num ? 0 : 1);
  for (const b of [...base].sort((x, y) => keepsItsNumber(x) - keepsItsNumber(y) || byKey(x, y))) {
    if (typeof b.num !== 'number' || b.num <= 0 || claimed.has(b.num)) continue;
    baseNum.set(key(b), b.num);
    claimed.add(b.num);
  }
  const ceiling = Math.max(baseHighWater, ...[...base].map((b) => (typeof b.num === 'number' ? b.num : 0)), 0);

  const kept: Behaviour[] = [];
  const fresh: Behaviour[] = [];
  for (const b of head) {
    const n = baseNum.get(key(b));
    if (n !== undefined) kept.push(b.num === n ? b : { ...b, num: n });
    else fresh.push(b);
  }

  // Existing order, so the rows that do move keep the sequence they were
  // written in; key order breaks ties so two runs agree.
  const ordered = [...fresh].sort((a, b) => {
    const an = typeof a.num === 'number' && a.num > 0 ? a.num : Infinity;
    const bn = typeof b.num === 'number' && b.num > 0 ? b.num : Infinity;
    return an !== bn ? an - bn : byKey(a, b);
  });
  const taken = new Set<number>();
  const stays: Behaviour[] = [];
  const moves: Behaviour[] = [];
  for (const b of ordered) {
    if (typeof b.num === 'number' && Number.isFinite(b.num) && b.num > ceiling && !taken.has(b.num)) {
      taken.add(b.num);
      stays.push(b);
    } else {
      moves.push(b);
    }
  }
  let next = Math.max(ceiling, headHighWater, ...stays.map((b) => b.num));
  const numbered = [...kept, ...stays, ...moves.map((b) => ({ ...b, num: (next += 1) }))];
  const highWater = next;

  const before = new Map(head.map((b) => [key(b), b.num]));
  const moved = numbered
    .filter((b) => before.get(key(b)) !== b.num)
    .map((b) => ({ key: key(b), from: before.get(key(b)) ?? 0, to: b.num }))
    .sort((a, b) => a.to - b.to);
  return { numbered, highWater, moved };
}

/**
 * Keep the committed rows of every suite that declared nothing this run.
 *
 * A suite that cannot start on this machine — a sanitizer that will not
 * initialise, a missing toolchain — declares nothing, and writing the ledger
 * from that run would delete every claim it makes. Its rows are carried as
 * they were committed; the run says nothing new about them.
 */
export function carryForward(
  committed: readonly Behaviour[],
  collected: readonly Behaviour[],
  silentSuites: readonly string[],
): Behaviour[] {
  const silent = new Set(silentSuites);
  return [...collected, ...committed.filter((b) => silent.has(b.suite))];
}

function byKey(a: Behaviour, b: Behaviour): number {
  return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
}
