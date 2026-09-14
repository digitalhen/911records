/** pg returns date/timestamp columns as Dates; older catalog values can be strings. */
export type DatabaseDate = string | Date;

/** Keep string capture identifiers (including intraday suffixes) intact. */
export function formatDate(value: DatabaseDate | null | undefined): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value ?? '';
}
