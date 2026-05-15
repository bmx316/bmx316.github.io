"""Assemble per-episode Obsidian markdown from the DB + LLM enrichment."""

from __future__ import annotations

import json
import re
import sqlite3
from pathlib import Path

import yaml

from . import db
from .llm import EpisodeEnrichment, LLMClient

_SAFE = re.compile(r"[^A-Za-z0-9 _.-]+")
_SENT = re.compile(r"(?<=[.!?])\s+")


def _filename(ep: sqlite3.Row, enr: EpisodeEnrichment) -> str:
    parts = ["JRE"]
    if ep["episode_number"]:
        parts.append(f"#{ep['episode_number']}")
    label = enr.guest or ep["guest"] or ep["title"] or ep["external_id"]
    parts.append(label)
    name = _SAFE.sub("", " - ".join(parts)).strip()[:120]
    return f"{name}.md"


def _reflow(transcript: str) -> str:
    """If the transcript is one giant blob, group sentences into paragraphs
    so it is readable in Obsidian. Verbatim text is preserved."""
    if transcript.count("\n") > transcript.count(". ") / 4:
        return transcript.strip()
    sentences = _SENT.split(transcript.strip())
    paras = [" ".join(sentences[i : i + 5]) for i in range(0, len(sentences), 5)]
    return "\n\n".join(p for p in paras if p)


def _markdown(ep: sqlite3.Row, enr: EpisodeEnrichment) -> tuple[str, dict]:
    frontmatter = {
        "title": ep["title"] or f"JRE #{ep['episode_number']}",
        "podcast": "The Joe Rogan Experience",
        "episode": ep["episode_number"],
        "guest": enr.guest or ep["guest"] or "",
        "date": ep["published_date"] or "",
        "url": ep["url"] or "",
        "source": "kaggle",
        "tags": ["jre", "podcast-transcript"] + enr.tags,
    }
    fm = yaml.safe_dump(frontmatter, sort_keys=False, allow_unicode=True).strip()

    lines = [f"---\n{fm}\n---", ""]
    lines.append(f"# {frontmatter['title']}")
    if enr.guest:
        lines.append(f"\n**Guest:** [[{enr.guest}]]")
    lines.append(f"\n> {enr.one_line}")

    lines.append("\n## Summary\n")
    lines.append(enr.summary.strip())

    if enr.topics:
        lines.append("\n## Topics\n")
        lines += [f"- [[{t}]]" for t in enr.topics]

    if enr.key_takeaways:
        lines.append("\n## Key Takeaways\n")
        lines += [f"- {t}" for t in enr.key_takeaways]

    if enr.chapters:
        lines.append("\n## Chapters\n")
        for c in enr.chapters:
            lines.append(f"- **{c.title}** — {c.summary}")

    if enr.notable_quotes:
        lines.append("\n## Notable Quotes\n")
        for q in enr.notable_quotes:
            attr = " — ".join(x for x in (q.speaker, q.timestamp) if x)
            lines.append(f"> {q.text}" + (f"\n> \n> — {attr}" if attr else ""))
            lines.append("")

    lines.append("\n## Full Transcript\n")
    lines.append(_reflow(ep["transcript"]))
    lines.append("")
    return "\n".join(lines), frontmatter


def generate(
    db_path: Path,
    vault_dir: Path,
    client: LLMClient,
    only_new: bool = True,
    limit: int | None = None,
    force: bool = False,
) -> tuple[int, int]:
    """Generate markdown notes. Returns (written, failed)."""
    vault_dir.mkdir(parents=True, exist_ok=True)
    written = failed = 0
    with db.connect(db_path) as conn:
        episodes = db.iter_episodes(conn, only_ungenerated=only_new and not force, limit=limit)
        total = len(episodes)
        for i, ep in enumerate(episodes, 1):
            tag = ep["title"] or ep["external_id"]
            print(f"[{i}/{total}] {tag} ...", flush=True)
            try:
                result = client.enrich(ep["transcript"], dict(ep))
                body, fm = _markdown(ep, result.enrichment)
                out = vault_dir / _filename(ep, result.enrichment)
                out.write_text(body, encoding="utf-8")
                db.record_generation(
                    conn,
                    ep["id"],
                    provider=client.name,
                    model=client.model,
                    markdown_path=str(out),
                    frontmatter=json.dumps(fm, ensure_ascii=False),
                    summary=result.enrichment.summary,
                    input_tokens=result.input_tokens,
                    output_tokens=result.output_tokens,
                )
                conn.commit()
                written += 1
            except Exception as e:  # keep going; one bad episode shouldn't halt a long run
                print(f"  ! failed: {e}", flush=True)
                failed += 1
    return written, failed
