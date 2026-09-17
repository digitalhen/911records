// Catalog changes must not be skipped merely because the local PDF has the same size.
export const catalogChanged = (row, sidecar) => !!row.changed_at && (
  row.changed_at !== sidecar?.catalog_changed_at ||
  row.pdf_size !== sidecar?.manifest_pdf_size ||
  row.download_url !== sidecar?.url
);
