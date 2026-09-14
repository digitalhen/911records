// The second of Ask's two Haiku calls: given <=12 retrieved page excerpts
// (lib/ask/retrieve.ts), write a cited answer. docs/PLAN.md's citation
// discipline is enforced here AND re-checked by the caller (lib/ask/route
// logic in app/ask/page.tsx): every sentence must cite a Bates page that was
// actually retrieved, or it is dropped — never rendered.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ASK_MODEL } from './plan';
import type { RetrievedPage } from './retrieve';
import { search } from '../opensearch';

const MAX_TOKENS = 2048;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

const AskAnswerSchema = z.object({
  sentences: z.array(
    z.object({
      text: z.string(),
      /** Bates page ids (e.g. "NYC-WTC_000058160"), must be from the retrieved set. */
      cites: z.array(z.string()),
    }),
  ),
  /** "What these records do not establish" — plain statements, no citations required. */
  notEstablished: z.array(z.string()),
  /** Short follow-up questions phrased for the same Ask box. */
  followUps: z.array(z.string()),
});

export type AskAnswer = z.infer<typeof AskAnswerSchema>;

export interface AskAnswerResult {
  answer: AskAnswer;
  model: string;
  usage: Anthropic.Usage;
}

const SYSTEM = `You write a short answer to a question about New York City's released 9/11 records, using ONLY the numbered page excerpts given to you. This is a citation-discipline tool, not a general assistant.

Rules, absolute:
- Every sentence in "sentences" MUST carry at least one cite, and every cite MUST be exactly one of the given Bates page ids. A sentence you cannot support with a given excerpt must not be written at all — leave it out rather than guess or generalize beyond the pages.
- Never state a fact, date, reading, or name that is not IN the excerpts. OCR text can be garbled; when an excerpt is unclear, say so or omit the point rather than guess.
- Never name, describe, or help identify a private individual, even if one appears to be named in an excerpt (a redaction failure). Officials named by role (inspector, signatory, agency officer) may be described by their role.
- "notEstablished": 1-4 short plain statements of what these specific pages do NOT show, when relevant (e.g. airborne exposure levels vs. bulk-material results, a specific person's presence). No citations needed — these are about absence.
- "followUps": 1-3 short questions the SAME retrieved pages could answer, phrased as something to type back into the Ask box.
- An excerpt that opens with a bracketed "BUILDING RECORD" note was attributed to the named building by the City's own filing (its folder). Treat it as a record FOR that building even when the page text shows a different address or none — describe what kind of record it is (a lab report, chain of custody, memo, sampling data), who produced it and any date or substance the excerpt shows, and cite it.
- If the excerpts do not actually support an answer to the question, return an empty "sentences" array — do not force an answer.
- Plain, factual prose. No markdown, no "as an AI", no claim that this cannot be wrong — the page image is the authority, not this summary.`;

export async function answerQuestion(question: string, pages: RetrievedPage[]): Promise<AskAnswerResult> {
  const excerptBlock = pages
    .map(
      (p, i) =>
        `[${i + 1}] Bates page: ${p.batesPage}\nDocument: ${p.folder || p.doc}${p.box ? ` (Box ${p.box})` : ''}\nExcerpt: ${p.excerpt}`,
    )
    .join('\n\n');

  const response = await anthropic().messages.parse({
    model: ASK_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Haiku 4.5 doesn't take `output_config.effort` (400 invalid_request_error).
    output_config: { format: zodOutputFormat(AskAnswerSchema) },
    messages: [
      {
        role: 'user',
        content: `Question: ${question}\n\nRetrieved page excerpts (cite by "Bates page" value only):\n\n${excerptBlock}`,
      },
    ],
  });

  const answer = response.parsed_output;
  if (!answer) throw new Error('ask: model returned no parseable answer');
  const u = response.usage;
  console.log(
    `[ask:answer] ${ASK_MODEL} sentences=${answer.sentences.length} in=${u.input_tokens} out=${u.output_tokens}` +
      ` cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
  return { answer: answer as AskAnswer, model: ASK_MODEL, usage: response.usage };
}

/**
 * Server-side citation validation (docs/PLAN.md rule 1, non-negotiable):
 * drops any sentence whose cites are not a non-empty subset of the retrieved
 * Bates pages. This is what actually enforces "an AI-written sentence cites
 * a page, or it is not shown" — the model's own compliance is necessary but
 * not sufficient.
 */
export function validateAnswer(answer: AskAnswer, retrievedBatesPages: Set<string>): AskAnswer {
  const sentences = answer.sentences.filter(
    (s) => s.cites.length > 0 && s.cites.every((c) => retrievedBatesPages.has(c)),
  );
  return { ...answer, sentences };
}

const MAX_FOLLOW_UPS = 3;

/**
 * B15 ("every suggested question/search must return results"): the model's
 * own "followUps" are written from the retrieved excerpts, not checked
 * against the index — a paraphrase the model chose can miss the corpus's
 * actual wording ("insufficient evidence" all over again, just one click
 * later). Runs a cheap lexical-only check (the same gate a bare /search box
 * query passes through — see opensearch.ts's `hasLexicalHit`) per candidate,
 * in parallel, and drops any with zero hits — never rendered, never stored.
 * Keeps at most MAX_FOLLOW_UPS, in the model's own order.
 */
export async function validateFollowUps(followUps: string[]): Promise<string[]> {
  const candidates = followUps.filter(Boolean).slice(0, MAX_FOLLOW_UPS * 2); // cap the fan-out
  const checked = await Promise.all(
    candidates.map(async (f) => {
      try {
        const r = await search({ q: f, pageSize: 1 });
        const hasResults = !r.error && !r.noSearchableTerms && !r.noLexicalMatch && r.total > 0;
        return hasResults ? f : null;
      } catch {
        return null; // fail closed: an unreachable index drops the follow-up, never shows a dead-end link
      }
    }),
  );
  return checked.filter((f): f is string => f !== null).slice(0, MAX_FOLLOW_UPS);
}
