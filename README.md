# Vibes

**What behaviour does this change add, and what stopped holding?**

Vibes answers that from your tests, on every pull request. A test declares the
**condition** it sets up, then one or more **expectations** for that condition,
in language a reader who has never opened the code can judge:

```
- **When** one of the cores stops reporting that it is running
  - the machine faults and names a processor core as the reason
  - motion stays off
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

Exit codes: `0` ok, `2` usage, `3` a behaviour has no verdict (a suite could not
run or did not finish, or a test never reported), `4` a claim needs rewriting.
A behaviour that **stopped holding** or was **removed** leads the report but
does not fail it: the failing test already fails its own suite, and
a removal is usually the point of the change. Failing on either made the job
red on correct pull requests, and a check that is red on correct work stops
being read. `1` and `5` are retired and not reused.

A suite that declares nothing on this machine — a sanitizer that will not start,
a missing toolchain — keeps its committed rows when you `collect --write`; the
run says nothing new about them, so it does not delete them.

## In CI, where the tests already run

`report` runs every suite's command, which in CI repeats work the test jobs
have just done. With `--from DIR` it runs nothing and reads each suite's run
from `DIR/<suite name>/` instead:

- `behaviours.jsonl` — the file the binding wrote; set `VIBES_BEHAVIOURS` to it
  in the job that runs the tests.
- `results.out` — the runner's output in the suite's `results` format (`tee`
  the output of `pio test` or `cargo test`; give vitest a second, `json`
  reporter writing here).

```bash
node bin/vibes.mjs report --base origin/main --from "$RUNNER_TEMP/vibes"
```

A suite with **no directory** was not run for this change — its job was skipped
because nothing it tests changed. Its rows are carried from the base as they
were, and the report names it in one line under the headline.

A suite whose job **failed after its tests ran** keeps its files, plus an empty
file named `incomplete`. Every test it reported keeps its verdict, so one
failing test reads as one behaviour that **stopped holding** while the rest
hold; a behaviour the run never reached, or whose test never printed a result,
has **no verdict** (exit `3`) — never a removal. A suite whose job left nothing
(cancelled, or failed before its tests) gets an **empty** directory, and all of
it has no verdict. Deciding which is which is the workflow's job — it knows each
job's result; Vibes only sees the directories.

## Two branches at once

An expectation is identified by `suite/id/expect` and nothing else, and the
ledger is sorted by that key. Two branches that add behaviour add different
lines, so they merge without anything to settle.

Earlier versions also gave each row a `BH-n` citation number from a
`behaviours.next` counter. Every concurrent branch then took the same numbers
and had to renumber before it merged, which cost more than the citations were
worth. A ledger that still carries `num` is read as if it did not, and the next
`collect --write` drops it; delete `behaviours.next` in the same commit.

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

## The capability above the claim

A ledger row is a unit test described politely — *the records land in the
file* — and a thousand of them grouped by file path read as a thousand
mechanisms. The reader never learns what feature a row belongs to, what it is
for, or what an operator would lose if it broke. So a repo declares that once,
in prose, in `vibes.capabilities.md` at its root:

```markdown
## Test data logging `firmware/monitor`

Every sample taken during a test is written to the SD card as it happens, so a
crash part-way through loses nothing already measured.
```

Every claim hangs off a capability by the area its id already carries
(`monitor.logging-writes-a-row` → `monitor`; a `suite/area` key pins one
suite's use of a name). The report then leads with a table of which
capabilities changed and how, groups every section under those headings with
the paragraph printed above the rows, and `vibes preview` with no filter
renders the whole ledger as a document — the paragraph, then the claims that
hold it up. An area with no paragraph shows as **uncharted** rather than being
hidden, and `vibes lint` refuses it once the file exists.

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
