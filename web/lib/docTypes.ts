// Human-readable labels for site.documents.doc_type / the OpenSearch `doc_type` field (issue #28,
// scripts/embed/doctypes.py). Shared by the document viewer and search results so the two never
// drift. Always shown labelled "machine-extracted" — see docs/briefs/COMMON-web.md's privacy rules
// on derived values.
export const DOC_TYPE_LABELS: Record<string, string> = {
  cover_sheet: 'Folder cover sheet',
  lab_report: 'Lab report',
  chain_of_custody: 'Chain of custody',
  memo_letter: 'Memo or letter',
  sign_in_sheet: 'Sign-in sheet',
  invoice: 'Invoice',
  permit_application: 'Permit application',
  form: 'Form',
  photo_log: 'Photo log',
  other: 'Unclassified',
};

export function docTypeLabel(docType: string | null | undefined): string | null {
  if (!docType) return null;
  return DOC_TYPE_LABELS[docType] || docType;
}
