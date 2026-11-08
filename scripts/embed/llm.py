"""llm.py — the one place the pipeline's language models are chosen (docs/MODELS.md).

Every model-calling stage (summaries, facts, topics, canonical, summaries_qa) asks this module for
its configuration by stage name, then calls `chat()`. Nothing here changes the prompts or the
parsing; it only decides where the prompt goes.

Resolution, per stage S (SUMMARIES, FACTS, TOPICS, CANONICAL), first match wins:

  provider   S_LLM_PROVIDER > legacy S_BACKEND > LLM_PROVIDER > the stage's built-in default
             one of: ollama | anthropic | bedrock | openai   (legacy "api" == anthropic;
             summaries.py additionally keeps its own "cli" and "codex" backends)
  model      S_LLM_MODEL > legacy S_OLLAMA_MODEL (ollama only) > LLM_MODEL > provider default
  base URL   S_LLM_BASE_URL > legacy S_OLLAMA_URL (ollama only) > LLM_BASE_URL >
             ollama: OLLAMA_URL or http://127.0.0.1:11434;  openai: https://api.openai.com/v1
  API key    anthropic: ANTHROPIC_API_KEY > CLAUDE_KEY_FILE > <repo>/.claudekey
             openai:    S_LLM_API_KEY > LLM_API_KEY > OPENAI_API_KEY (may be empty for local servers)
             bedrock:   the standard AWS credential chain; AWS_REGION required;
                        BEDROCK_ENDPOINT=invoke (default) | mantle
  prices     S_PRICE_IN_PER_MTOK / S_PRICE_OUT_PER_MTOK > LLM_PRICE_IN_PER_MTOK / ..._OUT_... >
             0 for ollama, Haiku 4.5 list price ($1 / $5) otherwise. Budgets (--budget-usd) apply
             only when the input price is above zero.

With none of these set, every stage behaves exactly as before this module existed.
"""
from __future__ import annotations

import json
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

DEFAULT_MODELS = {
    "ollama": "qwen3.5:35b-a3b",
    "anthropic": "claude-haiku-4-5-20251001",
    "bedrock": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "openai": "gpt-5-mini",
}
PROVIDERS = ("ollama", "anthropic", "bedrock", "openai")


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _first(*names: str) -> str:
    for n in names:
        if _env(n):
            return _env(n)
    return ""


@dataclass
class Stage:
    name: str
    provider: str
    model: str
    base_url: str
    api_key: str
    price_in: float   # USD per million input tokens
    price_out: float

    @property
    def paid(self) -> bool:
        return self.price_in > 0 or self.price_out > 0

    def cost(self, tok_in: int, tok_out: int) -> float:
        return (tok_in * self.price_in + tok_out * self.price_out) / 1_000_000

    def describe(self) -> str:
        where = f" @ {self.base_url}" if self.provider in ("ollama", "openai") else ""
        return f"{self.provider}:{self.model}{where}"


def _anthropic_key() -> str:
    if _env("ANTHROPIC_API_KEY"):
        return _env("ANTHROPIC_API_KEY")
    candidates = [Path(_env("CLAUDE_KEY_FILE"))] if _env("CLAUDE_KEY_FILE") else []
    candidates += [REPO / ".claudekey", REPO.parent.parent / "sept11-docs" / ".claudekey"]  # last: a worktree's main checkout
    for p in candidates:
        try:
            key = p.read_text().strip()
        except OSError:
            continue
        if key:
            return key
    return ""


def _price(stage: str, which: str, provider: str) -> float:
    raw = _first(f"{stage}_PRICE_{which}_PER_MTOK", f"LLM_PRICE_{which}_PER_MTOK")
    if raw:
        return float(raw)
    if provider == "ollama":
        return 0.0
    return 1.0 if which == "IN" else 5.0


def stage(name: str, default_provider: str, extra_providers: tuple[str, ...] = ()) -> Stage:
    """Resolve one stage's configuration from the environment (see the module docstring)."""
    S = name.upper()
    provider = _first(f"{S}_LLM_PROVIDER", f"{S}_BACKEND", "LLM_PROVIDER") or default_provider
    provider = provider.lower()
    if provider == "api":
        provider = "anthropic"
    if provider not in PROVIDERS + extra_providers:
        raise SystemExit(f"{S}: unknown LLM provider {provider!r}; use one of {', '.join(PROVIDERS + extra_providers)}")

    legacy_model = _env(f"{S}_OLLAMA_MODEL") if provider == "ollama" else ""
    model = _env(f"{S}_LLM_MODEL") or legacy_model or _env("LLM_MODEL") or DEFAULT_MODELS.get(provider, "")

    if provider == "ollama":
        base = _first(f"{S}_LLM_BASE_URL", f"{S}_OLLAMA_URL", "LLM_BASE_URL", "OLLAMA_URL") or "http://127.0.0.1:11434"
    elif provider == "openai":
        base = _first(f"{S}_LLM_BASE_URL", "LLM_BASE_URL") or "https://api.openai.com/v1"
    else:
        base = ""

    if provider == "anthropic":
        key = _anthropic_key()
    elif provider == "openai":
        key = _first(f"{S}_LLM_API_KEY", "LLM_API_KEY", "OPENAI_API_KEY")
    else:
        key = ""

    return Stage(S, provider, model, base.rstrip("/"), key, _price(S, "IN", provider), _price(S, "OUT", provider))


@dataclass
class Reply:
    text: str
    input_tokens: int
    output_tokens: int
    truncated: bool  # the reply hit max_tokens


_clients: dict[str, object] = {}


