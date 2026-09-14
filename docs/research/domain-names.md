# Domain names for the independent 9/11 records explorer

Research pass, 2026-09-13 (New York time). This covers naming and domain availability only, with
nothing bought or reserved. Availability was checked with public RDAP and WHOIS lookups. All 81
lookups ran one after another, at least 1.5 s apart, between 22:19 and 22:27 ET on 2026-09-13
(02:19–02:27 UTC on 2026-09-14). No registrar checkout, cart, account or form was touched.

"Unregistered" below means the registry's RDAP server answered **404** (or `.us` WHOIS answered
"No Data Found"). It does **not** mean "available at standard price". RDAP cannot show registry
premium pricing or registry-reserved status, so every name needs a price check by Henry at a
registrar's search page before anything is decided.

---

## 1. Summary and top 5

The corpus is the City's own records, and the press already calls them **"9/11 records"**:
CNN, NY1, ABC7, Patch and TIME all use that phrase. The strongest names are the plainest
ones. They say what the site holds, use the `911` + word `.org` pattern the 9/11 ecosystem
already uses (911memorial.org, 911healthwatch.org, 911digitalarchive.org), and avoid every
word that points to a verdict, a secret or an institution.

| Rank | Name | Status (2026-09-13 ET) | Why |
|---|---|---|---|
| **1** | **911records.org** | Unregistered. `.net`, `.info`, `.nyc` and `.us` are also unregistered. `.com` is **registered** and listed for sale on HugeDomains (buy-now **$3,395** shown on its public listing page). | The press's own phrase, 10 characters before the TLD. Spoken as "nine-eleven records dot org", it is typed correctly after one hearing. It says "records", not "truth". It reads well in a citation (`911records.org/doc/<Bates>`). |
| **2** | **sept11records.org** | Unregistered, and so are `.com`, `.net`, `.info`, `.nyc` and `.us`. The whole name set can be owned cheaply. | Cannot be misread as emergency-call (911) records. Caveat: `sept11` echoes the official portal's `nyc.gov/sept11docs` and `sept11documents.cityofnewyork.us` (see § 4). |
| **3** | **911readingroom.com** | `.com` and `.nyc` unregistered. `.org` is **registered** (2024) to an unrelated lifestyle content site. | "Reading room" is the archival and FOIA term for a place where the public reads records. It is calm, civic and non-accusatory. Downside: the `.org` belongs to a content farm. |
| **4** | **911publicrecords.org** | `.org`, `.com` and `.nyc` unregistered | Plain and legally precise, because these are public records released under FOIL litigation. Downside: 16 characters, and "public records" is also the vocabulary of people-search sites. |
| **5** | **911folio.org** | `.org`, `.com` and `.nyc` unregistered | Short and ownable, with archival and legal overtones (a folio is a numbered leaf). It has no conflicts found. Downside: "folio" is unfamiliar to many families and has to be learned. |

**Safe fallback: `september11records.org`.** It is unregistered, and so is `.com`. It is
spelled in full, cannot be confused with emergency 911 calls, has no official-portal echo and
no conflicts found. It is long (18 characters) but impossible to misread or mis-spell once
heard.

### Defensive registrations

Assuming #1 wins, register these:

- **911records.org** as the primary.
- **sept11records.org** and **september11records.org** as 301 redirects. They catch people
  who say "September eleventh" rather than "nine-eleven", and they stop a third party taking
  a near-identical name. That matters in a space where truther sites operate (§ 4).
- **sept11records.com**, which is cheap, closes the one gap where a squatter could park a
  lookalike.
- **911records.nyc**, optional and as a redirect only (see the .nyc discussion in § 2).

Do **not** buy **911records.com** by default. $3,395 is a lot of money for a defensive
registration, and 2011-era parked `.com` names rarely go live. Revisit it only if it changes
hands. Skip hyphenated `9-11records.*`: nobody types it. Never register `sept11docs.*` or
`sept11documents.*`, even defensively. Holding the official portal's own slug would itself look
like impersonation. Note that **sept11docs.com was registered on 2026-09-11**, three days after
launch, by an unknown party at GoDaddy with default nameservers. It is worth watching, because
it may be used to pass itself off as the City's portal.

If #2 wins instead, mirror the pattern: sept11records.org and .com, plus 911records.org and
september11records.org as redirects.

### Main caveats

1. **Premium and pricing are unknown for every name.** RDAP cannot see premium tiers, so Henry
   must check at a registrar.
2. **"911" is also the emergency number.** A search for "911 records" returns emergency-call
   recordings (Kaggle datasets, FDNY call releases). Every 9/11 organisation lives with this,
   but it is the main argument for #2 or the fallback.
