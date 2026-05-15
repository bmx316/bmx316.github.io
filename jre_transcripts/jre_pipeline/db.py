"""SQLite single source of truth for all transcripts + generation state."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator, Optional

SCHEMA = """
CREATE TABLE IF NOT EXISTS episodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id     TEXT UNIQUE NOT NULL,
    episode_number  INTEGER,
    title           TEXT,
    guest           TEXT,
    published_date  TEXT,
    url             TEXT,
    source_file     TEXT,
    transcript      TEXT NOT NULL,
    word_count      INTEGER,
    raw_metadata    TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation (
    episode_id     INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
    provider       TEXT,
    model          TEXT,
    markdown_path  TEXT,
    frontmatter    TEXT,
    summary        TEXT,
    input_tokens   INTEGER,
    output_tokens  INTEGER,
    generated_at   TEXT DEFAULT (datetime('now'))
);
"""


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        conn.executescript(SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()


def upsert_episode(conn: sqlite3.Connection, ep: dict) -> bool:
    """Insert an episode keyed by external_id. Returns True if newly inserted."""
    cur = conn.execute(
        """
        INSERT INTO episodes
            (external_id, episode_number, title, guest, published_date,
             url, source_file, transcript, word_count, raw_metadata)
        VALUES (:external_id, :episode_number, :title, :guest, :published_date,
                :url, :source_file, :transcript, :word_count, :raw_metadata)
        ON CONFLICT(external_id) DO NOTHING
        """,
        {
            "external_id": ep["external_id"],
            "episode_number": ep.get("episode_number"),
            "title": ep.get("title"),
            "guest": ep.get("guest"),
            "published_date": ep.get("published_date"),
            "url": ep.get("url"),
            "source_file": ep.get("source_file"),
            "transcript": ep["transcript"],
            "word_count": len(ep["transcript"].split()),
            "raw_metadata": json.dumps(ep.get("raw_metadata", {}), ensure_ascii=False),
        },
    )
    return cur.rowcount > 0


def iter_episodes(
    conn: sqlite3.Connection, only_ungenerated: bool = False, limit: Optional[int] = None
) -> Iterable[sqlite3.Row]:
    sql = "SELECT e.* FROM episodes e"
    if only_ungenerated:
        sql += " LEFT JOIN generation g ON g.episode_id = e.id WHERE g.episode_id IS NULL"
    sql += " ORDER BY e.episode_number IS NULL, e.episode_number, e.id"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return conn.execute(sql).fetchall()


def record_generation(conn: sqlite3.Connection, episode_id: int, **fields) -> None:
    conn.execute(
        """
        INSERT INTO generation
            (episode_id, provider, model, markdown_path, frontmatter,
             summary, input_tokens, output_tokens)
        VALUES (:episode_id, :provider, :model, :markdown_path, :frontmatter,
                :summary, :input_tokens, :output_tokens)
        ON CONFLICT(episode_id) DO UPDATE SET
            provider=excluded.provider, model=excluded.model,
            markdown_path=excluded.markdown_path, frontmatter=excluded.frontmatter,
            summary=excluded.summary, input_tokens=excluded.input_tokens,
            output_tokens=excluded.output_tokens, generated_at=datetime('now')
        """,
        {"episode_id": episode_id, **fields},
    )


def counts(conn: sqlite3.Connection) -> tuple[int, int]:
    total = conn.execute("SELECT COUNT(*) FROM episodes").fetchone()[0]
    done = conn.execute("SELECT COUNT(*) FROM generation").fetchone()[0]
    return total, done
