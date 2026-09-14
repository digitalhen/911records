import { panelGrid, PANEL_TYPES, TYPE_LABELS } from '@/lib/discovery/data';
import { getStr, type SearchParamsInput } from '@/lib/searchUrl';
import { Shell, Caveat, metadata } from '@/components/discovery/Shared';
import EntitySearch from '@/components/discovery/EntitySearch';
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return metadata('Search by entity', 'Find labs, agencies, contractors, substances, addresses and official roles on City records.', '/entities'); }
export default async function Entities({ searchParams }: { searchParams: Promise<SearchParamsInput> }) {
  const q = (getStr(await searchParams, 'q') || '').slice(0, 120);
  const panels = await panelGrid(8);
  return <Shell title="Search by entity" eyebrow="Find a record through its role">
    <p>Labs, agencies &amp; offices, contractors, substances, addresses &amp; buildings, and officials acting on records — each in its own panel, top entries by source pages.</p>
    <EntitySearch order={PANEL_TYPES} labels={TYPE_LABELS} panels={panels} initialQuery={q} />
    <p className="quality">Officials are searchable only by their action on a record. Private residents, complainants, patients, claimants and workers’ personal details are excluded. Appearance implies nothing about anyone.</p>
    <Caveat />
  </Shell>;
}
