/**
 * The decidable half of CLAIMS.md.
 *
 * Every rule in `bindings/CLAIMS.md` was paid for by a claim that said nothing,
 * and every one of them was checked by a human reading two strings in isolation
 * — which is how "a byte left on the link by an abandoned exchange, then a
 * start" reached a ledger: each field looks defensible on its own, and the
 * sentence they compose has no main clause.
 *
 * Grammar is not lintable and this does not pretend otherwise; `vibes preview`
 * exists for that half, because the only reliable check is reading the rendered
 * line. What IS decidable is vocabulary and shape: words the report's reader
 * cannot know, words a specification must not contain, a `then` that repeats
 * the scene it was handed, an ordinal id. Those are here, and they are cheap
 * enough to run on every claim in the repo.
 *
 * Findings are advice with a severity, not a schema violation: a ledger that
 * fails lint is still a valid ledger. Nothing downstream reads this module.
 */

import type { Behaviour } from './ledger.js';
import { areaOf, capabilityFor, CAPABILITIES_FILE, type CapabilityMap } from './capabilities.js';

export type Severity = 'error' | 'warn';

export type Field = 'given' | 'then' | 'why' | 'expect';

export interface Finding {
  /** Stable rule name, so a repo can grep its own exceptions. */
  readonly rule: string;
  readonly severity: Severity;
  readonly field: Field;
  /** What is wrong, and what to write instead. Read by whoever wrote the claim. */
  readonly message: string;
}

/** The claim as the author wrote it. A ledger record is a superset. */
export interface Claim {
  readonly given: string;
  readonly then: string;
  readonly why?: string;
  readonly expect?: string;
  /** The test's file, so an allowance can be scoped to where the word is real. */
  readonly file?: string;
}

/**
 * A word this repo genuinely uses, which the default vocabulary would flag.
 *
 * `in` is what makes an allowance honest. "Stub" is the Parallax name for the
 * flash-boot block the loader prepends AND the name of a test double; "flush"
 * is a button in a diagnostics page AND machinery inside a driver. Allowing
 * either everywhere would switch the rule off for the file that needed it.
 */
export type Allowance = string | { readonly words: readonly string[]; readonly in?: string };

export interface LintOptions {
  readonly allow?: readonly Allowance[];
  /** Once a repo declares capabilities, every area must have one. An area
   *  left out would render as uncharted — visible, but the map is the spec's
   *  table of contents and a hole in it is a hole in the spec. */
  readonly capabilities?: CapabilityMap;
}

interface AllowEntry {
  readonly word: string;
  readonly in?: string;
}

function allowEntries(allow: readonly Allowance[] | undefined): AllowEntry[] {
  const out: AllowEntry[] = [];
  for (const a of allow ?? []) {
    if (typeof a === 'string') {
      out.push({ word: a.toLowerCase() });
      continue;
    }
    for (const w of a.words) out.push(a.in === undefined ? { word: w.toLowerCase() } : { word: w.toLowerCase(), in: a.in });
  }
  return out;
}

/* ---- vocabulary ------------------------------------------------------- */

/* The report prints "**When** <given>" and nests the expectations under it.
 * A `given` that supplies its own frame word renders as "When when ...", and a
 * `then` that starts with "then" reads as a second condition. */
const GIVEN_FRAME = /^\s*(when|whenever|given|if|suppose|assuming)\b/i;
const THEN_FRAME = /^\s*(then|and then|so that|it should|should)\b/i;

/* A claim that could caption any test. If a wrong implementation can satisfy
 * the sentence, the sentence is not a specification. */
const VAGUE = /\b(correctly|properly|appropriately|as expected|as intended|successfully|works fine|behaves)\b/i;

/* A spec says what the machine does — never what it does not do, used to do,
 * or once did wrong. CLAIMS.md governs `why` with the same rule.
 *
 * Two of these need a guard to stay honest. "is used to clear the log" is the
 * passive of "use", not the past habitual, so the copula is excluded. And a
 * product that files bug REPORTS from a bug TEMPLATE says "bug" all day without
 * ever narrating a defect — those compounds are excluded, and the bare noun
 * ("that difference is usually the bug") still lands. */
