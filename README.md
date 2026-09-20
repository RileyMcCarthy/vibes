# Vibes

**What behaviour does this change add, and what stopped holding?**

Vibes answers that from your tests, on every pull request. A test declares the
**condition** it sets up, then one or more **expectations** for that condition,
in language a reader who has never opened the code can judge:

```
- **When** one of the cores stops reporting that it is running
  - the machine faults and names a processor core as the reason `BH-585`
  - motion stays off `BH-586`
```

Those declarations collect into a committed ledger (`behaviours.jsonl`). Diffing
the ledger is the review: what a change **adds**, what it **respecifies**, what
it **removed**, and what **stopped holding**. A stable id per expectation is what
makes that four-way rather than a list of appeared-and-disappeared test names.

Vibes is polyglot by construction. The core never imports your code — each suite
is a command you already run, and a small binding writes one line per
expectation.

## Using it

Declare a suite next to your tests, in `vibes.suite.json`:

```json
{ "v": 1, "name": "control", "lang": "ts",
  "cmd": "npx vitest run --reporter=json --outputFile=$VIBES_RESULTS",
  "results": "vitest-json" }
```

Then annotate tests with the binding for your language — `bindings/ts`,
`bindings/c`, `bindings/rust`. See [`bindings/SCHEMA.md`](bindings/SCHEMA.md)
for the wire contract and [`bindings/SUITE.md`](bindings/SUITE.md) for suites.

```bash
node bin/vibes.mjs collect --write      # regenerate the ledger
node bin/vibes.mjs report --base main   # diff it and render markdown
```

Exit codes: `0` ok, `1` a behaviour broke or was removed, `2` usage, `3` a suite
could not run, `4` a claim needs rewriting.

## While you are writing one

Collecting runs every suite, so it is no use as a writing aid. These two run
nothing:

```bash
node bin/vibes.mjs preview --given "a start with a leftover byte on the link" \
                           --then "the start completes and the converter is converting"
node bin/vibes.mjs preview --id ads122   # what is committed, as it renders
node bin/vibes.mjs lint                  # every claim in the ledger
```

`preview` composes the exact line the reviewer will read — which is the only
way to catch a scene and an expectation that each look fine alone and compose
into a sentence with no main clause. `lint` checks the decidable half: names
from the code, contrast words, vague claims, machinery in a claim. Both print
the same findings.

## Writing claims worth reading

The report is read **instead of** the code, which is the whole design
constraint. The rules that keep it readable are in
[`bindings/CLAIMS.md`](bindings/CLAIMS.md) — they are short, and each one was
paid for by a claim that turned out to say nothing.

## Status

Used in production by [MaD](https://github.com/RileyMcCarthy/MaD), where it
carries about a thousand expectations across C, TypeScript and Rust suites.
