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
      const b = JSON.parse(line) as Behaviour & { num?: unknown };
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
      // Ledgers written before numbering was dropped carry a `num` on every
      // row. Dropping it here is what makes the migration one `collect
      // --write`: a suite that is silent this run has its rows carried
      // forward as parsed, and would otherwise write the number back.
      delete b.num;
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

/** Identity is `suite/id/expect`. Two suites may use the same local test id,
 *  and one test's expectations are told apart by their own ids. */
export function key(b: Behaviour): string {
  return `${b.suite}/${b.id}/${b.expect}`;
}

/** The test a behaviour belongs to, for grouping expectations in a report. */
export function testKey(b: Behaviour): string {
  return `${b.suite}/${b.id}`;
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
