// Site-wide chart data over the test candidate pages (site.place_pages) and the entity index.
// Every figure here is a count of pages or buildings by extracted date — never a measurement.
import { unstable_cache } from 'next/cache';
import { queryRead } from '@/lib/db';

export const TIMELINE_START = '2001-09-11';
export const TIMELINE_END = '2003-12-31';

/** Substance families for the stacked chart; everything else is "other". */
const FAMILY_SQL = `case
  when c in ('asbestos','chrysotile','amosite','crocidolite','tremolite','anthophyllite','actinolite') then 'asbestos (all forms)'
  when c in ('dust','debris','particulate','silica','gypsum','fiberglass') then 'dust, debris and fibres'
  when c = 'lead' then 'lead'
  when c in ('mercury','chromium','cadmium','copper','zinc','nickel','beryllium','arsenic','manganese','antimony') then 'other metals'
  when c in ('dioxin','dioxins','pcb','pcbs','pahs','pah','polycyclicaromatic','vocs','voc','benzene') then 'organics (PCBs, dioxins, VOCs)'
  else 'other' end`;

/** One row per dated test page × substance, restricted to the clean-up years. */
const DATED_TESTS = `
  with x as (
    select doc, page, place_id, contaminants, jsonb_array_elements_text(dates) d
    from site.place_pages where has_test and jsonb_array_length(dates) > 0
  ), y as (
    select distinct doc, page, place_id, d::date as d, jsonb_array_elements_text(contaminants) c
    from x where d ~ '^\\d{4}-\\d{2}-\\d{2}$' and d::date between '${TIMELINE_START}' and '${TIMELINE_END}'
  )`;

export interface WeekFamily { week: string; family: string; pages: number; buildings: number }
export interface MonthCell { month: string; key: string; label: string; pages: number; year: number }
export interface FirstTested { week: string; buildings: number }

async function loadTimeline() {
  const [byWeek, bySubstance, byLab, firstTested] = await Promise.all([
    queryRead<WeekFamily>(`${DATED_TESTS}
      select to_char(date_trunc('week', d), 'YYYY-MM-DD') as week, ${FAMILY_SQL} as family,
             count(distinct (doc, page))::int pages, count(distinct place_id)::int buildings
      from y group by 1, 2 order by 1, 2`),
    queryRead<MonthCell>(`${DATED_TESTS}, top as (
        select c from y group by c order by count(*) desc limit 14)
      select to_char(d, 'YYYY-MM') as month, c as key, c as label, count(distinct (doc, page))::int pages, min(extract(year from d))::int as year
      from y where c in (select c from top) group by 1, 2 order by 1, 2`),
    queryRead<MonthCell>(`${DATED_TESTS}, labs as (
        select e.id, e.label, p.doc, p.page, y.d
        from site.entity_pages p join site.entities e on e.id = p.entity_id
        join (select distinct doc, page, d from y) y on y.doc = p.doc and y.page = p.page
        where e.type = 'lab'
      ), top as (select id from labs group by id order by count(distinct (doc, page)) desc limit 12)
      select to_char(d, 'YYYY-MM') as month, id as key, label, count(distinct (doc, page))::int pages, min(extract(year from d))::int as year
      from labs where id in (select id from top) group by 1, 2, 3 order by 1, 2`),
    queryRead<FirstTested>(`${DATED_TESTS}, f as (select place_id, min(d) d from y group by 1)
      select to_char(date_trunc('week', d), 'YYYY-MM-DD') as week, count(*)::int buildings from f group by 1 order by 1`),
  ]);
  return { byWeek, bySubstance, byLab, firstTested };
}

/** Cached for an hour: the site schema is rebuilt and swapped once a day. */
export const getTimeline = unstable_cache(loadTimeline, ['charts-timeline-v1'], { revalidate: 3600 });