3. **The trademark check here is not a clearance search.** Public Trademarkia and Justia
   results were reviewed, but the USPTO search itself was not run. See § 5.
4. **9/11 Health Watch monitors the City's production of these records** under its
   court-supervised FOIL settlement with the City. It meets the City monthly for a year, and the
   judge keeps authority over the case. That is a monitoring role, not operation or approval of
   the portal (verified against the settlement statement, 2026-09-13). Its domain is
   `911healthwatch.org`. A `911<word>.org` name could be assumed to be
   theirs or the City's. The site needs a plain "Independent, not affiliated with the City of
   New York or 9/11 Health Watch" line in the header, not only the footer.

---

## 2. TLD trade-offs

| TLD | Rule | Fit |
|---|---|---|
| **.org** | Open to anyone | **Best fit.** It is the convention for 9/11 memorial, advocacy and archive sites, and readers associate it with public-interest work. If the site ever carries ads or charges, the `.org` expectation of a non-commercial site cuts slightly against it. |
| **.com** | Open | Most-typed by default, so it is worth holding when cheap. For a records tool it carries a faint commercial overtone. |
| **.nyc** | **Nexus required.** The registrant must be a person whose primary home is a physical NYC address (Category 1) or an entity with a physical NYC street address (Category 2). A P.O. box does not qualify. Nexus must hold for the whole registration. The registry spot-checks complaints, locks the name and deletes it if evidence isn't supplied. **Proxy registrations are not permitted**, although since May 2018 personal data is hidden from the first public WHOIS response. Henry's NYC businesses satisfy Category 2. | **Redirect only.** The City of New York is the sponsor of the TLD (the registry is run by GoDaddy Registry). A 9/11 records site on `.nyc` reads as a City site, which is the opposite of what an independent tool critical of past City conduct needs. It also leaves the name under a registry whose sponsor is the subject of the records, and the nexus process is complaint-driven. |
| **.us** | **Nexus required**: a US citizen or resident, a US organisation, or a foreign entity with a bona fide US presence. The registry runs random weekly checks. .us has long disallowed privacy/proxy registration (Henry should confirm the current rule with the registrar). | **Avoid as primary.** The official portal itself lives on `cityofnewyork.us`, so a `.us` name is the closest possible visual match to the government site. |
| **.info** | Open | Cheap, but it carries a spam reputation. It is a weak trust signal for families and lawyers. |
| **.net** | Open | Defensive value only. |
| **.law** | **Restricted** to verified licensed lawyers, law firms, courts, regulators and law schools, re-verified at renewal | **Henry is ineligible** unless a law-firm partner registers it, and the TLD would imply legal services. 911records.law is unregistered. |
| **.legal / .attorney / .lawyer** | Open, no verification | They imply a law practice or legal advertising, which is the wrong signal and invites the lawyer-lead-gen association. 911records.legal is unregistered. |
| **.fyi** | Open | Casual, which suits subway.fyi but is too light for this subject. 911records.fyi is unregistered. |
| **.memorial** | Open (Identity Digital) | **Reject.** It invites confusion with the National September 11 Memorial & Museum, and it is the wrong genre for a records instrument. |
| **.archive, .records, .library, .files** | **None of these appear in IANA's RDAP bootstrap file**, so they do not appear to be delegated, open TLDs | Not available. Use `.org` for the archive feel. |

---

## 3. Shortlist

