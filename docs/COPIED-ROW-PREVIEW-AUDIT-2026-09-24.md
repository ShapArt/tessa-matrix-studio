# Copied rows and missing Preview changes — 1.16.14 candidate

## Evidence and reproduction

The user identified workbook (25) as edited and (26) as the export before editing.
Both XLSX files were read using the shipped 1.16.13 userscript and independently
decoded from worksheet XML/shared strings. Rows were matched by exported identity,
not their current physical position. The supplied Preview JSON and changes XLSX
agree with the saved workbook: two missing original identities and two copies.

The copies at Excel rows 117 and 134 contain a real visible-field edit relative to
their source, but their resulting criteria and roles both match existing TESSA
row 42. The idempotent NOOP classification is correct. There is no changed value
in the saved original Excel row 19. A later duplicate-check message is reproduced
by editing that row to the values of the row scheduled for deletion; it is not
evidence that the XLSX parser lost the saved edit.

All eight supplied files were inventoried locally, including archive CRC and JSON
validation. Corporate workbooks, snapshot data, logs and screenshots stay outside
Git. The earlier live Full UAT result (51 PASS) belongs to **1.16.13**, not this
candidate.

## Confirmed defects fixed

- A rejected individual cell value could fall back to the original value while
  Preview showed zero errors. Affected rows now appear in All/Skip/Error, are
  searchable, and count once even when multiple values in the row are rejected.
  Partial value rejection remains distinct from skipping an entire mutation.
- Idempotent copied additions disappeared among ordinary unchanged rows. Preview
  now shows their exact TESSA match and recognised edits relative to the copy
  source. The expanded list renders at most 20 entries; the Preview JSON contains
  all matches and rejected values. All user-supplied labels are HTML escaped.
- Server duplicate errors on an UPDATE/ADD coupled to DELETE were too generic.
  An exact typed semantic match now adds the blocking TESSA row and recognised
  UPDATE differences to the explanation. Other errors retain their original
  classification. Failures remain expanded even if every mutation was rejected.

Planner mutation classification, duplicate validation, write order, stale checks
and dependent-delete guards are preserved. This change **does not implement an
atomic UPDATE + DELETE** or bypass the native server duplicate check.

## Verification

The candidate is composed from the checked-in workflow recipe using
`node tools/build-paging-candidate.mjs <output>`.

- `npm test`: repository regression suite, including the new behavioral test.
- Exact-artifact workflow: 27 test programs against the composed userscript.
- `tests/copied-row-preview-diagnostics.mjs`: copied source versus existing target,
  unique edited copies, rejected-value counters/search/deduplication, dependent
  preflight rejection, report evidence, bounded rendering and HTML escaping.
- Local Chromium/Playwright: real file upload, Analyze, counter filters, excluding
  and restoring a copied ADD, reselecting the original export, DOM and screenshots.
  The script and UI run unchanged apart from test exports; the TESSA bridge uses
  the supplied snapshot and explicit server mocks. No live writes occur.

| Local browser scenario | UPDATE | ADD | DELETE | whole-row SKIP |
| --- | ---: | ---: | ---: | ---: |
| Supplied (26), before edits | 0 | 0 | 0 | 0 |
| Supplied (25), two already-existing copies | 0 | 0 | 2 | 0 |
| Unique edit + two copied ADDs + one ID-less ADD + two deletions | 1 | 3 | 2 | 0 |
| Edit equal to a row scheduled for deletion; server rejects duplicate | 0 | 0 | 0 | 2 |
| Invalid reference edit, baseline retained | 0 | 0 | 0 | 0 |
| Reselect original export after those scenarios | 0 | 0 | 0 | 0 |

The invalid reference case has **one visible error/partially rejected row** despite
zero whole-row skips. It does not create a write. Chromium reported no JavaScript
errors. Live TESSA validation of 1.16.14 remains a separate manual step.

## Excel change tracking

The export already contains an original snapshot (`__TESSA_BASELINE`) and hidden
row identities. Comparing actual cell values with that baseline is the source of
truth; a manual dirty flag or macro would itself be copied with a row and cannot
prove what changed. This investigation did not justify adding VBA or replacing
the baseline/incremental Preview path. Save the workbook and select it again for
the next Preview; the browser cannot observe unsaved edits inside Excel.

## Git and rollback

Work is isolated in `fix/copied-row-preview-regression`, based on `b201567`.
The previous 1.16.13 ZIP remains intact. Reinstall that candidate to roll back the
userscript; revert the new branch commit to roll back the source changes.