const CONTRAST =
  /\bnot as\b|,\s*not\b|\brather than\b|\binstead of\b|\bno longer\b|(?<!\b(?:is|are|was|were|be|being|been)\s)\bused to\b|\bpreviously\b|\bas before\b|\bregression\b|\bdefect\b|\bbug\b(?!\s*(?:report|reports|template|templates|hunt|tracker))|\bworkaround\b/i;

/* Names from the code, in a report whose reader has never opened it. Three
 * shapes carry almost all of them: snake_case and MACRO_CASE identifiers, a
 * call with parentheses, and a path or member reference. Bare camelCase is
 * deliberately absent — "GitHub" and "KiB" are camel-humped English. */
const IDENTIFIER = /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b|\b\w+\(\)|\b[A-Za-z][A-Za-z0-9]*::[A-Za-z]|->/;

/* Machinery the operator never sees. The claim is what the machine DOES; how it
 * gets there is a `why` at most. Repos override with `allow`. */
const INTERNALS = [
  'buffer', 'buffered', 'buffers', 'fifo', 'struct', 'enum', 'mutex', 'semaphore',
  'callback', 'pointer', 'malloc', 'mock', 'stub', 'flush', 'flushed', 'flushes',
  'drain', 'drained', 'drains', 'caller', 'read-back', 'readback', 'null',
  'boolean', 'substring', 'parameter',
];

/* A past participle that is also a finite past tense. "a byte left on the
 * link" starts as a sentence about a byte that left, and the main clause the
 * reader is holding out for never arrives. The -ing form or an explicit
 * relative clause both read on the first pass.
 *
 * The trailing preposition is what keeps this from firing on every noun-noun
 * compound in the ledger: "a test run", "a direct read", "a saved set" are all
 * ordinary, and requiring "left ON", "run BY", "read IN" takes seventeen hits
 * down to three. It is a warning because English is not decidable — a claim
 * that reads fine is allowed to say so. */
const GARDEN_PATH = new RegExp(
  String.raw`\b(?:a|an|the)\s+[a-z]+\s+(left|read|set|put|cut|held|sent|run|hit|shut|split|spread|lost|found|kept|made|told|sold|paid|met|built|brought|cost|let|bid|burst)\s+(?:on|in|by|from|at|into|onto|over|across|through)\b`,
  'i',
);

/** An id that says where the expectation sits rather than what it claims. */
const ORDINAL_ID = /^(one|two|three|four|first|second|third|fourth|last|assert\d*|case\d*|check\d*|expect\d*|test\d*|\d+)$/i;

const THEN_MAX_WORDS = 26;
const GIVEN_MAX_WORDS = 34;
/** Shortest run of words shared with `given` that reads as a restatement.
 *  Four catches thirteen claims in a thousand and is wrong about most of them —
 *  a round trip legitimately repeats the fields it round-trips. Six catches the
 *  one that was actually the scene coming back. */
const RESTATE_RUN = 6;

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w !== '');
}

/**
 * The longest run of words `then` repeats from `given`.
 *
 * Rule: `then` is the expectation and nothing else — the report already printed
 * the scene directly above it. A short overlap is ordinary English ("the
 * machine"); six words in a row is the scene coming back.
 */
export function longestSharedRun(given: string, then: string): number {
  const a = words(given);
  const b = words(then);
  let best = 0;
  for (let i = 0; i < b.length; i++) {
    for (let j = 0; j < a.length; j++) {
      let n = 0;
      while (i + n < b.length && j + n < a.length && b[i + n] === a[j + n]) n++;
      if (n > best) best = n;
    }
  }
  return best;
}

