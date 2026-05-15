# JRE Transcript Pipeline

Download every Joe Rogan Experience transcript from Kaggle, consolidate them
into **one SQLite database** (the single source of truth, every transcript
stored verbatim), then use AI to emit one **Obsidian-ready markdown note per
episode** — frontmatter, summary, topics, key takeaways, notable quotes with
timestamps, chapter breakdown, and the full transcript.

```
Kaggle dataset ──download──▶ data/raw/*  ──ingest──▶ data/jre.db ──generate──▶ obsidian/*.md
```

## Why SQLite as the "single source"

One file, queryable, durable, and it holds every full transcript plus all
metadata and generation state. The AI step reads from it and writes Markdown;
re-running only processes episodes that don't have a note yet, so a large run
is resumable and you never pay to regenerate work.

## Setup

```bash
cd jre_transcripts
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # then edit .env
```

Fill in `.env`:

- **Kaggle**: `KAGGLE_USERNAME` + `KAGGLE_KEY` (from
  <https://www.kaggle.com/settings> → "Create New Token"), or drop
  `kaggle.json` at `~/.kaggle/kaggle.json`.
- **`JRE_KAGGLE_DATASET`**: the dataset slug (`owner/dataset-name`). Discover
  candidates:

  ```bash
  python -m jre_pipeline search "joe rogan transcript"
  ```

- **LLM**: `LLM_PROVIDER=anthropic` (default) + `ANTHROPIC_API_KEY`, or
  `LLM_PROVIDER=openai` + `OPENAI_API_KEY`. Override the model with
  `LLM_MODEL` if you want.

## Usage

```bash
# one shot: download -> ingest -> generate everything
python -m jre_pipeline all

# or step by step
python -m jre_pipeline download
python -m jre_pipeline ingest
python -m jre_pipeline generate --limit 5     # try a few first
python -m jre_pipeline generate               # the rest (resumable)

python -m jre_pipeline status
```

Point Obsidian at the `obsidian/` folder (or set `JRE_VAULT_DIR`) and the
notes link to each other through `[[guest]]` and `[[topic]]` wikilinks plus
shared tags, so the graph view connects related episodes.

## Notes

- **Provider-agnostic by request.** The Claude backend is the default and is
  built to Anthropic best practices (`claude-opus-4-7`, adaptive thinking, a
  prompt-cached system prompt so the instruction block is billed once across
  the run). An OpenAI backend is included behind the same interface.
- **Robust ingest.** Kaggle datasets vary in layout; the ingester sniffs
  CSV/TSV, JSON, JSONL, Parquet, and folders of `.txt`/`.vtt`/`.srt`, and maps
  columns heuristically. Parquet input also needs `pandas` + `pyarrow`.
- The full transcript is stored and emitted **verbatim** (only reflowed into
  paragraphs for readability if the source was one unbroken blob). The AI adds
  structure around it; it does not rewrite the words.
- `data/` and `obsidian/` are git-ignored — they're generated artifacts.
