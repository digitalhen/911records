// Typed catalogue for Ask's "list" plan kind (issue #35): a question shaped
// like "which/what/list ... impacted by/tested for ..." gets a table of rows
// instead of a written answer — like prospect.nyc. This file is the single
// source of truth for what list kinds exist; lib/ask/plan.ts's system prompt
// and lib/ask/listExec.ts's dispatcher both key off LIST_KINDS/LIST_SPECS
// rather than re-listing the catalogue. Deliberately decoupled from
// lib/ask/plan.ts (no import of AskPlan) so plan.ts can import this file
// with no risk of a runtime cycle.
export const LIST_KINDS = [
  'buildings_by_substance',
  'labs_by_building',
  'labs_by_substance',
  'contractors_by_building',
  'documents_by_type',
  'officials_by_role',
  'substances_by_building',
] as const;
export type ListKind = (typeof LIST_KINDS)[number];

export function isListKind(v: string): v is ListKind {
  return (LIST_KINDS as readonly string[]).includes(v);
}

/** The subset of AskFilters (lib/ask/plan.ts) a list plan reads, named
 *  structurally so this file never imports plan.ts. */
export interface ListPlanFilters {
  contaminant: string;
  address: string;
  bin: string;
  agency: string;
  dateFrom: string;
  dateTo: string;
  docType: string;
  role: string;
  box: string;
}
export interface ListPlanLike {
  listType: string;
  filters: ListPlanFilters;
  resultOnly: boolean;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  cover_sheet: 'cover sheet',
  lab_report: 'lab report',
  chain_of_custody: 'chain of custody',
  memo_letter: 'memo/letter',
  sign_in_sheet: 'sign-in sheet',
  invoice: 'invoice',
  permit_application: 'permit application',
  form: 'form',
  photo_log: 'photo log',
  other: 'other',
};
export function docTypeLabel(v: string): string {
  return DOC_TYPE_LABELS[v] || v || 'document';
}

function dateRangeText(f: ListPlanFilters): string {
  if (f.dateFrom && f.dateTo) return ` (${f.dateFrom} to ${f.dateTo})`;
  if (f.dateFrom) return ` (from ${f.dateFrom})`;
  if (f.dateTo) return ` (through ${f.dateTo})`;
  return '';
}
function buildingText(f: ListPlanFilters): string {
  return f.address || (f.bin ? `BIN ${f.bin}` : '') || 'a building';
}

export interface ListSpec {
  kind: ListKind;
  /** Plain sentence describing the table, shown above it next to the AiMark. */
  describe: (p: ListPlanLike) => string;
  /** True when the plan carries the field(s) this kind actually needs to run. */
  ready: (p: ListPlanLike) => boolean;
}

export const LIST_SPECS: Record<ListKind, ListSpec> = {
  buildings_by_substance: {
    kind: 'buildings_by_substance',
    describe: (p) =>
      `Buildings with pages ${p.resultOnly ? 'reporting test results for' : 'mentioning'} ${p.filters.contaminant || 'a substance'}${dateRangeText(p.filters)}`,
    ready: (p) => !!p.filters.contaminant,
  },
  labs_by_building: {
    kind: 'labs_by_building',
    describe: (p) => `Labs named on pages about ${buildingText(p.filters)}`,
    ready: (p) => !!(p.filters.address || p.filters.bin),
  },
  labs_by_substance: {
    kind: 'labs_by_substance',
    describe: (p) => `Labs named on pages mentioning ${p.filters.contaminant || 'a substance'}`,
    ready: (p) => !!p.filters.contaminant,
  },
  contractors_by_building: {
    kind: 'contractors_by_building',
    describe: (p) => `Contractors named on pages about ${buildingText(p.filters)}`,
    ready: (p) => !!(p.filters.address || p.filters.bin),
  },
  documents_by_type: {
    kind: 'documents_by_type',
    describe: (p) => `${capitalize(docTypeLabel(p.filters.docType))} documents${p.filters.agency ? ` from ${p.filters.agency}` : ''}${dateRangeText(p.filters)}`,
    ready: (p) => !!p.filters.docType,
  },
  officials_by_role: {
    kind: 'officials_by_role',
    describe: (p) => `Officials acting as ${p.filters.role || 'a role'} on the records`,
    ready: (p) => !!p.filters.role,
  },
  substances_by_building: {
    kind: 'substances_by_building',
    describe: (p) => `Substances mentioned on pages about ${buildingText(p.filters)}`,
    ready: (p) => !!(p.filters.address || p.filters.bin),
  },
};

function capitalize(s: string): string {
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/** One citeable page representing a list row — enough for a "Save to case" add and a permalink. */
export interface ListCite {
  doc: string;
  page: number;
  batesPage: string;
  agency: string | null;
  box: string | null;
  folder: string | null;
  volume: string | null;
}

export interface ListRow {
  key: string;
  label: string;
  /** Link to the building/entity/signatory/document page this row is about, or null when nothing resolved. */
  href: string | null;
  /** Extra columns beyond label/docs/pages/dates — same keys across every row of one ListResult. */
  extra: { label: string; value: string }[];
  docCount: number;
  pageCount: number;
  firstDate: string | null;
  lastDate: string | null;
  cite: ListCite | null;
}

export interface ListResult {
  kind: ListKind;
  title: string;
  /** Column labels for `ListRow.extra`, in order — empty when this kind has no extra columns. */
  extraColumnLabels: string[];
  rows: ListRow[];
  /** True when the query hit MAX_LIST_ROWS and more rows exist than are shown. */
  truncated: boolean;
}

export const MAX_LIST_ROWS = 500;