/** Every finding for one claim, in the order a writer should act on them. */
export function lintClaim(c: Claim, opts: LintOptions = {}): Finding[] {
  const out: Finding[] = [];
  const entries = allowEntries(opts.allow);
  const file = c.file ?? '';
  const allowed = (match: string): boolean =>
    entries.some((e) => e.word === match.trim().toLowerCase() && (e.in === undefined || file.includes(e.in)));
  const hit = (text: string, list: readonly string[]): string | undefined =>
    words(text).find((w) => list.includes(w) && !allowed(w));
  const add = (rule: string, severity: Severity, field: Field, message: string): void => {
    out.push({ rule, severity, field, message });
  };

  if (GIVEN_FRAME.test(c.given)) {
    add('frame', 'error', 'given', 'the report already prints "When" — start with the situation itself');
  }
  if (THEN_FRAME.test(c.then)) {
    add('frame', 'error', 'then', 'the expectation is printed under its condition — start with what the machine does');
  }

  for (const [field, text] of [['given', c.given], ['then', c.then], ['why', c.why]] as const) {
    if (text === undefined || text === '') continue;

    const id = IDENTIFIER.exec(text);
    if (id !== null && !allowed(id[0])) {
      add('identifier', 'error', field, `"${id[0]}" is a name from the code — say what the thing is to the machine or its operator`);
    }

    const contrast = CONTRAST.exec(text);
    if (contrast !== null && !allowed(contrast[0])) {
      add('contrast', 'error', field, `"${contrast[0]}" — a spec says what the machine does, not what it does not do or used to do`);
    }

    const internal = hit(text, INTERNALS);
    if (internal !== undefined) {
      add('internals', 'warn', field, `"${internal}" is machinery the reader never sees — claim the outcome, and put the mechanism in "why"`);
    }
  }

  const vague = VAGUE.exec(c.then);
  if (vague !== null && !allowed(vague[0])) {
    add('vague', 'error', 'then', `"${vague[0]}" would caption any test — name what makes it right`);
  }

  const garden = GARDEN_PATH.exec(c.given);
  if (garden !== null) {
    add('garden-path', 'warn', 'given', `"${garden[0]}" reads as a verb on the first pass — name the thing ("a leftover byte") or spell the clause out ("a byte that an abandoned exchange ${garden[1] ?? 'left'}")`);
  }

  const run = longestSharedRun(c.given, c.then);
  if (run >= RESTATE_RUN) {
    add('restates', 'warn', 'then', `${String(run)} words in a row come from the condition, which the report prints directly above`);
  }

  if (words(c.then).length > THEN_MAX_WORDS) {
    add('length', 'warn', 'then', `${String(words(c.then).length)} words — a claim this long is usually two`);
  }
  if (words(c.given).length > GIVEN_MAX_WORDS) {
    add('length', 'warn', 'given', `${String(words(c.given).length)} words — a scene this long is usually two tests`);
  }

  if (c.expect !== undefined && ORDINAL_ID.test(c.expect)) {
    add('ordinal-id', 'error', 'expect', `"${c.expect}" names the order, not the expectation — ids are identity and outlive the order`);
  }

  return out;
}

export interface LedgerFinding extends Finding {
  /** `suite/id/expect`, the identity a reader can grep for. */
  readonly key: string;
  readonly file: string;
  readonly num: number;
}

/**
 * Lint a whole ledger.
 *
 * `given` belongs to the test, not the expectation, so a scene-level finding
 * would otherwise repeat once per expectation — reported against the first of
 * them only, which is where a writer will go to fix it.
 */
export function lintLedger(items: readonly Behaviour[], opts: LintOptions = {}): LedgerFinding[] {
  const out: LedgerFinding[] = [];
  const seenTest = new Set<string>();
  const seenArea = new Set<string>();
  for (const b of items) {
    const testKey = `${b.suite}/${b.id}`;
    const first = !seenTest.has(testKey);
    seenTest.add(testKey);
    if (opts.capabilities !== undefined) {
      const area = `${b.suite}/${areaOf(b)}`;
      if (!seenArea.has(area) && capabilityFor(opts.capabilities, b) === undefined) {
        seenArea.add(area);
        out.push({
          rule: 'uncharted',
          severity: 'error',
          field: 'given',
          message: `no capability declares \`${area}\` — add a heading for it to ${CAPABILITIES_FILE} saying what it is for`,
          key: `${b.suite}/${b.id}/${b.expect}`,
          file: b.file,
          num: b.num,
        });
      }
    }
    const claim: Claim = {
      given: b.given,
      then: b.then,
      expect: b.expect,
      file: b.file,
      ...(b.why === undefined ? {} : { why: b.why }),
    };
    for (const f of lintClaim(claim, opts)) {
      if (f.field === 'given' && !first) continue;
      out.push({ ...f, key: `${b.suite}/${b.id}/${b.expect}`, file: b.file, num: b.num });
    }
  }
  return out;
}

export function countBySeverity(findings: readonly Finding[]): { errors: number; warnings: number } {
  return {
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warn').length,
  };
}
