"""Command-line entry point: search | download | ingest | generate | all | status."""

from __future__ import annotations

import argparse
import sys

from .config import Config


def main(argv: list[str] | None = None) -> int:
    cfg = Config.load()

    p = argparse.ArgumentParser(prog="jre_pipeline", description=__doc__)
    sub = p.add_subparsers(dest="cmd", required=True)

    sp = sub.add_parser("search", help="Find Kaggle datasets by keyword")
    sp.add_argument("query", nargs="?", default="joe rogan transcript")

    dp = sub.add_parser("download", help="Download the Kaggle dataset")
    dp.add_argument("--dataset", default=cfg.kaggle_dataset, help="owner/slug")

    sub.add_parser("ingest", help="Load downloaded files into the SQLite source")

    gp = sub.add_parser("generate", help="Write Obsidian markdown via the LLM")
    gp.add_argument("--limit", type=int, default=None)
    gp.add_argument("--force", action="store_true", help="Regenerate even if already done")

    ap = sub.add_parser("all", help="download -> ingest -> generate")
    ap.add_argument("--dataset", default=cfg.kaggle_dataset)
    ap.add_argument("--limit", type=int, default=None)

    sub.add_parser("status", help="Show counts")

    args = p.parse_args(argv)
    cfg.ensure_dirs()

    if args.cmd == "search":
        from .download import search

        for line in search(args.query):
            print(line)
        return 0

    if args.cmd == "download":
        from .download import download

        download(args.dataset, cfg.raw_dir)
        return 0

    if args.cmd == "ingest":
        from .ingest import ingest

        new, skipped = ingest(cfg.raw_dir, cfg.db_path)
        print(f"Ingested {new} new episode(s); {skipped} skipped/duplicate.")
        return 0

    if args.cmd in ("generate", "all"):
        if args.cmd == "all":
            from .download import download
            from .ingest import ingest

            download(args.dataset, cfg.raw_dir)
            new, skipped = ingest(cfg.raw_dir, cfg.db_path)
            print(f"Ingested {new} new episode(s); {skipped} skipped/duplicate.")

        from .generate import generate
        from .llm import make_client

        client = make_client(cfg.provider, cfg.model)
        print(f"Generating with provider={client.name} model={client.model}")
        written, failed = generate(
            cfg.db_path,
            cfg.vault_dir,
            client,
            limit=args.limit,
            force=getattr(args, "force", False),
        )
        print(f"Wrote {written} note(s) to {cfg.vault_dir}; {failed} failed.")
        return 1 if failed and not written else 0

    if args.cmd == "status":
        from . import db

        with db.connect(cfg.db_path) as conn:
            total, done = db.counts(conn)
        print(f"Database : {cfg.db_path}")
        print(f"Episodes : {total}")
        print(f"Generated: {done}")
        print(f"Pending  : {total - done}")
        print(f"Vault    : {cfg.vault_dir}")
        return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
