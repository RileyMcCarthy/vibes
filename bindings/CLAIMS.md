# Writing claims worth reading

The ledger is read by someone who has NOT seen the code — that is its entire
purpose, and the whole design constraint. A claim that needs the code to decode
has already failed.

Each rule below was paid for by a claim that turned out to say nothing. The
examples come from a tensile-testing machine, which is where they were learned.

## How many expectations?

Let the test's assertions decide, not the sentence structure.

| the test asserts | expectations |
|---|---|
| one thing | one |
| several genuinely different things | one each |
| several things that together establish ONE fact (three fields of a decoded record surviving a round trip) | one |

A claim reading "no chunk appears in the capture **and** the chunk count stays
at zero" is two expectations wearing one sentence. A claim reading "the name,
travel limit and load-cell constants all come back intact" is one.

## Writing the claim

This failed review, verbatim from an early ledger:

> the dwell is emitted as exactly one **op** and **P** survives in milliseconds

"op" is an internal type name; "P" is a G-code parameter letter. The reader this
report exists for knows neither. The same claim, written for them:

> exactly one pause is produced, and its duration is kept in milliseconds without conversion

Rules, in priority order:

1. **No internal type names, no parameter letters, no variable names.** Say what
   the thing *is* to the machine or its operator: a pause, a move, a target
   position, a speed, a fault.
2. **Domain words the operator genuinely uses are fine** — G-code, dwell, gauge
   length, tensile, load cell. Implementation words are not — op, struct, enum,
   buffer, `ProgramOp`.
3. **`then` is a claim, not an assertion restated.** "returns 3" is an
   assertion. "a five-millimetre travel with two millimetres of slack strains
   the sample by three" is a claim. If `then` could caption *any* test, it says
   nothing.
4. **`given` + `then` read as one sentence.** *Given* a pause command with a
   duration, *then* exactly one pause is produced…
5. **Write `why` for the non-obvious.** The requirement the claim does not
   already carry ("the target is what the author wrote before the comment;
   everything after it is annotation"), a hardware constraint ("the P2 has no
   64-bit divide; a 32-bit intermediate would silently wrap"). Never the
   defect that taught you the requirement.

The acceptance test: read `given` + `then` aloud to someone who has never seen
this repo. **If you have to explain a word, change the word.**

## `given` is the condition, `then` is the expectation

Each field does one job. The report prints them together:

```
- given one of the cores stops reporting that it is running
  **the machine reports a core fault**
  BH-352 · `src/APP/app_control.c#app_control_run`
```

For a long time `then` was printed as the headline on its own, so it had to
carry its own condition to be readable. Every claim therefore restated its
scene, and the outcome was whatever was left at the end:

> given *one of the cores stops reporting that it is running*
> then *a processor core that stops running is reported as a core fault*

Thirteen words to say six. Worse, the habit hides claims that say nothing at
all — once the condition is repeated, "is reported as a core fault" looks like
an outcome when it is only a label.

`then` still has to be specific enough that a bug makes it false, and it still
has to carry any condition the scene does not establish. It simply must not
repeat the scene it was handed.

## State the rule, not the instance

A value the test happens to assert is evidence. The rule that produces it is the
behaviour. This claim was rejected in review:

> given *an expected curve from 0 to 10 mm over two seconds*
> then *one second in reads 5 mm*

Five millimetres is right for straight-line interpolation, wrong for a step and
wrong for a spline, and the claim never says which — so a reader has no way to
judge it. The rule is what was actually built:

> then *a sample between two points reads the straight-line value between them*

Its sibling in the same test got this right already: "samples outside the span
hold the start and end positions" names the clamping rule rather than reporting
that −1 s came back as 0.

A bare value is fine in two cases. When the condition makes the rule
unambiguous — *a 1 mm extension on a 10 mm gauge* → *strain is 10 percent* —
and when the value IS the contract, as with a wire format: *the configuration
encodes to the agreed 68 bytes*. The test there is whether a reader who
disagrees with the number would know what to go and check.

## A spec says what the machine does

Not what it does not do, not what it used to do, and never what a bug once did.
This claim was rejected in review:

> lost power in the emergency-stop circuit is reported as the power fault, not
> as a tripped switch

The trailing contrast makes the reader stop and work out which half is true,
and it quietly implies the other half was once a bug. Neither belongs in a
specification. The machine has one behaviour, so state it:

> lost power in the emergency-stop circuit is reported as the power fault

Ban these from `then` and `given`: `not as`, `rather than`, `instead of`,
`no longer`, `used to`, and any mention of a defect, regression, or what
shipped.

The same rule governs `why`. Researching the commit that introduced a test is
worth doing — it is often the only place the reason survives — but write down
the **requirement it taught you**, never the story:

| instead of | write |
|---|---|
| fixes a defect where `G1 X10 F5 ; X50` moved to X50 | the target is what the author wrote before the comment; everything after it is annotation |
| this check sat commented out, so a test could overpull | the operator's configured force limit protects the specimen for the whole of a test |
| the changeover shipped asking the idle drive, so the machine sat disabled | only the drive actually running reports its readiness, so the controller asks the active one |

One thing that looks like a contrast and is not: a **condition the claim needs
to be true**. "a supervised loop that stops checking in is reported as a
watchdog fault, even while every processor core is still running" carries a
condition, not a comparison. Keep those — rule 2 above requires them.

## Choosing an `id`

`area.claim-in-brief`, kebab-case: `gcode.trailing-comment`,
`gantry.slack-consumed-before-extension`, `firmware.muldiv64-signed`.

The `id` is what makes the ledger diff four-way instead of two-way:

| you change… | the report says |
|---|---|
| the wording of `then`/`given`, same `id` | **respecified** — old and new claims side by side |
| the `id` | one behaviour **removed** + an unrelated one **added** |

So: **rewording a claim is normal and encouraged — keep the `id`.** Change an
`id` only when the behaviour genuinely is a different claim. Never version ids
(`-v2`) and never encode the wording in them.

