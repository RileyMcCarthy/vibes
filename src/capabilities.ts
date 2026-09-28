/**
 * The layer above a claim: what the capability is FOR.
 *
 * A ledger row is a unit test described politely — "the records land in the
 * file" — and a thousand of them, grouped by file path, read as a thousand
 * mechanisms. The reader this report exists for never learns what feature a
 * row belongs to, what that feature is for, or what an operator would lose if
 * it broke. No rule about wording can supply that; it is a missing layer.
 *
 * So a repo declares its capabilities once, in prose, in `vibes.capabilities.md`
 * at its root, and every claim hangs off one by the area its id already
 * carries (`area.claim-in-brief`):
 *
 *     ## Test data logging `firmware/monitor`
 *
 *     Every sample taken during a test is written to the SD card as it happens,
 *     so a crash part-way through loses nothing already measured. ...
 *
 * The report then groups under those headings, prints the paragraph above the
 * rows, and leads with capability-level change. An area with no paragraph is
 * shown as uncharted rather than hidden — and `vibes lint` refuses it once a
 * repo has adopted the file, so the map stays complete.
 *
 * The file is Markdown, not JSON, because the paragraphs are the point and
 * they are written and reviewed by people. The order of headings is the
 * author's reading order — operator-facing first, plumbing last — and the
 * report keeps it.
 */

import type { Behaviour } from './ledger.js';

export const CAPABILITIES_FILE = 'vibes.capabilities.md';

export interface Capability {
  readonly title: string;
  /** Area keys this capability owns: `area`, or `suite/area` to pin one suite's use of the name. */
  readonly keys: readonly string[];
  /** The paragraph, as written. */
  readonly statement: string;
}

export interface CapabilityMap {
  readonly capabilities: readonly Capability[];
  /** What could not be read as a capability. Never silent. */
  readonly problems: readonly string[];
}

/* `## Title `key` `key`` — the title is everything before the first backtick. */
const HEADING = /^##\s+(.*?)\s*((?:`[^`]+`\s*)+)$/;
const KEY = /`([^`]+)`/g;

export function parseCapabilities(text: string): CapabilityMap {
  const capabilities: Capability[] = [];
  const problems: string[] = [];
  const seen = new Map<string, string>();

  let current: { title: string; keys: string[]; body: string[] } | undefined;
  const close = (): void => {
    if (current === undefined) return;
    const statement = current.body.join('\n').trim();
    if (statement === '') problems.push(`"${current.title}" has no paragraph — say what the capability is for`);
    capabilities.push({ title: current.title, keys: current.keys, statement });
    current = undefined;
  };

  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      close();
      const m = HEADING.exec(line.trimEnd());
      if (m === null) {
        problems.push(`heading "${line.slice(3).trim()}" names no area — end it with the area in backticks, e.g. \`firmware/monitor\``);
        continue;
      }
      const title = (m[1] ?? '').trim();
      const keys = [...(m[2] ?? '').matchAll(KEY)].map((k) => (k[1] ?? '').trim()).filter((k) => k !== '');
      for (const k of keys) {
        const owner = seen.get(k);
        if (owner !== undefined) problems.push(`\`${k}\` is claimed by both "${owner}" and "${title}"`);
        seen.set(k, title);
      }
      current = { title, keys, body: [] };
      continue;
    }
    // A level-1 heading and anything before the first capability is preamble.
    if (line.startsWith('# ') && current === undefined) continue;
    if (current !== undefined) current.body.push(line);
  }
  close();
  return { capabilities, problems };
}

/** The area a claim belongs to: the id up to its first dot, as CLAIMS.md asks ids to be shaped. */
export function areaOf(b: Behaviour): string {
  const dot = b.id.indexOf('.');
  return dot === -1 ? b.id : b.id.slice(0, dot);
}

/** `suite/area` when a capability pins that suite's use of the name, else `area`. */
export function capabilityFor(map: CapabilityMap, b: Behaviour): Capability | undefined {
  const area = areaOf(b);
  const scoped = `${b.suite}/${area}`;
  return (
    map.capabilities.find((c) => c.keys.includes(scoped)) ?? map.capabilities.find((c) => c.keys.includes(area))
  );
}

export interface CapabilityGroup<T> {
  /** Stable across sections of one report, so a statement is printed once. */
  readonly key: string;
  readonly title: string;
  readonly statement: string;
  readonly charted: boolean;
  readonly items: T[];
}

/**
 * Items under their capabilities, in the file's order; uncharted areas after,
 * alphabetically, each under a heading that says so. Hiding an unmapped area
 * would make the map look complete when it is not.
 */
export function groupByCapability<T>(
  map: CapabilityMap,
  items: readonly T[],
  of: (t: T) => Behaviour,
): CapabilityGroup<T>[] {
  const charted = new Map<Capability, T[]>();
  const uncharted = new Map<string, T[]>();
  for (const t of items) {
    const b = of(t);
    const c = capabilityFor(map, b);
    if (c !== undefined) {
      (charted.get(c) ?? charted.set(c, []).get(c) ?? []).push(t);
      continue;
    }
    const area = `${b.suite}/${areaOf(b)}`;
    (uncharted.get(area) ?? uncharted.set(area, []).get(area) ?? []).push(t);
  }

  const out: CapabilityGroup<T>[] = [];
  for (const c of map.capabilities) {
    const list = charted.get(c);
    if (list !== undefined) out.push({ key: c.title, title: c.title, statement: c.statement, charted: true, items: list });
  }
  for (const area of [...uncharted.keys()].sort()) {
    out.push({
      key: `uncharted:${area}`,
      title: `Uncharted — \`${area}\``,
      statement: `No capability declares \`${area}\`. Add a \`## <title> \\\`${area}\\\`\` heading to ${CAPABILITIES_FILE} saying what it is for.`,
      charted: false,
      items: uncharted.get(area) ?? [],
    });
  }
  return out;
}
