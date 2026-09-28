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
node bin/vibes.mjs publish --dir vibes-images --ref vibes-images --into "$HEAD"
node bin/vibes.mjs post --file vibes-report.md --repo owner/repo --pr "$PR"
```

Exit codes: `0` ok, `1` a behaviour broke or was removed, `2` usage, `3` a suite
could not run.

## Pictures

A repo can also list pictures a reviewer should see, in `vibes.images.json`.
The report lays each picture that changed out in three columns — **current**
(the base ref), **new** (this change), and **difference** (pixels that moved) —
and prints whatever metadata the repo attached. A picture the base ref does
not have yet shows only **new**; the current and difference cells stay empty.
Unchanged pictures are left out.

`report` writes the markdown and a local gallery. `publish` puts the
difference files where the comment can load them, and `post` keeps a single
comment on the pull request up to date. The contract, including the column
rules, is [`bindings/IMAGES.md`](bindings/IMAGES.md).

## Writing claims worth reading

The report is read **instead of** the code, which is the whole design
constraint. The rules that keep it readable are in
[`bindings/CLAIMS.md`](bindings/CLAIMS.md) — they are short, and each one was
paid for by a claim that turned out to say nothing.

## Status

Used in production by [MaD](https://github.com/RileyMcCarthy/MaD), where it
carries about a thousand expectations across C, TypeScript and Rust suites.
