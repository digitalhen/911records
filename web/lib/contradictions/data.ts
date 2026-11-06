import { documentShortUrl } from '@/lib/shortlinks/paths';

type Statement = { label: string; quote: string; attribution: string; date: string; url: string; source: string };
export type Comparison = {
  slug: string; title: string; kind: 'Draft and final wording' | 'Unsupported reassurance' | 'Conflicting guidance' | 'Threshold and safety' | 'Context behind public statements';
  release: ReleaseId; status: 'published' | 'draft'; left: Statement; right: Statement; assessment: string; context: string; limits: string;
  supportingSources?: { url: string; source: string }[];
};
// City releases the records were published in, newest first. The page groups comparisons by these.
export const RELEASES = [
  { id: 'october-2026', label: 'October 16, 2026 release', note: 'Comparisons drawn from records the City first published on October 16, 2026.' },
  { id: 'september-2026', label: 'September 8, 2026 release', note: 'Comparisons drawn from the City’s first release of records on September 8, 2026.' },
] as const;
export type ReleaseId = typeof RELEASES[number]['id'];

const doc = 'NYC-WTC_000145345';
const record = (page: number) => documentShortUrl(doc, page);
export const reportUrl = 'https://www.epa.gov/sites/default/files/2015-12/documents/wtc_report_20030821.pdf';

