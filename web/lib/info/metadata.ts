import type { Metadata } from 'next';
import { socialMeta } from '@/lib/seo/social';
export function pageMetadata(title: string, description: string, path: string): Metadata {
  return { title, description, alternates: { canonical: path }, ...socialMeta(title, description, path) };
}