Scoring gives 0–3 on each of five axes, for a total out of 15:
**A**vailability of the core TLDs; **C**larity (spoken aloud, spelling after one hearing,
length, no hyphen); **T**one (serious, non-sensational); **R**isk (impersonation and
trademark/confusion risk, where 3 is lowest risk); **D**urability (still fits as other
agencies' records arrive monthly).

Availability abbreviations: U = unregistered (RDAP 404 or WHOIS no data), **R** = registered.
All were checked 2026-09-13 ET.

| # | Name | TLDs checked | Direction | Availability | Conflicts found | Tone and impersonation notes | Score |
|---|---|---|---|---|---|---|---|
| 1 | **911records** | .org .com .net .info .nyc .us .law .fyi .legal | Descriptive | .org U · **.com R** (2011, HugeDomains listing, $3,395 shown) · .net U · .info U · .nyc U · .us U · .law U · .fyi U · .legal U | "911 Records", a 1996 US indie record label (Discogs), is a different field and appears inactive. There are emergency-call "911 records" datasets. No live 9/11 site or org of this name was found. | Neutral, and matches press usage. There is a slight sibling-look with 911healthwatch.org. It is not official-looking on .org. | A3 C3 T3 R2 D3 = **14** |
| 2 | **sept11records** | .org .com .net .info .nyc .us | Descriptive | All U | No site or org of this name found | Neutral. It echoes the official `sept11docs` / `sept11documents` slug, which is mitigated by the different noun and the non-government TLD. `sept` must be heard as "sept". | A3 C2 T3 R2 D3 = **13** |
| 3 | **september11records** | .org .com | Descriptive | .org U · .com U | None found | The most unambiguous form. Long. | A3 C2 T3 R3 D3 = **14**, but length makes it the fallback |
| 4 | **nineelevenrecords** | .org .com | Descriptive | .org U · .com U | None found | Unambiguous, but people may type "nine-eleven" with a hyphen, and it is 17 characters | A3 C1 T3 R3 D3 = **13** |
| 5 | **911readingroom** | .org .com .nyc | Civic archive | **.org R** (2024, unrelated lifestyle content site) · .com U · .nyc U | The .org is held by an unrelated content farm. NARA has an "Electronic Reading Room", a generic term. | Calm and civic. Families may land on the content-farm .org. | A2 C3 T3 R2 D3 = **13** |
| 6 | **911publicrecords** | .org .com .nyc | Descriptive / legal | All U | None found for this name | Accurate, though "public records" is the word stock of people-search sites. It is 16 characters. | A3 C2 T2 R3 D3 = **13** |
| 7 | **911folio** | .org .com .nyc | Brandable coinage | All U | None found | Serious and archival. The word has to be learned. | A3 C2 T3 R3 D2 = **13** |
| 8 | **911cityrecords** | .org .com .nyc | Civic archive | All U | None found | "City records" sounds like a City of New York property. Moderate impersonation look, **worst on .nyc**. | A3 C2 T3 R1 D2 = **11** |
| 9 | **911records.nyc** | .nyc | Descriptive + place | U | As #1 | The City-sponsored TLD makes it read as official. Nexus is satisfied by Henry's NYC business. Redirect only. | A3 C2 T3 R1 D3 = **12** |
| 10 | **sept11records.nyc** | .nyc | Descriptive + place | U | As #2 | Combines the official-slug echo with the City TLD. This is the highest official-look on the shortlist. | A3 C2 T3 R0 D3 = **11** |
| 11 | **911documents** | .org .com .nyc | Descriptive | All U | Near-identical to the official product name, "9/11 Document Portal". The "911 documents" phrase also sits alongside 911truth.org search results. | Too close to the City's own name for its portal | A3 C3 T2 R1 D3 = **12** |
| 12 | **911papers** | .org .com | Descriptive | .org U · **.com R** (2025, parked "may be for sale") | The .com is parked | "Papers" has a faint "Pentagon Papers" leak connotation, but is mostly fine | A2 C3 T2 R2 D3 = **12** |
| 13 | **911exhibits** | .org .com .nyc | Legal / exhibit | All U | The 9/11 Memorial & Museum's "Exhibitions" pages rank for this phrase. The museum sense dominates for families. | Lawyers read "trial exhibits", families read "museum" | A3 C3 T3 R1 D2 = **12** |
| 14 | **911airtests** | .org .com .nyc | Evidence / exposure | All U | None found | Clear, and exactly what DEP sampling is. It becomes too narrow once non-air records arrive. | A3 C3 T3 R3 D0 = **12** |
| 15 | **911airrecords** | .org .com | Evidence / exposure | .org U · .com U | None found | Same narrowness | A3 C2 T3 R3 D1 = **12** |
| 16 | **lowermanhattanrecords** | .org .com .nyc | Place-based | All U | None found | Respectful, but 21 characters. It does not say 9/11, and it excludes Staten Island landfill or other records that may come. | A3 C1 T3 R3 D1 = **11** |
| 17 | **groundzerorecords** | .org .com | Place-based | .org U · **.com R** (2004, redirects to HugeDomains) | "Ground Zero" is widely used by media and bars. It has no single owner. | Slightly media-brand. The .com is in aftermarket hands. | A2 C3 T2 R2 D2 = **11** |
| 18 | **wtcrecords** | .org .com .nyc | Place-based | All U | **Port Authority's WORLD TRADE CENTER / WTC marks** (upheld S.D.N.Y. 2018; licensed to WTCA). "WTC" also invites the WTC 7 truther genre (911research.wtc7.net). | Trademark exposure plus association risk | A3 C2 T2 R0 D2 = **9** |
| 19 | **wtcdocuments** | .org | Place-based | U | As #18 | As #18 | A2 C2 T2 R0 D2 = **8** |
| 20 | **911stacks** | .org .com | Brandable | .org U · .com U | None found | Library stacks, but "stacks" is also slang for money | A3 C2 T1 R3 D2 = **11** |
| 21 | **911ledger** | .org .com | Brandable | .org U · .com U | None found | Implies accounting or a liability tally, which is a verdict-adjacent frame | A3 C3 T1 R3 D2 = **12**, marked down for tone |
| 22 | **911casefile** | .org .com | Legal / exhibit | .org U · .com U | **Casefile True Crime**, a large podcast brand (casefilepodcast.com) | A true-crime connotation is wrong for a victims' audience | A3 C3 T0 R1 D2 = **9** |
| 23 | **sept11search** | .org | Descriptive (tool) | U | None found | Describes the tool, not the records. Generic. | A2 C2 T3 R2 D2 = **11** |
| 24 | **911recordsnyc** | .org .com | Descriptive + place | .org U · .com U | None found | "NYC" in a records name reads as a City property | A3 C1 T3 R1 D3 = **11** |

Ranking into the top 5 weighs the risk and clarity axes above raw score. That is why
`911documents` (12) sits below `911folio` (13), and why the fallback is the lowest-risk name
rather than the highest total.

**Social and code handles.** GitHub user and org names `911records`, `sept11records` and
`911readingroom` all returned 404 from the public GitHub API, meaning unclaimed. Bluesky can use
the domain itself as the handle. X, Instagram and Threads handles were **not checked**, because
they need a signed-in session.

---

## 4. Rejects (one line each)

### Impersonation (official look)

- **sept11docs.\*** / **sept11documents.\*** is the City's own slug (`nyc.gov/sept11docs`,
  `sept11documents.cityofnewyork.us`). *sept11docs.com was registered 2026-09-11 by a third
  party. sept11docs.org, sept11documents.com and sept11documents.org are unregistered, and
  should stay unregistered by us.*