def _claude_client(st: Stage):
    """Anthropic SDK client for the anthropic and bedrock providers (cached per provider)."""
    if st.provider not in _clients:
        import anthropic
        if st.provider == "bedrock":
            region = _first("AWS_REGION", "AWS_DEFAULT_REGION") or None
            if _env("BEDROCK_ENDPOINT").lower() == "mantle":
                _clients[st.provider] = anthropic.AnthropicBedrockMantle(aws_region=region)
            else:
                _clients[st.provider] = anthropic.AnthropicBedrock(aws_region=region)  # needs `anthropic[bedrock]`
        else:
            if not st.api_key:
                raise RuntimeError("anthropic provider: set ANTHROPIC_API_KEY (or put the key in .claudekey)")
            _clients[st.provider] = anthropic.Anthropic(api_key=st.api_key)
    return _clients[st.provider]


def _post_json(url: str, body: dict, headers: dict, timeout: float) -> dict:
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", **headers})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


def chat(st: Stage, user: str, *, system: str | None = None, max_tokens: int = 4096,
         temperature: float = 0.2, num_ctx: int = 16384, timeout: float = 900) -> Reply:
    """One single-turn completion. `temperature` and `num_ctx` apply to Ollama only (the Claude
    paths keep their previous defaults, and many OpenAI models reject a non-default temperature)."""
    if st.provider == "ollama":
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
        data = _post_json(f"{st.base_url}/api/chat", {
            "model": st.model, "stream": False, "think": False, "messages": msgs,
            "options": {"temperature": temperature, "num_ctx": num_ctx, "num_predict": max_tokens},
        }, {}, timeout)
        return Reply(str(data.get("message", {}).get("content", "")), int(data.get("prompt_eval_count") or 0),
                     int(data.get("eval_count") or 0), data.get("done_reason") == "length")

    if st.provider == "openai":
        msgs = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": user}]
        headers = {"Authorization": f"Bearer {st.api_key}"} if st.api_key else {}
        data = _post_json(f"{st.base_url}/chat/completions",
                          {"model": st.model, "messages": msgs, "max_completion_tokens": max_tokens}, headers, timeout)
        choice = (data.get("choices") or [{}])[0]
        usage = data.get("usage") or {}
        return Reply(str((choice.get("message") or {}).get("content") or ""), int(usage.get("prompt_tokens") or 0),
                     int(usage.get("completion_tokens") or 0), choice.get("finish_reason") == "length")

    # anthropic / bedrock: the same Messages API through the Anthropic SDK.
    kwargs = {"model": st.model, "max_tokens": max_tokens, "messages": [{"role": "user", "content": user}]}
    if system:
        kwargs["system"] = system
    resp = _claude_client(st).messages.create(**kwargs)
    text = "".join(b.text for b in resp.content if b.type == "text")
    return Reply(text, resp.usage.input_tokens, resp.usage.output_tokens, resp.stop_reason == "max_tokens")


# ---------------------------------------------------------------------------------------------
# Embeddings (pages.py, folders.py, search.py, scripts/search/opensearch.py, and the web app's
# web/lib/embed.ts, which must use the SAME model and query prefix as the indexed page vectors).
#
#   EMBED_PROVIDER         ollama (default) | openai  (any OpenAI-compatible /v1/embeddings)
#   EMBED_URL              ollama: base URL (falls back to OLLAMA_URL, then http://localhost:11434);
#                          openai: base URL ending in /v1 (default https://api.openai.com/v1)
#   EMBED_MODEL            default nomic-embed-text; stored with every vector, so a new model
#                          simply re-embeds all pages on the next pages.py run
#   EMBED_DIM              default 768 (nomic-embed-text); the OpenSearch knn_vector dimension
#   EMBED_DOCUMENT_PREFIX / EMBED_QUERY_PREFIX / EMBED_CLUSTER_PREFIX
#                          nomic's task prefixes by default; set them to "" for most other models
#   EMBED_API_KEY          openai provider (falls back to OPENAI_API_KEY)
# ---------------------------------------------------------------------------------------------
EMBED_PROVIDER = "openai" if _env("EMBED_PROVIDER").lower() == "openai" else "ollama"
EMBED_URL = (_first("EMBED_URL", "OLLAMA_URL") or
             ("https://api.openai.com/v1" if EMBED_PROVIDER == "openai" else "http://localhost:11434")).rstrip("/")
EMBED_MODEL = _env("EMBED_MODEL") or "nomic-embed-text"
EMBED_DIM = int(_env("EMBED_DIM") or 768)
EMBED_PREFIX = {
    "document": os.environ.get("EMBED_DOCUMENT_PREFIX", "search_document: "),
    "query": os.environ.get("EMBED_QUERY_PREFIX", "search_query: "),
    "clustering": os.environ.get("EMBED_CLUSTER_PREFIX", "clustering: "),
}


def embed(texts: list[str], task: str = "document", timeout: float = 900) -> list[list[float]]:
    """Raw (un-normalised) embedding vectors, one per text, with the task prefix applied."""
    inputs = [f"{EMBED_PREFIX[task]}{t}" for t in texts]
    if EMBED_PROVIDER == "openai":
        key = _first("EMBED_API_KEY", "OPENAI_API_KEY")
        data = _post_json(f"{EMBED_URL}/embeddings", {"model": EMBED_MODEL, "input": inputs},
                          {"Authorization": f"Bearer {key}"} if key else {}, timeout)
        return [d["embedding"] for d in sorted(data["data"], key=lambda d: d.get("index", 0))]
    return _post_json(f"{EMBED_URL}/api/embed", {"model": EMBED_MODEL, "input": inputs}, {}, timeout)["embeddings"]
