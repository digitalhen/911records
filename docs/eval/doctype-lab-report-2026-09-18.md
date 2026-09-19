# Recognizing laboratory reports after OCR recovery

`NYC-WTC_000102313` had recovered text headed “AIRBORNE ASBESTOS ANALYSIS BY
IRANSMISSION ELECTRON MICROSCOPY” and “LABORATORY RESULTS”, but the classifier matched
neither phrase. Its generated title described a laboratory report while its document type
remained `other`. These are independent derivations; copying the generated title into the
classification would make an unsupported title sufficient evidence for a tag.

The classifier now recognizes these report headings when at least two nearby labelled
laboratory fields corroborate them: laboratory ID, analysis date, analytical methodology
or filter area. A heading or a narrative mention alone is insufficient. Existing priority
for invoices, permits, chain-of-custody records and other higher-priority types is preserved.
Rules version 4 invalidates the previous classification cache, including unchanged text.

The example now classifies as `lab_report` with all four supporting fields. The 0.8 rule score
is a heuristic confidence, not a measured probability of correctness. Six new regression
checks cover the recovered example, alternative field spellings, insufficient evidence,
narrative mentions, distant fields and existing higher-priority classifications. All 23
Python evaluation tests pass.

The ongoing full OCR refresh will load the updated classifier when it reaches `doctypes_py`,
then publish classifications to Postgres and OpenSearch. This change does not interrupt the
running OCR process or directly mutate its in-progress derived stores. Production labels
remain unchanged until that publication completes.

A before/after classification comparison across all 24,436 extracted documents found 25
category changes, all `other` → `lab_report`. Inspection of the recovered headings and
laboratory fields in all 25 changed records supports those classifications. There were no
other category transitions. The exact comparison inputs/results are retained locally in
`data/doctype-eval/changes.json`; OCR was still progressing, so this is a per-document text
snapshot comparison, not a frozen final-corpus benchmark.
