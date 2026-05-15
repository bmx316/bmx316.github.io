"""Parse whatever Kaggle gave us into the SQLite single source of truth.

The downloader has no control over a third-party dataset's layout, so the
ingester sniffs common shapes: CSV/TSV, JSON, JSONL, Parquet, or a directory
of .txt files. Column names are mapped heuristically.
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
import sqlite3
from pathlib import Path
from typing import Iterator, Optional

from . import db

csv.field_size_limit(50_000_000)  # transcripts are huge single cells

# Candidate source column names, in priority order, per logical field.
FIELD_ALIASES = {
    "transcript": ["transcript", "text", "content", "body", "captions", "subtitles"],
    "title": ["title", "episode_title", "name", "video_title"],
    "guest": ["guest", "guests", "guest_name", "interviewee"],
    "episode_number": ["episode_number", "episode", "number", "ep", "episode_no"],
    "published_date": ["published_date", "date", "upload_date", "published", "air_date"],
    "url": ["url", "link", "video_url", "youtube_url"],
}

_NUM_RE = re.compile(r"#?\s*(\d{1,5})")


def _pick(row: dict, names: list[str]) -> Optional[str]:
    lower = {k.lower().strip(): k for k in row}
    for n in names:
        if n in lower:
            v = row[lower[n]]
            if v is not None and str(v).strip():
                return str(v).strip()
    return None


def _episode_number(*candidates: Optional[str]) -> Optional[int]:
    for c in candidates:
        if not c:
            continue
        m = _NUM_RE.search(str(c))
        if m:
            return int(m.group(1))
    return None


def _external_id(source_file: str, row: dict, transcript: str) -> str:
    for key in ("id", "video_id", "url", "link"):
        for k in row:
            if k.lower().strip() == key and str(row[k]).strip():
                return f"{key}:{str(row[k]).strip()}"
    digest = hashlib.sha1(transcript[:4096].encode("utf-8", "ignore")).hexdigest()[:16]
    return f"{Path(source_file).name}:{digest}"


def _row_to_episode(row: dict, source_file: str) -> Optional[dict]:
    transcript = _pick(row, FIELD_ALIASES["transcript"])
    if not transcript or len(transcript.split()) < 50:
        return None
    title = _pick(row, FIELD_ALIASES["title"])
    return {
        "external_id": _external_id(source_file, row, transcript),
        "episode_number": _episode_number(
            _pick(row, FIELD_ALIASES["episode_number"]), title
        ),
        "title": title,
        "guest": _pick(row, FIELD_ALIASES["guest"]),
        "published_date": _pick(row, FIELD_ALIASES["published_date"]),
        "url": _pick(row, FIELD_ALIASES["url"]),
        "source_file": str(source_file),
        "transcript": transcript,
        "raw_metadata": row,
    }


def _iter_rows(path: Path) -> Iterator[dict]:
    suffix = path.suffix.lower()
    if suffix in (".csv", ".tsv"):
        delim = "\t" if suffix == ".tsv" else ","
        with path.open(newline="", encoding="utf-8", errors="replace") as f:
            yield from csv.DictReader(f, delimiter=delim)
    elif suffix == ".jsonl":
        with path.open(encoding="utf-8", errors="replace") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)
    elif suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
        rows = data if isinstance(data, list) else data.get("data", data.get("episodes", []))
        if isinstance(rows, dict):
            rows = list(rows.values())
        yield from (r for r in rows if isinstance(r, dict))
    elif suffix == ".parquet":
        try:
            import pandas as pd
        except ImportError as e:
            raise SystemExit("Parquet input needs pandas: pip install pandas pyarrow") from e
        for rec in pd.read_parquet(path).to_dict(orient="records"):
            yield rec
    elif suffix in (".txt", ".vtt", ".srt"):
        text = path.read_text(encoding="utf-8", errors="replace")
        yield {"title": path.stem, "transcript": text}


def ingest(raw_dir: Path, db_path: Path) -> tuple[int, int]:
    """Load every parseable file under raw_dir. Returns (new, skipped)."""
    files = sorted(
        p
        for p in raw_dir.rglob("*")
        if p.is_file()
        and p.suffix.lower() in (".csv", ".tsv", ".json", ".jsonl", ".parquet", ".txt", ".vtt", ".srt")
    )
    if not files:
        raise SystemExit(f"No ingestable files in {raw_dir}. Run `download` first.")

    new = skipped = 0
    with db.connect(db_path) as conn:
        for path in files:
            print(f"Reading {path.relative_to(raw_dir)} ...")
            try:
                for row in _iter_rows(path):
                    ep = _row_to_episode(row, path.relative_to(raw_dir))
                    if ep is None:
                        skipped += 1
                        continue
                    if db.upsert_episode(conn, ep):
                        new += 1
                    else:
                        skipped += 1
            except (sqlite3.Error, ValueError, json.JSONDecodeError) as e:
                print(f"  ! skipped {path.name}: {e}")
    return new, skipped
