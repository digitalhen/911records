import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAnswer, type AskAnswer } from './answer';

test('uncertainty context cannot bypass citation validation or become a direct answer', () => {
  const valid = { text: 'The retrieved report concerns air sampling in December.', cites: ['NYC-WTC_000000001'] };
  const answer: AskAnswer = {
    sentences: [],
    evidenceSummary: [valid,
      { text: 'An unsupported claim.', cites: [] },
      { text: 'A citation outside retrieval.', cites: ['NYC-WTC_000000002'] },
      { text: 'Mixed valid and invalid citations.', cites: ['NYC-WTC_000000001', 'NYC-WTC_000000002'] },
    ],
    notEstablished: ['These excerpts do not establish unit assignments for the requested day.'],
    followUps: [],
  };
  const result = validateAnswer(answer, new Set(['NYC-WTC_000000001']));
  assert.deepEqual(result.evidenceSummary, [valid]);
  assert.deepEqual(result.sentences, []);
  assert.deepEqual(validateAnswer(answer, new Set()).evidenceSummary, []);
});

test('older saved answers without an evidence summary retain their cited answer', () => {
  const answer: AskAnswer = {
    sentences: [{ text: 'A cited result.', cites: ['NYC-WTC_000000001'] }],
    notEstablished: [], followUps: [],
  };
  const result = validateAnswer(answer, new Set(['NYC-WTC_000000001']));
  assert.deepEqual(result.sentences, answer.sentences);
  assert.deepEqual(result.evidenceSummary, []);
});
