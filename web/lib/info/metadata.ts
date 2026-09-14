import type { Metadata } from 'next';
export function pageMetadata(title: string, description: string, path: string): Metadata {
  return { title, description, alternates: { canonical: path }, openGraph: { title: `${title} · 9/11 City Records`, description, url: path } };
}
