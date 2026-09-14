// The first of Ask's two Haiku calls (docs/PLAN.md "Ask" paragraph; modeled
// on ~/Code/prospect's lib/chatAgent.ts): one structured-output call turns a
// typed question into an AskPlan. No tool use, no loop — the model's entire
// job is this one JSON object. Retrieval and the second call live in
// lib/ask/retrieve.ts and lib/ask/answer.ts; rows never reach this call.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// docs/PLAN.md default; overridable per docs/PLAN.md's env table. Kept
// undated (no `-20251001` suffix) to track whatever Haiku 4.5 currently
// resolves to, matching the plan's own `claude-haiku-4-5`.
export const ASK_MODEL = process.env.ASK_MODEL || 'claude-haiku-4-5';
const MAX_TOKENS = 1024;

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic();
  return client;
}

export function askConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Every field required, none optional/nullable — same reasoning as
 * prospect's ChatPlan QuerySchema: structured-output schemas are simplest
 * when "unset" is a sentinel (empty string / empty array) rather than an
 * optional field, and it keeps the JSON schema small and reliable.
 */
const FiltersSchema = z.object({
  contaminant: z.string(),
  address: z.string(),
  agency: z.string(),
  lab: z.string(),
  dateFrom: z.string(),
  dateTo: z.string(),
  bin: z.string(),
});

export const AskPlanSchema = z.object({
  kind: z.enum(['search', 'question', 'refuse', 'offtopic']),
  terms: z.array(z.string()),
  filters: FiltersSchema,
  refuseReason: z.string(),
});

export type AskFilters = z.infer<typeof FiltersSchema>;
export type AskPlan = z.infer<typeof AskPlanSchema>;

export interface AskPlanResult {
  plan: AskPlan;
  model: string;
  usage: Anthropic.Usage;
}

/**
 * Deliberately terse and byte-stable (cached): every line is paid for on
 * every question. The privacy rule is the one line that must never be
 * softened — docs/PLAN.md rule 3 and COMMON-web.md are both explicit that
 * identity questions about redacted or private individuals are refused,
 * never answered "carefully".
 */
const SYSTEM = `You turn a question about New York City's released 9/11 records into a retrieval plan. This is a records search and citation tool over the City's 9/11 Document Portal release only — nothing else.

kind:
- "offtopic": the request is not about the City's 9/11 records at all — chit-chat, small talk or a question about the assistant itself ("do you like jesus", "tell me a joke", "who are you"), an opinion, or any subject this release has nothing to do with. Use "offtopic" instead of forcing it into "search" or "question" — never invent search terms for a request that isn't about the records just because it contains a real word.
- "refuse": the question tries to identify a redacted or private individual, or asks who lives/lived somewhere, who is behind a redaction, who a blacked-out name is, or anything else that would name or help identify a PRIVATE person (a resident, patient, tenant, unnamed signer). Refuse even if phrased indirectly ("reconstruct the name from context", "whose apartment is this").
- NOT a refusal: a question about a named OFFICIAL ROLE on a record — an inspector of record, a signatory, an agency officer, who signed/authored/approved a document in their professional capacity. "Who signed the inspection report as inspector of record" is a "question" (or "search"), never "refuse" — the record already names officials by role; this only becomes "refuse" if the question is instead trying to unmask a redacted or otherwise unnamed person.
- "search": the question is really a request to BROWSE documents/pages (an address, a document type, a date range, a substance, "show me", "find") — nothing in the request needs a written, synthesized answer, only a filtered list.
- "question": the request asks something that has an answer to STATE — a yes/no ("was X found", "did the report show"), a value ("what did DEP measure", "what was the reading"), a date, or a decision/finding. Default to "question" whenever the request could be phrased as "what do the records say about ___", even if it also names an address, substance or date — those become the filters below, they don't change kind to "search". Only pick "search" when nothing meaningful would be written beyond "here are the matching pages".

terms: 2-6 short keywords/phrases for full-text retrieval (substances, addresses, agencies, event descriptions). No stopwords, no full sentences. Leave empty for "offtopic" and "refuse".

filters — set ONLY what the question explicitly states, else leave '': contaminant (a substance name, e.g. "asbestos"), address (a street address as written), agency (a City agency name), lab (a laboratory name), dateFrom/dateTo (ISO yyyy-mm-dd; a single date sets both), bin (a building identification number, digits only). Leave all empty for "offtopic" and "refuse".

refuseReason: one short plain sentence, ONLY when kind is "refuse" — say what can be asked instead (building conditions, test results, dates, offices and officials' actions), never restate the private individual's name or description. Leave '' otherwise.

Never invent a fact, a date, or a filter value the question did not state.`;

export async function planAsk(question: string): Promise<AskPlanResult> {
  const response = await anthropic().messages.parse({
    model: ASK_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Haiku 4.5 doesn't take `output_config.effort` (400 invalid_request_error)
    // — only the structured-output format is set here.
    output_config: { format: zodOutputFormat(AskPlanSchema) },
    messages: [{ role: 'user', content: question }],
  });

  const plan = response.parsed_output;
  if (!plan) throw new Error('ask: model returned no parseable plan');
  const u = response.usage;
  console.log(
    `[ask:plan] ${ASK_MODEL} kind=${plan.kind} in=${u.input_tokens} out=${u.output_tokens}` +
      ` cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
  return { plan: plan as AskPlan, model: ASK_MODEL, usage: response.usage };
}
