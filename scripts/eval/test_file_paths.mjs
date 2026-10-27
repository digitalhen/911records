import assert from 'node:assert/strict';
import { agencyDir as mirrorAgencyDir } from '../lib/portal.mjs';
import { agencyDir, pdfPath, pageImagePath, textFileUrl } from '../../web/lib/files.ts';

// Compare the independent mirror and serving implementations at their boundary.
for (const agency of [null, '', 'Environmental Protection, Dept. of', 'Law Department',
  'Health and Mental Hygiene, Dept. of', "Children's Services, Administration for", 'Unknown Agency']) {
  const directory = mirrorAgencyDir(agency);
  assert.equal(agencyDir(agency), directory);
  assert.equal(pdfPath(agency, 'NYC-WTC0008', 'DOC'), `/files/pdf/${directory}/NYC-WTC0008/DOC.pdf`);
  assert.equal(pageImagePath(agency, 'NYC-WTC0008', 'DOC', 1), `/files/page/${directory}/NYC-WTC0008/DOC/1.webp`);
  assert.ok(textFileUrl(agency, 'NYC-WTC0008', 'DOC', '.boxes.jsonl').endsWith(`/text/${directory}/NYC-WTC0008/DOC.boxes.jsonl`));
}
console.log('Mirror and viewer paths agree for legacy, new, punctuation-bearing and missing agency labels.');
