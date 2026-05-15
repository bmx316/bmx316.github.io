"""Runtime configuration, loaded from environment / .env."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # dotenv is optional at runtime
    load_dotenv = None

# Project root = the jre_transcripts/ directory (parent of this package).
ROOT = Path(__file__).resolve().parent.parent

if load_dotenv is not None:
    load_dotenv(ROOT / ".env")


@dataclass(frozen=True)
class Config:
    data_dir: Path
    raw_dir: Path
    db_path: Path
    vault_dir: Path
    kaggle_dataset: str
    provider: str
    model: str

    @staticmethod
    def load() -> "Config":
        data_dir = Path(os.getenv("JRE_DATA_DIR", ROOT / "data")).resolve()
        provider = os.getenv("LLM_PROVIDER", "anthropic").strip().lower()
        default_model = "claude-opus-4-7" if provider == "anthropic" else "gpt-4o"
        return Config(
            data_dir=data_dir,
            raw_dir=data_dir / "raw",
            db_path=Path(os.getenv("JRE_DB_PATH", data_dir / "jre.db")).resolve(),
            vault_dir=Path(os.getenv("JRE_VAULT_DIR", ROOT / "obsidian")).resolve(),
            kaggle_dataset=os.getenv("JRE_KAGGLE_DATASET", "").strip(),
            provider=provider,
            model=os.getenv("LLM_MODEL", "").strip() or default_model,
        )

    def ensure_dirs(self) -> None:
        for d in (self.data_dir, self.raw_dir, self.vault_dir):
            d.mkdir(parents=True, exist_ok=True)
