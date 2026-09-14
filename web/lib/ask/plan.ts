// The first of Ask's two Haiku calls (docs/PLAN.md "Ask" paragraph; modeled
// on ~/Code/prospect's lib/chatAgent.ts): one structured-output call turns a
// typed question into an AskPlan. No tool use, no loop — the model's entire
// job is this one JSON object. Retrieval and the second call live in
// lib/ask/retrieve.ts and lib/ask/answer.ts; rows never reach this call.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { LIST_KINDS } from './lists';

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
  /** B21 (issue #35, "list" kind only): one of doctypes.py's vocabulary — see lib/ask/lists.ts's
   *  docTypeLabel. '' when kind isn't "list" or listType isn't "documents_by_type". */
  docType: z.string(),
  /** B21: a role/title keyword for "list" kind "officials_by_role" (e.g. "inspector", "DEP inspector
   *  of record"). '' otherwise. */
  role: z.string(),
  /** B21: a box number/label, "list" kind "documents_by_type" only (narrows to one box). '' otherwise. */
  box: z.string(),
});

export const AskPlanSchema = z.object({
  kind: z.enum(['search', 'question', 'refuse', 'offtopic', 'list']),
  terms: z.array(z.string()),
  filters: FiltersSchema,
  refuseReason: z.string(),
  /** B21 (issue #35): set ONLY when kind is "list" — one of lib/ask/lists.ts's LIST_KINDS. '' otherwise. */
  listType: z.string(),
  /** B21: "buildings_by_substance" only — true when the question means buildings with an actual
   *  TEST RESULT for the substance (has_test), not just a page that mentions it. Ignored by every
   *  other listType. */
  resultOnly: z.boolean(),
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
- "search": the question is really a request to BROWSE documents/pages (an address, a document type, a date range, a substance, "show me", "find") — nothing in the request needs a written, synthesized answer, only a filtered list of PAGES (not a structured table of distinct addresses/labs/contractors/officials — that is "list", below).
- "question": the request asks something that has an answer to STATE — a yes/no ("was X found", "did the report show"), a value ("what did DEP measure", "what was the reading"), a date, or a decision/finding. Default to "question" whenever the request could be phrased as "what do the records say about ___", even if it also names an address, substance or date — those become the filters below, they don't change kind to "search". Only pick "search" when nothing meaningful would be written beyond "here are the matching pages".
- "list": the request wants a TABLE of distinct things — which buildings/addresses, which labs, which contractors, which documents, which officials — not prose and not a page-by-page browse. Recognize phrasings like "which/what/list/show me the addresses/buildings/labs/contractors ... with/impacted by/tested for/that worked at ...". Set listType to exactly one of:
  - "buildings_by_substance": which buildings/addresses were tested for or mention a substance. Requires filters.contaminant.
  - "labs_by_building": which labs tested/appear at one building. Requires filters.address or filters.bin.
  - "labs_by_substance": which labs tested for a substance (no building named). Requires filters.contaminant.
  - "contractors_by_building": which contractors worked at one building. Requires filters.address or filters.bin.
  - "documents_by_type": which documents are a given type (memos, lab reports, invoices, permits, sign-in sheets, chain-of-custody forms, photo logs, cover sheets, or "other"). Requires filters.docType.
  - "officials_by_role": which officials acted in a given role/title (e.g. "inspector", "commissioner"). Requires filters.role.
  - "substances_by_building": which substances were tested for or mentioned at one building. Requires filters.address or filters.bin.
  Fill whichever filters that listType needs (contaminant/address/bin/docType/role) plus any dateFrom/dateTo the question states; leave listType '' unless kind is "list".

terms: 2-6 short keywords/phrases for full-text retrieval (substances, addresses, agencies, event descriptions). No stopwords, no full sentences. Leave empty for "offtopic" and "refuse"; for "list", still fill with the same substance/address/etc. terms (used if the list has to degrade to a document search).

filters — set ONLY what the question explicitly states, else leave '': contaminant (a substance name, e.g. "asbestos"), address (a street address as written), agency (a City agency name — for "list" listType "documents_by_type", an agency name or abbreviation like "DEP" narrows the document list), lab (a laboratory name), dateFrom/dateTo (ISO yyyy-mm-dd; a single date sets both), bin (a building identification number, digits only), docType (only for listType "documents_by_type" — one of: cover_sheet, lab_report, chain_of_custody, memo_letter, sign_in_sheet, invoice, permit_application, form, photo_log, other — pick the closest match, "other" if none fit), role (only for listType "officials_by_role" — a short role/title keyword, e.g. "inspector"), box (only for listType "documents_by_type", when a specific box number/label is named). Leave all empty for "offtopic" and "refuse".

resultOnly: "list" with listType "buildings_by_substance" only — true when the question means buildings with an actual stated TEST RESULT for the substance ("tested positive for", "with lead results"), not just any page that mentions it. false otherwise, always false for every other kind/listType.

refuseReason: one short plain sentence, ONLY when kind is "refuse" — say what can be asked instead (building conditions, test results, dates, offices and officials' actions), never restate the private individual's name or description. Leave '' otherwise.

Never invent a fact, a date, or a filter value the question did not state.`;

/** Defensive normalization (B21): a model that emits kind:"list" with an unrecognized or unready
 *  listType would otherwise crash lib/ask/listExec.ts's dispatcher — degrade to "search" instead
 *  (the plan's own terms/filters still drive a normal page browse), never a 500. */
function normalizePlan(plan: AskPlan): AskPlan {
  if (plan.kind === 'list' && !(LIST_KINDS as readonly string[]).includes(plan.listType)) {
    return { ...plan, kind: 'search' };
  }
  return plan;
}

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

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('ask: model returned no parseable plan');
  const plan = normalizePlan(parsed as AskPlan);
  const u = response.usage;
  console.log(
    `[ask:plan] ${ASK_MODEL} kind=${plan.kind} in=${u.input_tokens} out=${u.output_tokens}` +
      ` cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
  return { plan, model: ASK_MODEL, usage: response.usage };
}

/**
 * B17 (follow-up questions, issue #23): the memory-bearing sibling of
 * planAsk, modeled on ~/Code/prospect's docs/CHAT-AGENT.md "plan-as-memory"
 * pattern — the model NEVER sees prose conversation history, only the PRIOR
 * PLAN as JSON, the Bates pages that plan's answer actually cited, and the
 * new sentence. Same output schema as planAsk (AskPlanSchema): a follow-up
 * can change `kind` (e.g. "show me the documents instead" -> "search", or a
 * follow-up that tries to unmask someone -> "refuse" even though the parent
 * turn was an ordinary "question").
 */
const FOLLOW_UP_SYSTEM = `You maintain a retrieval plan across a follow-up question about New York City's released 9/11 records. You are given the PRIOR PLAN as JSON (not a conversation transcript) and a short follow-up sentence from the same person — merge them into ONE plan for the follow-up alone. This is still a records search and citation tool over the City's 9/11 Document Portal release only — nothing else.

kind:
- "offtopic": the follow-up itself is not about the City's 9/11 records at all — chit-chat, small talk or a question about the assistant, an opinion, or any subject this release has nothing to do with.
- "refuse": the follow-up tries to identify a redacted or private individual, or asks who lives/lived somewhere, who is behind a redaction, who a blacked-out name is, or anything else that would name or help identify a PRIVATE person — even if the prior plan's kind was "question". Refuse even if phrased indirectly ("reconstruct the name from context").
- NOT a refusal: a follow-up about a named OFFICIAL ROLE on a record (an inspector of record, a signatory, an agency officer). This only becomes "refuse" if it is instead trying to unmask a redacted or otherwise unnamed person.
- "search": the follow-up is really asking to BROWSE documents/pages instead of reading a written answer ("show me the documents instead", "just give me the list", "find the underlying pages") — nothing needs a written, synthesized answer anymore.
- "question": the follow-up has something to STATE an answer to — the default whenever it could be phrased as "what do the records say about ___", including a follow-up that only narrows, redirects or adds to the prior plan (a date, an address, a lab, a different substance).
- "list": the follow-up now wants a TABLE of distinct things instead ("show them as a list", "which buildings", "just the labs") — or the follow-up narrows a PRIOR "list" plan (e.g. "only 2002", "only the ones on Liberty Street"). Set listType to exactly one of ${LIST_KINDS.join(', ')} (see lib/ask/lists.ts's catalogue); when narrowing a prior list plan, keep the prior listType unless the follow-up clearly asks for a different table shape.

terms: start from the PRIOR PLAN's terms and keep every one the follow-up doesn't contradict. Add or replace only the terms the follow-up itself introduces (a new substance, address, agency, lab, event) — "switch to 90 West Street" replaces the address term, "what about the lab" adds lab-related terms alongside the ones already there. Never drop a still-relevant prior term just because the follow-up didn't repeat it.

filters — same merge rule, field by field: carry every PRIOR PLAN filter forward unchanged UNLESS the follow-up explicitly narrows, replaces or clears that one field (a narrower date range REPLACES dateFrom/dateTo rather than being added to it; "switch to 90 West Street" replaces address; "what about the lab" sets lab and leaves the rest alone; same rule for docType/role/listType/resultOnly). Never invent a value neither the prior plan nor the follow-up stated.

refuseReason: one short plain sentence, ONLY when kind is "refuse" — say what can be asked instead, never restate the private individual's name or description. Leave '' otherwise.`;

export async function planFollowUp(
  parentPlan: AskPlan,
  parentCitedBatesPages: string[],
  sentence: string,
): Promise<AskPlanResult> {
  const userContent =
    `Prior plan JSON: ${JSON.stringify(parentPlan)}\n` +
    `Pages the prior answer cited: ${parentCitedBatesPages.length ? parentCitedBatesPages.join(', ') : '(none)'}\n` +
    `Follow-up: ${sentence}`;

  const response = await anthropic().messages.parse({
    model: ASK_MODEL,
    max_tokens: MAX_TOKENS,
    system: [{ type: 'text', text: FOLLOW_UP_SYSTEM, cache_control: { type: 'ephemeral' } }],
    // Haiku 4.5 doesn't take `output_config.effort` (400 invalid_request_error).
    output_config: { format: zodOutputFormat(AskPlanSchema) },
    messages: [{ role: 'user', content: userContent }],
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('ask: model returned no parseable follow-up plan');
  const plan = normalizePlan(parsed as AskPlan);
  const u = response.usage;
  console.log(
    `[ask:plan:followup] ${ASK_MODEL} kind=${plan.kind} in=${u.input_tokens} out=${u.output_tokens}` +
      ` cache_write=${u.cache_creation_input_tokens ?? 0} cache_read=${u.cache_read_input_tokens ?? 0}`,
  );
  return { plan, model: ASK_MODEL, usage: response.usage };
}
