# Models: what calls which model, and how to change it

Every model is chosen by environment variables. With none of them set, everything runs exactly as
911records.org does in production. Two code paths read them:

- the web app, in `web/lib/llm.ts` (Ask) and `web/lib/embed.ts` (search queries)
- the pipeline, in `scripts/embed/llm.py` (every model-calling stage and every embedding)

## The three model jobs

| Job | Where | Production default | Notes |
|---|---|---|---|
| **Ask**: plans a question, then writes a cited answer | web app, at request time | Anthropic `claude-haiku-4-5` | Two structured-output calls per question. Daily spend cap applies. |
| **Search embeddings**: one vector per page, and one per search query | pipeline (pages) + web app (queries) | Ollama `nomic-embed-text`, 768-d | **Pages and queries must use the same model.** |
| **Pipeline enrichment**: titles/summaries, test-result facts, topic names, name matching | pipeline only (offline) | Ollama `qwen3.5:35b-a3b` (summaries, facts, topics); Anthropic Haiku 4.5 (canonical matching) | Only needed to process new documents. A seeded deployment can skip it. |

## Ask (web app)

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `anthropic` (default) · `bedrock` · `openai` (OpenAI itself or any OpenAI-compatible server) |
| `ASK_MODEL` | Model id. Defaults: `claude-haiku-4-5` · `us.anthropic.claude-haiku-4-5-20251001-v1:0` · `gpt-5-mini` |
| `ANTHROPIC_API_KEY` | `anthropic` provider |
| `AWS_REGION`, `BEDROCK_ENDPOINT` | `bedrock` provider. Credentials come from the normal AWS chain (instance or task role, `AWS_PROFILE`, `AWS_ACCESS_KEY_ID`…). `BEDROCK_ENDPOINT=invoke` (default) serves every Claude model on Bedrock, Haiku 4.5 included; `mantle` uses Bedrock's Messages-API endpoint for newer models (ids like `anthropic.claude-haiku-5-5`). |
| `LLM_BASE_URL`, `LLM_API_KEY` / `OPENAI_API_KEY` | `openai` provider. Base URL defaults to `https://api.openai.com/v1`. Point it at `http://<host>:11434/v1` (Ollama), `http://<host>:8000/v1` (vLLM), LM Studio, LiteLLM, OpenRouter… A local server needs no key. |
| `ASK_DAILY_USD_CAP` | Daily cap, estimated from the prices below. Default 5. |
| `ASK_PRICE_INPUT_PER_MTOK`, `ASK_PRICE_OUTPUT_PER_MTOK` | USD per million tokens. Defaults are Haiku 4.5's ($1 / $5). Set them for any other model; `0` for a local one. |

Ask needs a model that follows a JSON schema reliably. On the OpenAI path the request uses
`response_format: json_schema` (strict), and the reply is validated against the same zod schema
the Claude path uses. A reply that fails validation becomes an error, never a half-rendered
answer. Every answer sentence must still cite a retrieved page or it is dropped
(`validateAnswer`), whatever the model.

Tested (2026-11-08): Anthropic Haiku 4.5, and Ollama `qwen2.5:7b-instruct` through `/v1`. The
two produced the same plan for a sample question. Small local models (≤3B) tend to miss the schema.
Bedrock was not exercised end to end: no AWS credentials here.

When none of the provider's credentials are present, Ask turns itself off and the site degrades to
search, as before.

## Search embeddings

| Variable | Default | |
|---|---|---|
| `EMBED_PROVIDER` | `ollama` | or `openai` for any `/v1/embeddings` server |
| `EMBED_URL` | `OLLAMA_URL`, else `http://127.0.0.1:11434` | base URL; for `openai`, ends in `/v1` |
| `EMBED_MODEL` | `nomic-embed-text` | |
| `EMBED_DIM` | `768` | pipeline only: the OpenSearch vector dimension |
| `EMBED_QUERY_PREFIX` / `EMBED_DOCUMENT_PREFIX` / `EMBED_CLUSTER_PREFIX` | nomic's `search_query: ` / `search_document: ` / `clustering: ` | set to empty for most other models |
| `EMBED_API_KEY` | `OPENAI_API_KEY` | `openai` provider |

**The seed's vectors are nomic-embed-text.** Keep that model to use them as they are. It is
274 MB and fast enough on CPU for queries; any Ollama, or an OpenAI-compatible server hosting
nomic, will do. To switch models, set the variables above for both the pipeline and the app, then
run `scripts/embed/pages.py` (it re-embeds every page: each vector is stored with its model name)
and `scripts/search/opensearch.py setup --recreate && ... index`.

## Pipeline stages

Each stage reads its own variables first, then the shared ones:

| Stage | Script | Default |
|---|---|---|
| `SUMMARIES` | `scripts/embed/summaries.py`, `summaries_qa.py` | `anthropic` (the daily refresh sets it to `ollama`) |
| `FACTS` | `scripts/embed/facts.py` | `ollama` |
| `TOPICS` | `scripts/embed/topics.py` | `ollama` |
| `CANONICAL` | `scripts/embed/canonical_llm.py` | `anthropic` |

For a stage `S`, first match wins:

- **provider:** `S_LLM_PROVIDER` > legacy `S_BACKEND` (`api` means anthropic) > `LLM_PROVIDER` > the default above. Values: `ollama`, `anthropic`, `bedrock`, `openai`. Summaries also keeps `cli` (`claude -p`) and `codex`.
- **model:** `S_LLM_MODEL` > legacy `S_OLLAMA_MODEL` > `LLM_MODEL` > `qwen3.5:35b-a3b` / `claude-haiku-4-5-20251001` / `us.anthropic.claude-haiku-4-5-20251001-v1:0` / `gpt-5-mini`.
- **endpoint:** `S_LLM_BASE_URL` > legacy `S_OLLAMA_URL` > `LLM_BASE_URL` > `OLLAMA_URL` (for ollama).
- **key:** Anthropic: `ANTHROPIC_API_KEY` > `CLAUDE_KEY_FILE` > `.claudekey`. OpenAI: `S_LLM_API_KEY` > `LLM_API_KEY` > `OPENAI_API_KEY`.
- **price:** `S_PRICE_IN_PER_MTOK` / `S_PRICE_OUT_PER_MTOK` > `LLM_PRICE_*` > 0 for ollama, $1 / $5 otherwise. `--budget-usd` stops a paid run at its cap.

Example: run everything on OpenAI.

```sh
export LLM_PROVIDER=openai LLM_MODEL=gpt-5-mini OPENAI_API_KEY=sk-...
export LLM_PRICE_IN_PER_MTOK=0.25 LLM_PRICE_OUT_PER_MTOK=2
```

Every summary row records the model that wrote it (`model` in `p5-summaries.jsonl`).
