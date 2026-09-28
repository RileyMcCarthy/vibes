# vibes.images.json — pictures a pull request should show

One file, committed, listing the pictures whose changes belong in the review.
Discovery is `git ls-files '*vibes.images.json'`, the same rule as suites: an
untracked manifest is not part of the repo.

```json
{
  "v": 1,
  "images": [
    {
      "id": "blinky",
      "title": "Blinky",
      "path": "tests/benchmarks/schematics/blinky.png",
      "kind": "schematic",
      "board": "blinky"
    }
  ]
}
```

| field   | required | meaning |
|---------|----------|---------|
| `v`     | yes      | schema version. An unknown version is an error, not a skip. |
| `images`| yes      | the pictures, in the order the report shows them. |
| `id`    | yes      | stable token (`[A-Za-z0-9._-]`). Identity across the two refs. Also the difference file's name. |
| `title` | yes      | heading a reviewer reads. |
| `path`  | yes      | repo-relative path of the picture. No `..`. |
| `kind`  | no       | what the picture is, for example `schematic`. Printed with the row. |
| `board` | no       | which board, when the picture is one board's sheet. |

Any other string field is metadata and is printed on the row. A non-string
field is an error for that row; the other pictures still show.

## What the three columns are

Vibes reads the bytes at `--base` and the bytes in the work tree.

| | current | new | difference |
|---|---|---|---|
| base has no file | empty | the new picture | empty |
| bytes differ | the base picture | the new picture | grey where they agree, red where a pixel moved |
| base had it, this change removed it | the base picture | empty | empty |
| byte for byte the same | not listed | not listed | not listed |

Committed pictures are linked as `<github>/raw/<sha>/<path>`. Pass `--github
https://github.com/owner/repo` (Actions fills this in from the checkout). The
difference is not a committed file. Vibes writes `<id>.diff.png` under
`--diff-dir` (default `vibes-images`) and links it only when `--diff-base-url`
says where that file will be published.

A channel more than 16 apart counts as moved. A picture that grew is compared
on white, so the new margin shows up in red.
