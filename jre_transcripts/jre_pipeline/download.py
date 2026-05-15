"""Download JRE transcripts from Kaggle."""

from __future__ import annotations

from pathlib import Path


def _api():
    # Imported lazily so `search`/`download` only require kaggle when used.
    from kaggle.api.kaggle_api_extended import KaggleApi

    api = KaggleApi()
    api.authenticate()
    return api


def search(query: str) -> list[str]:
    """Return 'owner/slug  -  title' lines for datasets matching the query."""
    api = _api()
    results = api.dataset_list(search=query)
    return [f"{d.ref}  -  {getattr(d, 'title', '')}" for d in results]


def download(dataset: str, raw_dir: Path) -> None:
    """Download and unzip a Kaggle dataset into raw_dir."""
    if not dataset:
        raise SystemExit(
            "No dataset configured. Set JRE_KAGGLE_DATASET in .env or pass "
            "--dataset owner/slug. Discover slugs with:\n"
            '    python -m jre_pipeline search "joe rogan transcript"'
        )
    raw_dir.mkdir(parents=True, exist_ok=True)
    api = _api()
    api.dataset_download_files(dataset, path=str(raw_dir), unzip=True, quiet=False)
    print(f"Downloaded '{dataset}' into {raw_dir}")