- **911documentportal / 911portal** is the name of the City's product.
- **nyc911records / nyc911docs / 911recordsnyc.nyc** combine "NYC" and a records noun, which
  reads as a City site.
- **official911records / cityofnewyork911 / nyclaw911 / lawdept911** are banned patterns
  ("official", "cityofnewyork", Law Department).
- **911municipalarchive** collides with the NYC Municipal Archives (the Department of Records
  and Information Services).
- **911registry / wtcregistry** collide with the **World Trade Center Health Registry**
  (NYC Health Department).
- Any **.gov-like** or **.us** primary is too close to `cityofnewyork.us`.

### Trademark or organisation confusion

- **911memorial\*, 911museum\*, 911memorialrecords, anything .memorial** conflict with the
  National September 11 Memorial & Museum marks: 9/11 MEMORIAL (Reg. 5500957 and 5500958),
  9/11 MEMORIAL & MUSEUM (Reg. 6017601) and THE NATIONAL 9/11 FLAG (Reg. 3940211).
- **911healthrecords / wtchealthrecords** would be confused with the WTC Health Program and
  with 9/11 Health Watch (911healthwatch.org).
- **911vcfrecords / 911claimsrecords / vcfdocs** would be confused with the September 11th
  Victim Compensation Fund, a federal program.
- **tributeinlight\* / 911light** are Tribute in Light names.
- **voicesof911 / 911voices / 911livingmemorial** conflict with Voices of September 11th /
  Voices Center for Resilience (voicesofsept11.org, 9/11 Living Memorial).
- **911digitalarchive-alikes (911archive, sept11archive)** conflict with the September 11
  Digital Archive (CUNY and George Mason, 911digitalarchive.org, held by the Library of
  Congress).
- **wtcrecords / wtcdocuments / wtcarchive** are Port Authority WTC marks, as in the shortlist.
- **911casefile** conflicts with the Casefile True Crime podcast brand.
- **911index** (.com is a Porsche 911 parts directory) is .org-only and confusing.
- **dustandair** (.com is Dust and Air Productions, a production company) is vague and
  conflicting.
- **dustrecords** (.com is for sale on HugeDomains) sounds like a record label.

### Tone (sensational, conspiracy-adjacent or verdict framing)

- **911truth\*, 911truthfiles** are the truther brand. 911truth.org already runs an "AI
  Research Assistant" over "public records", so this is exactly the thing the project must not
  resemble.
- **911files / 911filesarchive** use the "files" framing of the Epstein and X-Files genre. An
  archive.org truther video collection is titled "9/11 Files Archive".
- **911datasets** was the name of a defunct truther NIST-FOIA mirror (911datasets.org).
- **wtc7records / wtc7docs** are the core truther subject, even though WTC 7 records are
  genuinely in the corpus.
