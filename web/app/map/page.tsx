import HomeMap, { mapMetadata } from '@/components/map/HomeMap';
export const dynamic = 'force-dynamic';
export async function generateMetadata() { return mapMetadata(); }
export default HomeMap;
