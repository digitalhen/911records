import { PageShell } from '@/components/info/PageShell';
import { pageMetadata } from '@/lib/info/metadata';
import { VegaChart } from '@/components/charts/VegaChart';
import { getTimeline } from '@/lib/charts/timeline';
import { pagesByWeekSpec, buildingsFirstTestedSpec, substanceMonthSpec, labMonthSpec } from '@/lib/charts/specs';
import { Callout } from '@/components/ui';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  return pageMetadata('Testing timeline', 'When lower Manhattan was tested after 9/11: test candidate pages by week, substance and lab, from the City’s own records.', '/timeline');
}

export default async function Timeline() {
  const t = await getTimeline();
  const totalPages = t.byWeek.reduce((n, r) => n + r.pages, 0);
  const totalBuildings = t.firstTested.reduce((n, r) => n + r.buildings, 0);
  return (
    <PageShell active="/timeline">
      <div className="page-title">
        <div>
          <div className="eyebrow">Charts</div>
          <h1>Testing timeline</h1>
          <p className="subtitle">When lower Manhattan was tested, for what, and by whom, as far as the City’s records show. Every chart counts source pages by the date extracted from the page; none is a measurement.</p>
        </div>
      </div>
      <Callout tone="info">Dates, substances and lab names are machine-extracted from scanned pages and carry the usual OCR errors. Pages with no readable date ({'≈'}{Math.round(100 - 100 * 2516 / 3652)}% of test candidate pages) are not on these charts. Hover a bar or cell for its figures; click a cell to open the matching search or lab page.</Callout>

      <section className="mt-7">
        <h2>Test candidate pages by week</h2>
        <p className="small muted">{totalPages.toLocaleString()} dated test candidate pages, stacked by substance family. September–December 2001 is the bulk-dust and asbestos sampling; the 2002 activity is mostly interior re-occupancy testing.</p>
        <VegaChart spec={pagesByWeekSpec(t.byWeek)} label="Test candidate pages per week by substance family" caption="Distinct source pages per week (Monday-based), by the family of substances named on the page. A page naming several substances counts once per family." />
      </section>

      <section className="mt-7">
        <h2>Buildings reached over time</h2>
        <p className="small muted">How many distinct buildings had at least one dated test page, cumulative from the first week.</p>
        <VegaChart spec={buildingsFirstTestedSpec(t.firstTested)} label="Cumulative buildings with a dated test page" caption={`${totalBuildings.toLocaleString()} buildings and addresses appear on a dated test page. A building enters the count in the week of its earliest extracted date.`} />
      </section>

      <section className="mt-7">
        <h2>Substances by month</h2>
        <p className="small muted">The fourteen substances named most often, by month. Darker means more pages. Click a cell to search those pages.</p>
        <VegaChart spec={substanceMonthSpec(t.bySubstance)} label="Pages per month for the most-named substances" caption="Pages per month naming each substance. Asbestos forms (chrysotile, amosite, tremolite…) are listed separately because the lab reports name them separately." />
      </section>

      <section className="mt-7">
        <h2>Laboratories by month</h2>
        <p className="small muted">The twelve labs named on the most dated test pages. Click a row’s cell to open the lab’s page.</p>
        <VegaChart spec={labMonthSpec(t.byLab)} label="Pages per month by laboratory" caption="A lab is counted on a page when its name was extracted from that page; the lab may have analysed samples for other pages that do not name it." />
      </section>
    </PageShell>
  );
}
