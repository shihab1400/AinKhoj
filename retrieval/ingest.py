"""
Build / update the vector databases. One Chroma collection per .jsonl file.

    python ingest.py                 # every *.jsonl in backend/data (unchanged files are skipped)
    python ingest.py criminal land   # only these domains
    python ingest.py --force         # re-embed everything (needed after changing EMBED_MODEL)
    python ingest.py --prune         # also delete databases whose .jsonl file was removed

Adding a new area of law = drop  <name>.jsonl  into backend/data and run this.
"""
import argparse
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import chromadb

import common

BATCH = 32


def read_records(path: Path):
    records = []
    for n, line in enumerate(path.open(encoding="utf-8"), 1):
        if not line.strip():
            continue
        try:
            r = json.loads(line)
        except json.JSONDecodeError as e:
            sys.exit(f"{path.name} line {n}: invalid JSON ({e})")
        if not r.get("id") or not r.get("text"):
            sys.exit(f"{path.name} line {n}: every record needs 'id' and 'text'")
        records.append(r)
    dupes = {i for i, c in Counter(r["id"] for r in records).items() if c > 1}
    if dupes:
        sys.exit(f"{path.name}: duplicate ids, e.g. {sorted(dupes)[:3]}")
    return records


def fingerprint(path: Path) -> str:
    h = hashlib.sha256(path.read_bytes())
    h.update(f"|{common.MODEL_NAME}|{common.DOC_PREFIX}".encode())
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("names", nargs="*", help="domains to ingest (default: all)")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--prune", action="store_true")
    args = ap.parse_args()

    files = sorted(common.DATA_DIR.glob("*.jsonl"))
    if not files:
        sys.exit(f"No .jsonl files found in {common.DATA_DIR}")

    by_domain = {}
    for f in files:
        d = common.domain_id(f)
        if d in by_domain:
            sys.exit(f"{f.name} and {by_domain[d].name} both map to the domain '{d}'")
        by_domain[d] = f
    unknown = [n for n in args.names if n not in by_domain]
    if unknown:
        sys.exit(f"No file for: {unknown}. Available: {sorted(by_domain)}")
    targets = args.names or list(by_domain)

    Path(common.DB_DIR).mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=common.DB_DIR)
    manifest = common.load_manifest()
    info = {}

    for domain, path in by_domain.items():
        records = read_records(path)
        acts = list(dict.fromkeys(r.get("act_title", "") for r in records if r.get("act_title")))
        fp = fingerprint(path)
        entry = manifest.get(domain, {})
        info[domain] = {
            "id": domain,
            "label": entry.get("label") or common.default_label(domain),
            "description": entry.get("description") or "",
            "file": path.name,
            "chunks": len(records),
            "acts": acts,
            "hash": fp,
            "model": common.MODEL_NAME,
        }
        if domain not in targets:
            # Only advertise databases that really exist, or searches would fail.
            try:
                client.get_collection(common.collection_name(domain))
            except Exception:
                print(f"note: '{domain}' is not embedded yet (run: python ingest.py {domain})")
                del info[domain]
            continue

        name = common.collection_name(domain)
        try:
            existing = client.get_collection(name)
        except Exception:
            existing = None
        if (existing and not args.force
                and (existing.metadata or {}).get("file_hash") == fp
                and existing.count() == len(records)):
            print(f"[{domain}] up to date ({len(records)} chunks), skipped")
            continue

        if existing:
            client.delete_collection(name)
        col = client.create_collection(
            name,
            metadata={"hnsw:space": "cosine", "embed_model": common.MODEL_NAME, "file_hash": fp},
        )
        for i in range(0, len(records), BATCH):
            batch = records[i : i + BATCH]
            col.add(
                ids=[r["id"] for r in batch],
                documents=[r["text"] for r in batch],
                embeddings=common.embed([r["text"] for r in batch], common.DOC_PREFIX),
                metadatas=[
                    {
                        "act": r.get("act_title") or "",
                        "year": r.get("act_year") or "",
                        "act_no": r.get("act_no") or "",
                        "section": r.get("section_no") or "",
                        "title": r.get("section_title") or "",
                        "chapter": r.get("chapter_no") or "",
                    }
                    for r in batch
                ],
            )
            print(f"\r[{domain}] {min(i + BATCH, len(records))}/{len(records)}", end="", flush=True)
        print(f"\n[{domain}] stored {col.count()} chunks from {path.name}")

    stale = []
    for c in client.list_collections():
        cname = getattr(c, "name", c)
        if cname.startswith(common.COLLECTION_PREFIX) and cname[len(common.COLLECTION_PREFIX):] not in by_domain:
            stale.append(cname)
    for cname in stale:
        if args.prune:
            client.delete_collection(cname)
            print(f"pruned {cname}")
        else:
            print(f"note: '{cname}' has no .jsonl file any more (use --prune to delete it)")

    common.DOMAINS_FILE.write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\nDomains: {', '.join(info)}")


if __name__ == "__main__":
    main()