- **911exposed, 911coverup, 911leaks, 911secrets, 911unsealed** are sensational (banned
  framing).
- **whattheyknew / theyknew911 / theairwasnotsafe** assert a conclusion the documents must be
  read to support. They are editorial, not instrumental.
- **911toxicrecords, 911poison** are sensational.
- **911asbestos** attracts mesothelioma lawyer lead-gen associations.
- **911discovery** is a litigation term, but reads as "revelation" and as the Discovery
  channel.
- **911evidence** implies adjudication.
- **911ledger** implies a liability tally (shortlisted, but marked down).
- **papertrail911** implies wrongdoing.
- **911research** shares the truther vocabulary (911research.wtc7.net).

### Practicality

- **9-11records.\*** is unregistered (.org and .com), but hyphens are never typed or heard.
  Defensive value is too low.
- **recordsof911.org** is unregistered, but the word order is unnatural when spoken.
- **the911records.org / .com** are unregistered, but "the" is dropped by listeners.
- **sept11papers.org** is unregistered, but it combines the `sept` hearing problem with the
  "papers" leak connotation.
- **groundzeroair.org** is unregistered, but narrow and slightly media-brand.
- **downtownrecords.nyc** is unregistered, but doesn't say 9/11 and has the City TLD.
- **911stacks / 911folio-style coinages (plume, afterdust, stillair, sifted, pagelight)** are
  mostly poetic. "Plume" and "afterdust" are evocative of the disaster itself, which is too
  aestheticised for families.
- **68boxes / boxes68** point to the 68 boxes found in 2025. The name is insider-clever,
  meaningless to newcomers, and dated once later tranches arrive.
- **911records.info** is unregistered, but .info is a weak trust signal.
- **911records.legal / .law** imply a law practice, and .law is closed to Henry.
- **lowermanhattan2001 / downtown2001** don't say records or 9/11.
- **911catalog / 911pages / 911library / 911commons / 911repository / 911findingaid /
  911accession** are not checked. They are either generic (catalog, pages), jargon (finding
  aid, accession) or long (repository). They were left as idea-pool only.
- **911search / 911docket / 911batesindex / 911citations / 911foilrecords** are not checked.
  They describe features rather than the corpus, and are lawyer jargon a family won't use.

### Full raw candidate pool (about 95 ideas)

- **Descriptive:** 911records, 911documents, 911docs, 911files, 911papers, 911readingroom,
  911recordroom, 911publicrecords, 911cityrecords, 911index, 911search, 911pages, 911library,
  911catalog, sept11records, sept11documents, sept11docs, sept11papers, sept11search,
  sept11index, september11records, nineelevenrecords, 9-11records, recordsof911, the911records,
  911recordsnyc.
- **Civic archive:** 911stacks, 911ledger, 911folio, 911registry, 911commons, 911repository,
  911docket, citypapers911, 911municipalarchive, 911publicarchive, 911findingaid, 911accession,
  911archive, sept11archive.
- **Evidence and exposure:** 911airrecords, 911airtests, 911airquality, 911dust, wtcdust,
  dustrecords, dustandair, groundzeroair, whattheyknew, theyknew911, theairwasnotsafe,
  911asbestos, 911exposurerecords, 911toxicrecords, 911samples, downtownairtests.
- **Brandable:** folio911, plume, afterdust, stillair, papertrail911, clearrecord, pagelight,
  lowerrecord, ledgerline, recordwise, sifted, 68boxes, boxes68.
- **Place-based:** lowermanhattanrecords, groundzerorecords, downtownrecords, wtcrecords,
  wtcdocuments, wtcarchive, wtc7records, libertystreetrecords, downtown2001,
  lowermanhattan2001.
- **Legal and exhibit:** 911exhibits, 911casefile, 911evidence, 911discovery, 911batesindex,
  911foilrecords, 911claimsrecords, 911vcfrecords, 911healthrecords, 911exhibitfinder,
  911citations.
- **Impersonation and tone (generated to be screened out):** nyc911records, nyc911docs,
  official911records, cityofnewyork911, nyclaw911, 911portal, 911documentportal, 911truthfiles,
  911exposed, 911coverup, 911leaks, 911secrets, 911unsealed, 911research, 911datasets,
  911memorialrecords, voicesof911, 911light.

---

## 5. Method and sources

### Availability

- **Endpoints.** RDAP endpoints were taken from IANA's bootstrap file
  (`data.iana.org/rdap/dns.json`) and queried directly at each registry:
  - Verisign for .com and .net
  - Public Interest Registry for .org
  - `rdap.nic.nyc` for .nyc
  - Identity Digital for .info, .legal and .fyi
  - `rdap.nic.law` for .law

  `.us` is not in the RDAP bootstrap, so it was checked with `whois -h whois.nic.us`.
