import { z } from 'zod';

const id = z.string().regex(/^NYC-WTC_\d{9}$/);
const text = z.string().nullable();
const link = z.string().url();
const page = z.number().int().positive();
const count = z.number().int().nonnegative();
const nextOffset = count.nullable().describe('Next character or list offset; null when complete.');

export const outputSchemas = {
  search_records: {
    hits: z.array(z.object({ doc: id, page, bates: id, agency: text, machine_extracted_title: text, short_url: link, url: link })),
    indexed_page_total: count.describe('Indexed pages, not unique documents; may lag catalog removals.'),
    page, next_page: page.nullable(), semantic: z.boolean(), note: z.string(),
  },
  get_document: {
    doc: id, agency: text, volume: text, box: text, page_count: count.nullable(),
    machine_extracted_title: text, machine_extracted_summary: text,
    short_url: link, url: link, official_url: link.nullable(), pdf_url: link.nullable(),
    pages: z.array(z.object({ page, short_url: link, url: link })), next_page: page.nullable(),
  },
  get_page: {
    doc: id, page, bates: id, text: z.string().describe('OCR excerpt; verify against the source scan.'),
    text_available: z.boolean(), ocr_source: text, offset: count,
    next_offset: nextOffset, total_chars: count, short_url: link, url: link,
    scan_url: link.nullable(), official_url: link.nullable(), note: z.string(),
  },
  browse_collection: {
    documents: z.array(z.object({ doc: id, agency: text, volume: text, box: text, page_count: count.nullable(), short_url: link, url: link })),
    next_after: id.nullable().describe('Pass as after to retrieve the next batch; null when complete.'),
  },
  get_changes: {
    changes: z.array(z.object({ date: z.iso.date().describe('Catalog capture date, not document date.'), doc: id, kind: z.string(), url: link, short_url: link })),
    next_offset: nextOffset, note: z.string(),
  },
};
