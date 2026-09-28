# vibes.images.json — pictures a pull request should show

One committed file listing the pictures whose changes belong in the review.
Discovery is `git ls-files '*vibes.images.json'`, the same rule as suites: an
untracked manifest is not part of the repo. A repo may have more than one.
Vibes does not care what the pictures are of.

```json
{
  "v": 1,
  "images": [
    {
      "id": "overview",
      "title": "Overview",
      "path": "docs/overview.png",
      "note": "the screen a reviewer compares"
    }
  ]
}
```

| field    | required | meaning |
|----------|----------|---------|
| `v`      | yes      | schema version. An unknown version is an error, not a skip. |
| `images` | yes      | the pictures. The report follows the head manifests, then pictures that exist only at the base. |
| `id`     | yes      | stable token (`[A-Za-z0-9._-]`). The same picture across the two refs, and the difference file's name. |
| `title`  | yes      | heading a reviewer reads. |
| `path`   | yes      | repo-relative path of the picture. No `..`. |

Any other string field is metadata. It is printed on the row, in the order it
appears in the file, and Vibes never branches on its name. A non-string field
is an error for that row; the other pictures still show. A duplicate id is an
error; the first entry is the one that shows.

## The three columns

Vibes reads the bytes at `--base` and the bytes in the work tree. One
description of the columns drives both the comment and the HTML gallery
written under `--diff-dir` (default `vibes-images`).

| | current | new | difference |
|---|---|---|---|
| base has no file | empty | the new picture | empty |
| bytes differ | the base picture | the new picture | grey where they agree, red where a pixel moved |
| base had it, this change removed it | the base picture | empty | empty |
| byte for byte the same | not listed | not listed | not listed |

An empty column is an empty cell. The report does not write a word in its place.

Committed pictures are linked as `<github>/raw/<sha>/<path>`. Pass `--github
https://github.com/owner/repo`, or let Actions fill it in from the checkout.
The difference is not a committed file. Name the branch and directory it will
be published to and the comment links it:

```bash
node bin/vibes.mjs report --base origin/main \
  --head "$HEAD" \
  --publish-ref vibes-images \
  --into "$HEAD" \
  --diff-dir vibes-images
```

`--diff-base-url` overrides that link when the files live somewhere else.

A channel more than 16 apart counts as moved. A picture that grew is compared
on white, so the new margin shows up in red. A file that is not a PNG still
shows its current and new columns; the difference cell stays empty and the
report says the difference could not be drawn.

## Publishing and posting

`report` writes the gallery and the markdown. It does not push or comment.
Two commands do, and any repo can run them:

```bash
node bin/vibes.mjs publish --dir vibes-images --ref vibes-images --into "$HEAD"
node bin/vibes.mjs post --file vibes-report.md --repo owner/repo --pr "$PR"
```

`publish` copies every `<id>.diff.png` in the gallery to `<into>/` on the
branch and pushes. The branch is created the first time. Publishing the same
bytes again pushes nothing. A directory with no difference files is a
success, which is what a first adoption looks like: there is no earlier
picture, so there is no difference to publish.

`post` leaves one comment on the pull request, found by `<!-- vibes-ledger -->`
on its first line and edited in place. A report that would not fit in a
GitHub comment is cut, and the note says the job summary has the rest.