- **Interpretation.** 200 means registered; for those, the registration date and status were
  recorded from the RDAP record. 404 means unregistered.
- **Volume.** 80 domain lookups plus one repeat to read the sept11docs.com registrar entity.
  All were sequential, 1.5 s apart.
- **Registered names.** For names found registered, the public homepage title was fetched to
  see whether each was live, parked or for sale. The one aftermarket price quoted (911records.com,
  $3,395) is what HugeDomains' public listing page displayed. Nothing was added to a cart.
- **Handles.** GitHub handles were checked with unauthenticated `api.github.com/users/<name>`
  calls (three calls).

### Conflicts and trademarks

- **Web searches.** Each shortlisted phrase and the main rejected families were searched on the
  web. Pages were fetched for the registered same-name domains: 911readingroom.org,
  911index.com, 911papers.com and dustandair.com.
- **Trademarks.** Justia Trademarks' search page returned HTTP 403 to automated fetch, so USPTO
  status came from public Trademarkia and Justia result pages surfaced by web search. **The
  USPTO Trademark Search system was not queried.**
  - Hits found: the Memorial & Museum marks listed in § 4, plus a cancelled "911" word mark
    (Reg. 1801379, a pest-control company, dead).
  - No results surfaced for 911 RECORDS, SEPT 11 RECORDS, 9/11 READING ROOM, 911 PUBLIC RECORDS
    or 911 FOLIO. That absence comes from search-result pages, not a clearance search.
  - Before investing in a brand, run the chosen word mark through USPTO Trademark Search
    (classes 41 and 42), or ask counsel for a knock-out search.
- **WTC marks.** The Port Authority's WORLD TRADE CENTER / WTC rights come from reporting on the
  2018 S.D.N.Y. decision in *World Trade Centers Association v. Port Authority*.

### Sources

