# Adding a comparison

Add an entry to `data.ts`. Start with `status: 'draft'`; drafts never appear on the page. Give it a unique, stable kebab-case slug (used as its permanent page anchor).

Check both passages against original scans or an official archive before publishing. Record attribution, document date, exact Bates page and source URL. Distinguish draft edits, conflicting institutions, unsupported reassurance, and direct contradictions. Include surrounding qualifications, counterevidence and what the comparison does not establish. Do not infer intent, individual exposure or disease causation.

Use `documentShortUrl(doc, page)` for record links. A PDF page index and the report's printed page number may differ; label the printed number separately. Never count duplicate copies as independent evidence. Keep unverified suggestions in draft and do not complete truncated quotations.

Change status to `published` after review and update the review date and release notes. The list and navigation links are generated from published entries. The header's Copy short link preserves a selected comparison's URL fragment.

## Reviewing submissions

The public form writes to `app.contradiction_submissions` on the primary database. There is no public read endpoint and no automatic email or publishing. Review new entries through the existing private database connection:

```sql
SELECT id, created_at, kind, sources, note
FROM app.contradiction_submissions
WHERE status = 'new' ORDER BY created_at;
```

Treat submitted text and links as untrusted research leads. Verify sources before editing published comparisons. After review, update the matching row's status to `reviewed`. No submitter contact details are requested.
