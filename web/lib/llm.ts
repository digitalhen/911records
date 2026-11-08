// The one place Ask's language model is chosen. Everything is env-driven so a
// deployer can point Ask at Claude (Anthropic API or Amazon Bedrock), OpenAI,
// or any OpenAI-compatible server (Ollama, vLLM, LM Studio, LiteLLM,
// OpenRouter) without code changes. See docs/MODELS.md.
//
//   LLM_PROVIDER   anthropic (default) | bedrock | openai
//   ASK_MODEL      model id; default per provider (below). LLM_MODEL is an alias.
//   LLM_BASE_URL   openai provider only: e.g. https://api.openai.com/v1 (default),
//                  http://ollama:11434/v1, http://localhost:8000/v1
//   LLM_API_KEY    openai provider: falls back to OPENAI_API_KEY; may be empty for
//                  local servers. anthropic provider: ANTHROPIC_API_KEY as before.
//   AWS_REGION     bedrock provider (credentials come from the standard AWS chain:
//                  instance/task role, AWS_PROFILE, or AWS_ACCESS_KEY_ID/...).
//   BEDROCK_ENDPOINT  invoke (default: bedrock-runtime InvokeModel, serves every Claude
//                  model on Bedrock incl. Haiku 4.5) | mantle (Bedrock's Messages-API
//                  endpoint; newer models, ids like anthropic.claude-haiku-5-5).
//
// Unset everything and you get exactly the original behaviour: Anthropic API,
// claude-haiku-4-5, ANTHROPIC_API_KEY.
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

export type LlmProvider = 'anthropic' | 'bedrock' | 'openai';

const env = (k: string) => process.env[k]?.trim() || '';

export const LLM_PROVIDER: LlmProvider = (() => {
  const p = env('LLM_PROVIDER').toLowerCase();
  if (!p || p === 'anthropic' || p === 'claude') return 'anthropic';
  if (p === 'bedrock' || p === 'aws') return 'bedrock';
  if (p === 'openai' || p === 'openai-compatible' || p === 'ollama') return 'openai';
  throw new Error(`LLM_PROVIDER=${p} is not one of anthropic, bedrock, openai`);
})();

const DEFAULT_MODEL: Record<LlmProvider, string> = {
  anthropic: 'claude-haiku-4-5',
  bedrock: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  openai: 'gpt-5-mini',
};

export const LLM_MODEL = env('ASK_MODEL') || env('LLM_MODEL') || DEFAULT_MODEL[LLM_PROVIDER];
const OPENAI_BASE_URL = (env('LLM_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
const OPENAI_API_KEY = env('LLM_API_KEY') || env('OPENAI_API_KEY');

/** Whether Ask can run at all. Ask stays hidden/disabled when this is false. */
export function llmConfigured(): boolean {
  if (LLM_PROVIDER === 'anthropic') return Boolean(env('ANTHROPIC_API_KEY'));
  if (LLM_PROVIDER === 'bedrock') return Boolean(env('AWS_REGION') || env('AWS_DEFAULT_REGION'));
  // A local OpenAI-compatible server needs no key; api.openai.com does.
  return Boolean(OPENAI_API_KEY || env('LLM_BASE_URL'));
}

/** Provider-neutral token usage, shaped like Anthropic's so stored rows and spend math are unchanged. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface StructuredResult<T> {
  data: T;
  model: string;
  usage: LlmUsage;
}

type MessagesClient = Pick<Anthropic, 'messages'>;
let claudeClient: MessagesClient | null = null;
async function claude(): Promise<MessagesClient> {
  if (claudeClient) return claudeClient;
  if (LLM_PROVIDER === 'bedrock') {
    const awsRegion = env('AWS_REGION') || env('AWS_DEFAULT_REGION');
    const sdk = await import('@anthropic-ai/bedrock-sdk');
    claudeClient = (env('BEDROCK_ENDPOINT').toLowerCase() === 'mantle'
      ? new sdk.AnthropicBedrockMantle({ awsRegion })
      : new sdk.AnthropicBedrock({ awsRegion })) as unknown as MessagesClient;
  } else {
    claudeClient = new Anthropic();
  }
  return claudeClient;
}

/** OpenAI's strict json_schema mode needs additionalProperties:false on every object. */
function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) if (k !== '$schema') out[k] = strictSchema(v);
  if (out.type === 'object') out.additionalProperties = false;
  return out;
}

async function openaiStructured<S extends z.ZodType>(
  name: string,
  system: string,
  user: string,
  schema: S,
  maxTokens: number,
): Promise<StructuredResult<z.infer<S>>> {
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(OPENAI_API_KEY ? { Authorization: `Bearer ${OPENAI_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_completion_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: { name, strict: true, schema: strictSchema(z.toJSONSchema(schema)) },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`llm: ${LLM_MODEL} at ${OPENAI_BASE_URL} returned HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const body = (await res.json()) as {
    choices?: { message?: { content?: string | null; refusal?: string | null } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
  };
  const msg = body.choices?.[0]?.message;
  if (!msg?.content) throw new Error(`llm: ${LLM_MODEL} returned no content${msg?.refusal ? ` (refusal: ${msg.refusal})` : ''}`);
  const data = schema.parse(JSON.parse(msg.content));
  const cached = body.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    data,
    model: LLM_MODEL,
    usage: {
      input_tokens: (body.usage?.prompt_tokens ?? 0) - cached,
      output_tokens: body.usage?.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: 0,
    },
  };
}

/**
 * One structured-output call: a cached system prompt, one user message, and a
 * zod schema the reply must satisfy. Throws when the model returns nothing
 * parseable, so callers keep their existing error handling.
 */
export async function structuredCall<S extends z.ZodType>(args: {
  name: string;
  system: string;
  user: string;
  schema: S;
  maxTokens: number;
}): Promise<StructuredResult<z.infer<S>>> {
  if (LLM_PROVIDER === 'openai') return openaiStructured(args.name, args.system, args.user, args.schema, args.maxTokens);

  const response = await (await claude()).messages.parse({
    model: LLM_MODEL,
    max_tokens: args.maxTokens,
    system: [{ type: 'text', text: args.system, cache_control: { type: 'ephemeral' } }],
    // Haiku 4.5 doesn't take `output_config.effort` (400 invalid_request_error)
    // — only the structured-output format is set here.
    output_config: { format: zodOutputFormat(args.schema) },
    messages: [{ role: 'user', content: args.user }],
  });
  const parsed = response.parsed_output;
  if (parsed == null) throw new Error(`llm: ${LLM_MODEL} returned no parseable ${args.name}`);
  return { data: parsed as z.infer<S>, model: LLM_MODEL, usage: response.usage };
}
