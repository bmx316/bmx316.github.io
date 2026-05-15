"""Provider-agnostic enrichment.

`enrich()` turns a raw transcript + metadata into a structured EpisodeEnrichment
via a single LLM call. Two backends are provided behind one interface:

  * anthropic (default) - Claude, built to Anthropic best practices:
    claude-opus-4-7, adaptive thinking, and a prompt-cached system prompt so
    the (large, stable) instruction block is billed once across the run.
  * openai - GPT via structured outputs.

Select with LLM_PROVIDER; override the model with LLM_MODEL.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Protocol

from pydantic import BaseModel, Field


class Quote(BaseModel):
    text: str = Field(description="A memorable verbatim quote from the episode.")
    speaker: str = Field(description="Who said it (best guess: 'Joe Rogan', the guest, or 'Unknown').")
    timestamp: str = Field(description="Approx timestamp like '01:14:30' if inferable from the transcript, else ''.")


class Chapter(BaseModel):
    title: str = Field(description="Short topic/segment title.")
    summary: str = Field(description="1-2 sentence summary of this segment.")


class EpisodeEnrichment(BaseModel):
    guest: str = Field(description="Primary guest name(s). Empty string if none/unknown.")
    one_line: str = Field(description="A single punchy sentence describing the episode.")
    summary: str = Field(description="3-6 paragraph narrative summary of the conversation.")
    topics: List[str] = Field(description="5-15 core topics discussed (short noun phrases).")
    key_takeaways: List[str] = Field(description="5-12 concrete takeaways or claims made.")
    notable_quotes: List[Quote] = Field(description="3-10 notable quotes.")
    chapters: List[Chapter] = Field(description="Chronological segment breakdown.")
    tags: List[str] = Field(description="8-20 Obsidian tags WITHOUT the '#', kebab-case.")


SYSTEM_PROMPT = """\
You are an expert podcast archivist building an Obsidian knowledge base from \
Joe Rogan Experience (JRE) transcripts.

Given one episode transcript, produce a faithful, richly structured analysis.
Rules:
- Be accurate. Do not invent facts, guests, or quotes not supported by the transcript.
- Quotes must be verbatim (you may trim with no internal paraphrasing).
- Timestamps: only fill one in if the transcript contains timing markers you can
  map to; otherwise use an empty string. Never fabricate timing.
- Topics/tags should be reusable across episodes so the Obsidian graph connects
  related episodes (e.g. 'mma', 'psychedelics', 'ai', 'comedy', 'fitness').
- Tags are kebab-case, no '#', no spaces.
- Summary is for someone who has not listened: cover the arc, key arguments,
  disagreements, and standout moments.
Return only the structured object requested."""


@dataclass
class EnrichResult:
    enrichment: EpisodeEnrichment
    input_tokens: int
    output_tokens: int


class LLMClient(Protocol):
    name: str
    model: str

    def enrich(self, transcript: str, meta: dict) -> EnrichResult: ...


def _user_prompt(transcript: str, meta: dict) -> str:
    head = []
    if meta.get("title"):
        head.append(f"Known title: {meta['title']}")
    if meta.get("episode_number"):
        head.append(f"Episode #: {meta['episode_number']}")
    if meta.get("guest"):
        head.append(f"Hinted guest: {meta['guest']}")
    if meta.get("published_date"):
        head.append(f"Published: {meta['published_date']}")
    header = "\n".join(head)
    return f"{header}\n\n--- TRANSCRIPT START ---\n{transcript}\n--- TRANSCRIPT END ---"


class AnthropicClient:
    name = "anthropic"

    def __init__(self, model: str) -> None:
        import anthropic

        self.model = model
        self._client = anthropic.Anthropic()

    def enrich(self, transcript: str, meta: dict) -> EnrichResult:
        resp = self._client.messages.parse(
            model=self.model,
            max_tokens=8000,
            thinking={"type": "adaptive"},
            system=[
                {
                    "type": "text",
                    "text": SYSTEM_PROMPT,
                    "cache_control": {"type": "ephemeral"},
                }
            ],
            messages=[{"role": "user", "content": _user_prompt(transcript, meta)}],
            output_format=EpisodeEnrichment,
        )
        if resp.parsed_output is None:
            raise RuntimeError(f"Anthropic returned no parsed output (stop={resp.stop_reason})")
        return EnrichResult(
            enrichment=resp.parsed_output,
            input_tokens=resp.usage.input_tokens,
            output_tokens=resp.usage.output_tokens,
        )


class OpenAIClient:
    name = "openai"

    def __init__(self, model: str) -> None:
        from openai import OpenAI

        self.model = model
        self._client = OpenAI()

    def enrich(self, transcript: str, meta: dict) -> EnrichResult:
        resp = self._client.beta.chat.completions.parse(
            model=self.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _user_prompt(transcript, meta)},
            ],
            response_format=EpisodeEnrichment,
        )
        parsed = resp.choices[0].message.parsed
        if parsed is None:
            raise RuntimeError("OpenAI returned no parsed output")
        usage = resp.usage
        return EnrichResult(
            enrichment=parsed,
            input_tokens=getattr(usage, "prompt_tokens", 0),
            output_tokens=getattr(usage, "completion_tokens", 0),
        )


def make_client(provider: str, model: str) -> LLMClient:
    if provider == "anthropic":
        return AnthropicClient(model)
    if provider == "openai":
        return OpenAIClient(model)
    raise SystemExit(f"Unknown LLM_PROVIDER '{provider}' (use 'anthropic' or 'openai').")