// Add reviewed comparisons here. Draft entries are excluded from pages and sitemap.
const entries: Comparison[] = [
  {
    slug: 'water-street-warning', title: 'A warning about returning to Water Street was deleted', kind: 'Draft and final wording', release: 'september-2026', status: 'published',
    left: { label: 'Draft warning', quote: 'The concern raised by these samples would be for the workers at the cleanup site and for those workers who might be returning to their offices on or near Water Street on Monday, September 17, 2001.', attribution: 'Draft EPA press release, reproduced by the EPA Inspector General', date: 'Draft dated September 14, 2001', url: record(27), source: 'NYC-WTC_000145371 · report p. 16, Table 2-4' },
    right: { label: 'Added to the issued release', quote: 'Our tests show that it is safe for New Yorkers to go back to work in New York’s financial district.', attribution: 'John L. Henshaw, Assistant Secretary of Labor for OSHA, quoted in the EPA release', date: 'September 16, 2001', url: record(27), source: 'NYC-WTC_000145371 · report p. 16, Table 2-4' },
    assessment: 'The Inspector General’s side-by-side table identifies the Water Street warning as deleted and not replaced, and the Henshaw quotation as added to the issued release.',
    context: 'The report says every change suggested by the White House Council on Environmental Quality contact was made, adding reassuring statements and deleting cautionary ones. Its analysis was limited because Council officials chose not to meet with investigators.',
    limits: 'These are different passages in the same release, not a direct sentence-for-sentence substitution. The record documents a change in public messaging; it does not establish any particular person’s exposure or illness.',
  },
  {
    slug: 'safe-to-breathe', title: '“Safe to breathe” before sufficient monitoring data', kind: 'Unsupported reassurance', release: 'september-2026', status: 'published',
    left: { label: 'Public reassurance', quote: 'their air is safe to breath', attribution: 'EPA Administrator Christine Todd Whitman; spelling as preserved in the EPA archive', date: 'September 18, 2001', url: 'https://www.epa.gov/archive/epapages/newsroom_archive/newsreleases/ed368f43303656488525744e00039488.html', source: 'EPA archived press release' },
    right: { label: 'Later Inspector General finding', quote: 'EPA did not have monitoring data to support reassurances made in press releases up to September 18', attribution: 'EPA Office of Inspector General', date: 'August 21, 2003', url: record(21), source: 'NYC-WTC_000145365 · report p. 10' },
    assessment: 'The Inspector General found that EPA lacked monitoring data for several contaminants, including PCBs, particulate matter, dioxin, and PAHs, when it issued the reassurances.',
    context: 'The report explains that access, security, power, equipment, and analytical capacity constrained early monitoring. For several pollutants, sampling began on September 16 and results were not available until after the September 18 release.',
    limits: 'This is a later review of the basis for a public reassurance. A lack of supporting data does not, by itself, establish a particular exposure level or health outcome. The archive preserves “breath”; the title uses the standard spelling.',
  },
  {
    slug: 'asbestos-warning-revised', title: 'An asbestos warning gave way to reassurance', kind: 'Draft and final wording', release: 'september-2026', status: 'published',
    left: { label: 'Draft wording', quote: 'However, even at low levels, EPA considers asbestos hazardous in this situation', attribution: 'Draft EPA press release, reproduced by the EPA Inspector General', date: 'For the September 13, 2001 release', url: record(28), source: 'NYC-WTC_000145372 · report p. 17, Table 2-5' },
    right: { label: 'Issued wording', quote: 'the general public should be very reassured by initial sampling.', attribution: 'Issued EPA press release, reproduced by the EPA Inspector General', date: 'September 13, 2001', url: record(28), source: 'NYC-WTC_000145372 · report p. 17, Table 2-5' },
    assessment: 'The Inspector General identifies cautionary language removed from the draft and more reassuring statements in the issued release. Its table preserves both versions.',
    context: 'The draft also reported no or very low asbestos levels in preliminary sampling. The issued release described short-term, low-level exposure as unlikely to cause significant health effects, while calling for precautions for rescue and cleanup crews.',
    limits: 'The report says investigators could not locate a record explaining these particular changes. Unlike the September 16 example, this table does not establish who directed the edits. The excerpts should be read with the complete wording.',
  },
  {
    slug: 'children-and-pregnancy', title: 'No extra precautions for children or pregnant women?', kind: 'Conflicting guidance', release: 'september-2026', status: 'published',
    supportingSources: [{ url: documentShortUrl('NYC-WTC_000141823'), source: 'NYC-WTC_000141823 · advisory p. 1, general precautions' }],
    left: { label: 'NYC public health advice', quote: 'No. Pregnant women and young children do not need to take additional precautions.', attribution: 'New York City Department of Health public health advisory', date: 'Undated advisory; printout dated October 1, 2001', url: documentShortUrl('NYC-WTC_000141823', 2), source: 'NYC-WTC_000141824 · advisory p. 2' },
    right: { label: 'Scope EPA officials later described', quote: 'healthy adults - not sensitive sub-populations such as children and the elderly', attribution: 'EPA Region 2 officials, as reported by the EPA Inspector General', date: 'August 21, 2003 report', url: record(19), source: 'NYC-WTC_000145363 · report p. 8' },
    assessment: 'NYC’s advisory said these groups needed no additional precautions. EPA officials later told investigators that their September 18 safety statement applied to healthy adults, with other limits concerning pollutants, outdoor air, and long-term effects.',
    context: 'The Inspector General says most of those qualifications were absent from EPA’s 2001 press releases. The NYC advisory did give general precautions to residents on its first page; “no additional precautions” did not mean no precautions at all.',
    limits: 'These statements come from different agencies. This is conflicting government guidance, not proof that one official contradicted themselves. The EPA passage specifically names children and the elderly, not pregnant women, and does not establish what independent evidence NYC considered.',
  },
  {
    slug: 'one-percent-asbestos', title: 'A cleanup threshold was not a safe level', kind: 'Threshold and safety', release: 'september-2026', status: 'published',
    left: { label: 'How the benchmark was used', quote: 'New York City also recommended that building owners use this 1 percent benchmark in determining whether the interior of buildings should be cleaned for asbestos', attribution: 'EPA Inspector General’s account of NYC guidance', date: 'August 21, 2003 report', url: record(23), source: 'NYC-WTC_000145367 · report p. 12' },
    right: { label: 'EPA expert’s qualification', quote: '1% asbestos in a material is not a safe level of asbestos', attribution: 'EPA Branch Chief email quoted in the Inspector General report', date: 'September 19, 2001 email, reproduced in 2003', url: record(23), source: 'NYC-WTC_000145367 · report p. 12' },
    assessment: 'The report distinguishes the regulatory and measurement basis of the 1 percent threshold from a health-based safety standard, while documenting its use in interior-cleaning decisions.',
    context: 'The quoted email explains that material containing one-half percent asbestos could be as hazardous as material containing 20 percent, depending on its condition and handling. The report also says EPA lacked health-based benchmarks for airborne asbestos and asbestos in bulk dust.',
    limits: 'This does not establish that NYC explicitly said “under 1 percent is safe.” The issue is the use of a regulatory trigger in practical cleanup decisions. Percent asbestos in material is not interchangeable with an airborne concentration or an individual dose.',
  },
  {
    slug: 'short-duration-exposure', title: '“Very low” short-duration risk, without acute-exposure benchmarks', kind: 'Conflicting guidance', release: 'september-2026', status: 'published',
    left: { label: 'NYC public reassurance', quote: 'The risk of developing an asbestos-related illness following an exposure of short duration is very low.', attribution: 'New York City Department of Health public health advisory', date: 'Undated advisory; printout dated October 1, 2001', url: documentShortUrl('NYC-WTC_000141823', 2), source: 'NYC-WTC_000141824 · advisory p. 2' },
    right: { label: 'Limits described by the later review', quote: 'Guidelines were not available to assess the impact of acute (up to 8 hours) exposures.', attribution: 'EPA Office of Inspector General', date: 'August 21, 2003', url: record(23), source: 'NYC-WTC_000145367 · report p. 12' },
    assessment: 'The NYC advisory offered a broad reassurance about brief asbestos exposure. The Inspector General described a gap in the benchmarks available for assessing the acute exposures experienced during the collapse.',
    context: 'The report notes that people in the initial dust cloud could have encountered high levels of several pollutants for a short time. It says EPA’s draft acute-exposure guidelines did not apply to the pollutants of concern at the site, and that EPA adapted longer-term Superfund benchmarks for one-year exposures.',
    limits: 'NYC’s statement concerns asbestos-related illness; the EPA review discusses multiple pollutants and acute-exposure assessment. The missing benchmarks do not prove a particular short exposure caused disease or rule out every other basis for assessing risk. They limit what this comparison alone can establish.',
  },
  {
    slug: 'wall-street-and-public-messaging', title: 'Public-health messaging and the push to reopen Wall Street', kind: 'Context behind public statements', release: 'september-2026', status: 'published',
    left: { label: 'Public message', quote: 'Our tests show that it is safe for New Yorkers to go back to work in New York’s financial district.', attribution: 'John L. Henshaw, Assistant Secretary of Labor for OSHA, quoted in the EPA release', date: 'September 16, 2001', url: record(27), source: 'NYC-WTC_000145371 · report p. 16' },
    right: { label: 'Who approved the early releases', quote: 'final approval came from the White House.', attribution: 'EPA Chief of Staff, quoted by the EPA Inspector General', date: 'August 21, 2003 report', url: record(28), source: 'NYC-WTC_000145372 · report p. 17' },
    assessment: 'The Inspector General records the Chief of Staff’s account that EPA and the White House jointly owned the early releases, with final approval from the White House. She said the desire to reopen Wall Street and national security concerns were considerations in preparing them.',
    context: 'The same page records another EPA official’s statement about the September 16 release: “I did not feel like it was my press release.” The preceding page documents the Council on Environmental Quality’s requested edits. Read this alongside the Water Street comparison.',
    limits: 'This is evidence about the process and considerations behind the messaging, not a standalone logical contradiction or proof that every statement was false. It does not establish an individual official’s intent to deceive.',
  },
  // October 16, 2026 release (volume NYC-WTC0008). Quotations checked against the scans on 2026-11-05.
  {
    slug: 'resident-letter-cleaning-advice', title: 'Residents were told cleaning was “not recommended”; the final report recommended it', kind: 'Conflicting guidance', release: 'october-2026', status: 'published',
    supportingSources: [
      { url: documentShortUrl('NYC-WTC_000232959', 50), source: 'NYC-WTC_000233008 · report p. 40, long-term risk' },
      { url: documentShortUrl('NYC-WTC_000199643'), source: 'NYC-WTC_000199643 · cover letter to residents, June 2002' },
    ],
    left: { label: 'Form letter to residents', quote: 'Although there are traces of asbestos in the dust of your home, it does not pose a health hazard at this time. […] Although not recommended at this time, you may wish to have your home cleaned.', attribution: 'New York City Department of Health form letter, “Asbestos present but No Indication of an asbestos hazard,” for homes in its residential sampling study with ATSDR', date: 'Undated template for homes sampled in November and December 2001', url: documentShortUrl('NYC-WTC_000199660'), source: 'NYC-WTC_000199660 · letter p. 1' },
    right: { label: 'Final report recommendation', quote: 'are recommending that people continue to conduct frequent cleaning with HEPA vacuums and damp cloths/mops to reduce the potential for exposure.', attribution: 'NYC Department of Health and Mental Hygiene and the U.S. Agency for Toxic Substances and Disease Registry, final technical report of the residential dust investigation', date: 'September 2002', url: documentShortUrl('NYC-WTC_000232959', 53), source: 'NYC-WTC_000233011 · report p. 43' },
    assessment: 'The letter was written for homes where asbestos was found in settled dust but no fibers were found in the air sample. It told residents the dust did not pose a health hazard at that time and that cleaning was not recommended. The same agencies’ final report recommended frequent HEPA vacuuming and damp cleaning for lower Manhattan residents, because settled dust there contained more asbestos, fiberglass and building-material minerals than dust in comparison homes above 59th Street.',
    context: 'The final report also says its worst-case estimate “cannot rule out the potential for long-term risk,” and that cleaning should continue, with asbestos levels monitored, until the data show long-term lung cancer and mesothelioma risk is minimal. A June 2002 cover letter in the same files says asbestos results had been sent to building owners and residents earlier that year. A handwritten note labels this template “categ. B”; it listed cleaning recommendations as an attachment for residents who chose to clean.',
    limits: 'The letter is an undated template with blanks and bracketed drafting notes. The record does not show which households received this wording or how it was edited before sending. The letter describes a single home at the time of sampling; the report’s recommendation applies to lower Manhattan residential areas generally and draws on the full study. The report says people who clean frequently are unlikely to face its worst-case conditions. This is a change in official advice, not evidence of any person’s exposure or illness.',
  },
  {
    slug: 'dioxin-list-and-public-message', title: 'Listing dioxin would “contradict” EPA’s public message, a health official warned', kind: 'Context behind public statements', release: 'october-2026', status: 'published',
    supportingSources: [
      { url: documentShortUrl('NYC-WTC_000199582'), source: 'NYC-WTC_000199582 · committee report title page and contributors' },
      { url: documentShortUrl('NYC-WTC_000199582', 2), source: 'NYC-WTC_000199583 · contents, peer review draft (September 2002)' },
    ],
    left: { label: 'Internal objection', quote: 'The current list of COC’s contains chemicals that EPA has publicly stated are not a health concern in air as a result of WTC emissions (dioxins, pah’s, Cr, lead, silica, and others) based on monitoring data. Including them on a COC list contradicts that message', attribution: 'Robert L. Chinery, New York State Department of Health, email to New York City Department of Health staff about the indoor clean-up task force', date: 'March 26, 2002', url: documentShortUrl('NYC-WTC_000199641'), source: 'NYC-WTC_000199641 · email p. 1' },
    right: { label: 'Later committee finding on dioxin', quote: 'Ambient air samples exceeded EPA’s screening criteria (see Appendix B) at various sampling stations during September and October, 2001.', attribution: 'Contaminants of Potential Concern Committee, World Trade Center Indoor Air Taskforce Working Group (EPA, NYC and NYS Health Departments, ATSDR and OSHA)', date: 'Peer review draft, September 2002', url: documentShortUrl('NYC-WTC_000199582', 6), source: 'NYC-WTC_000199587 · report p. 7' },
    assessment: 'The email argued against putting dioxins, PAHs, chromium, lead and silica on the list of contaminants for the indoor clean-up, in part because EPA had publicly said they were not a health concern in air and because listing them “may generate alarm.” The committee’s later draft, which names the email’s author among its contributors, kept dioxin, PAHs, lead and crystalline silica as contaminants of potential concern. It cited dioxin air samples above EPA’s risk-based screening levels and PAHs in bulk dust above an EPA removal guideline. Chromium was not selected.',
    context: 'The email also made practical arguments: that removing the dust removes the contamination, that testing a long list would be costly, and that clearance levels for dust would rest on uncertain risk methods. Handwritten notes on the printed copy, by an unidentified writer, group dioxin, lead and PAHs as “fire related,” list other substances as “candidates for deletion,” and add “PAH’s → we don’t have much air data on this.”',
    limits: 'This records one official’s internal argument and the committee’s later choices. It does not show that any public statement was changed because of the email, and the email paraphrases EPA rather than quoting it. A screening-level exceedance is a conservative trigger for further evaluation, not proof of harm. The committee document is a peer-review draft, and its final form may differ.',
  },
];
export const comparisons = entries.filter(entry => entry.status === 'published');
export const comparisonsByRelease = RELEASES
  .map(release => ({ ...release, entries: comparisons.filter(entry => entry.release === release.id) }))
  .filter(group => group.entries.length > 0);