- Official portal and release:
  [9/11 Document Portal](https://sept11documents.cityofnewyork.us/),
  [NYC Mayor's Office release](https://www.nyc.gov/mayors-office/news/2026/09/25-years-later--mamdani-administration-opens-city-s-9-11-records),
  [9/11 Health Watch settlement statement](https://www.911healthwatch.org/press/statement-on-historic-settlement-with-nyc-of-911-health-watchs-freedom-of-information-request-for-the-release-of-9-11-records/),
  [CNN](https://www.cnn.com/2026/09/09/us/9-11-documents-misled-air-what-we-know),
  [amNY](https://www.amny.com/news/9-11-public-portal-mamdani-releases-first-170000-pages-as-records-renew-questions-over-air-quality-warnings/),
  [NY1](https://ny1.com/nyc/all-boroughs/off-topic-on-politics/2026/09/11/mamdani-released-170k-pages-of-911-records-now-what)
- .nyc rules:
  [Namecheap .nyc requirements](https://www.namecheap.com/support/knowledgebase/article.aspx/9895/36/nyc-domain-registration-requirements/),
  [Dynadot .nyc restrictions](https://www.dynadot.com/help/question/nyc-domain-restrictions),
  [.nyc address rules (PDF)](https://www.encirca.com/pdfs/nyc-address-rules.pdf),
  [ownit.nyc proxy registration policy](https://www.ownit.nyc/policies/nyc-proxy-registration-policy),
  [Wikipedia: .nyc](https://en.wikipedia.org/wiki/.nyc),
  [101domain .nyc (reserved and premium tiers)](https://www.101domain.com/nyc-information-help.htm)
- .us rules:
  [usTLD Nexus Requirements Policy](https://www.about.us/doc/resources/ebooks/usTLD_Nexus_Requirements_Policy.pdf),
  [About.US nexus page](https://v2.about.us/policies/ustld-nexus-requirements)
- .law and .legal:
  [GoDaddy: About .LAW](https://www.godaddy.com/help/about-law-domains-32123),
  [register.domains legal TLD guide](https://register.domains/en/blog/legal-domain-extensions-complete-guide)
- Trademarks:
  [Trademarkia 9/11 MEMORIAL & MUSEUM](https://www.trademarkia.com/9-11-memorial-museum-88581954),
  [Trademarkia 9/11 MEMORIAL](https://www.trademarkia.com/9-11-memorial-87553456),
  [Justia 9/11 MEMORIAL Reg. 5500957](https://trademarks.justia.com/875/53/9-11-87553439.html),
  [Trademarkia THE NATIONAL 9/11 FLAG](https://www.trademarkia.com/the-national-9-11-flag-85052165),
  [Trademarkia owner list](https://www.trademarkia.com/owners/national-september-11-memorial-and-museum-at-the-world-trade-center),
  [Wolters Kluwer: Port Authority owns WORLD TRADE CENTER marks](https://lrus.wolterskluwer.com/news/ip-law-daily/port-authority-owns-rights-in-world-trade-center-marks/68785/)
- Existing 9/11 organisations and archives:
  [9/11 Memorial & Museum](https://www.911memorial.org/),
  [September 11 Digital Archive](https://911digitalarchive.org/),
  [Voices Center for Resilience](https://voicesofseptember11.org/),
  [Tribute in Light (Memorial page)](https://www.911memorial.org/visit/memorial/tribute-light),
  [NARA Electronic Reading Room](https://www.archives.gov/foia/electronic-reading-room)
- Conspiracy-adjacent sites to avoid resembling:
  [911Truth.org archive search](https://911truth.org/search-the-archive/),
  [AE911Truth](https://www1.ae911truth.org/en/about-us.html),
  [archive.org "9/11 Files Archive"](https://archive.org/details/20010911),
  [911datasets (archive.org)](https://archive.org/details/911datasets);
  see also `docs/research/epstein-explorers.md` § WEBB
- Name conflicts:
  [Discogs: 911 Records label](https://www.discogs.com/label/190928-911-Records),
  [Casefile True Crime](https://casefilepodcast.com/),
  [Kaggle: 911 Recordings](https://www.kaggle.com/datasets/louisteitelbaum/911-recordings)

---

## Addendum: the .nyc policies, read verbatim (2026-09-13)

Henry is leaning towards **911records.nyc**. So the registry's own policies were read from
ownit.nyc: the policy text is embedded in each page's HTML. Both 911records.nyc and
911records.org returned RDAP 404 (unregistered) on 2026-09-13.

**Who runs it.** ICANN's .nyc registry agreement names the Registry Operator as "The City of New
York … by and through the New York City Department of Information Technology &
Telecommunications". The City is the operator itself, not just a sponsor, and GoDaddy Registry
runs it technically.

**Prohibited uses (Acceptable Use Policy).** The list is standard anti-abuse:
- malware, phishing and fraud
- child abuse material
- illegal pharmaceutical sales
- IP infringement
- spam and hacking
- interfering with .nyc

Three items matter for this project:
- "Impersonate any person or entity …" The site must never look like the City's portal.
- "Violate the privacy or publicity rights of any other person or entity". This is directly
  relevant, because the documents contain PII the City missed.
- The catch-all: "Otherwise engage in activity that is contrary to applicable U.S., State or local
  law or .nyc Policies."

**Nothing in the text addresses criticism of the City, political speech or the City's
reputation.** An earlier summary of a different registry's policy (.OVH) claimed otherwise and
was discarded.

**Suspension powers.** The ".nyc Administrator reserves the right to deny, cancel or transfer any
registration … or place any domain name(s) on registry lock, hold or similar status, that it
deems necessary, in its discretion". The first ground is where it "reasonably concludes" use
appears to (i) conflict with the policy, (ii) threaten stability or security, or (iii) put users
at risk. The listed purposes also include:
- "to enforce .nyc Policies, as amended from time to time"
- "to protect the integrity and stability of the .nyc Registry Operator"
- to comply with court or administrative orders
- **"to establish, assert, or defend the legal rights of the .nyc Registry Operator or a third
  party, or to avoid any liability, civil or criminal, on the part of the .nyc Registry
  Operator"**

That last ground is the one to weigh. The Registry Operator is the City, and the City is a party
to 9/11 litigation. The text gives no content-based power, but this purpose is broad.

The City's actions would presumably also be constrained by the First Amendment. That is a legal
question for counsel and is not assessed here.

**Also in the Acceptable Use Policy** (confirmed against the rendered page Henry pasted):
- Registrants "agree to submit to proceedings commenced under the Uniform Dispute Resolution Policy
  ("UDRP"), and the Uniform Rapid Suspension Service ("URS")". Those are trademark-dispute
  processes. The URS can suspend a name quickly on a clear trademark claim, which is one more reason
  not to echo any City or third-party mark in the name or site.
- Registrants "consent to the collection, use, processing, and/or disclosure of your personal
  information in the United States and in accordance with the .nyc Privacy Policy".
- The Registry Operator "reserves the right, in its sole discretion, to take any administrative
  and operational actions necessary … in order to implement the Acceptable Use Policy".
- The Registration Rules add a required certification that the registrant "shall comply with the
  .nyc Nexus and Acceptable Use Policies".

**Accuracy.** The Registry Operator may "immediately deny, cancel, terminate, suspend, lock, or
transfer any Registration if it determines, in its sole discretion, that the information is
materially inaccurate".

**Policies can change.** Registrants agree the policies "may be modified by the .nyc Registry
Operator" and to comply with changes.

**Indemnity.** Registrants indemnify the Registry Operator against claims "arising out of or
relating to your use, operation, Registration of any name and/or website in the .nyc".

**Nexus.** The registrant may be "any natural person or legal entity, or organization or
association that can show an economic, cultural, historical, social or lawful connection to the
City of New York". This is broader than the resellers' "primary domicile / street address"
wording.

**Nexus enforcement is the most practical lever against the name**
([Nexus Policy and Enforcement](https://www.ownit.nyc/policies/nyc-nexus-policy-and-enforcement)).
- **Random spot check:** the name is locked, the registrant gets 30 days to show compliance, then
  30 more days to cure. After that the name is deleted.
- **Third-party complaint:** 10 days to show compliance and 10 days to cure, then "immediate
  deletion of the domain name".
- "The only remedy available is the deletion of the domain name". It is never transferred to the
  complainant.
- Anyone may also bring a formal challenge under the .nyc Nexus Dispute Resolution Policy, heard
  by the National Arbitration Forum, the listed dispute provider.

Evidence that counts ([Evidence Accepted](https://www.ownit.nyc/policies/nyc-evidence-accepted-for-nexus-checks))
includes business documents showing the organization's NYC address: a commercial lease, business
registration, invoices, or a letter from an employer. Documents must be "current (i.e. from within
the last two years)".

**Keep a nexus evidence pack on file, and watch the registrant email closely.** A 10-day complaint
window is short.
- "The existence of a P.O. Box address in the City of New York shall not qualify."
- Nexus must hold for the whole registration.
- A registrant may not "license, sub-delegate or otherwise transfer" the name to a non-qualifying
  party.

**Privacy.** ".nyc does not allow use of proxy, private or anonymous domain name registrations",
and the registry "employs an algorithm to detect" them.

What public lookups show was **checked live** on 2026-09-13 against a registered .nyc name
(`ownit.nyc`, via `rdap.nic.nyc`): the registrant's name field is empty or redacted in public
RDAP, and only the registrar's contact details are public. So the § 2 table's claim that personal
data is hidden from the public WHOIS response holds in practice, even though no policy states it.

Hidden from public lookup is not the same as private:
- the registry holds the full, accurate record, and the registry operator is the City;
- the site links a "Registration Data Disclosure Requests" channel for releasing it;
- the .nyc website privacy policy notes that submitted personal information "may become subject
  to FOIL".

Register through a business with an NYC street address, not a home address.

**Registration rules.** Registrants certify the name won't be used for "malware, abusively
operating botnets, phishing, piracy, trademark or copyright infringement, fraudulent or deceptive
practices, counterfeiting or otherwise engaging in activity contrary to applicable law". The rules
provide for "suspension or deletion" as consequences. This is ICANN's standard Specification 11
language.

**Net assessment.**
- **Usable.** 911records.nyc is usable. The text has no viewpoint or reputation clause.
- **Main risks:**
  - the City itself operates the registry, with broad "defend its legal rights / avoid its
    liability" and "as amended" powers
  - the privacy-rights clause, which a republished unredacted name would trigger
  - public registrant data
- **Mitigations:**
  - register 911records.org at the same time
  - keep DNS and hosting ready to switch canonical host, so a lock costs a DNS change rather
    than a rebrand
  - never republish unredacted PII, and run a fast takedown path
  - keep "Independent, not affiliated with the City of New York" in the header
  - register through an NYC business address

Sources:
[.nyc Acceptable Use Policy](https://www.ownit.nyc/policies/nyc-acceptable-use-policy) ·
[.nyc Nexus Policy](https://www.ownit.nyc/policies/nyc-nexus-policy) ·
[.nyc Proxy Registration Policy](https://www.ownit.nyc/policies/nyc-proxy-registration-policy) ·
[.nyc Registration Rules](https://www.ownit.nyc/policies/nyc-registration-rules) ·
[ICANN .nyc registry agreement](https://itp.cdn.icann.org/en/files/registry-agreements/nyc/nyc-agmt-html-redline-23jan14-en.htm) ·
[9/11 Health Watch settlement statement](https://www.911healthwatch.org/press/statement-on-historic-settlement-with-nyc-of-911-health-watchs-freedom-of-information-request-for-the-release-of-9-11-records/)
