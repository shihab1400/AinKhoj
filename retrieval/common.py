"""Shared settings + helpers for ingest.py and server.py."""
import json
import os
import re
from pathlib import Path

HERE = Path(__file__).parent

# Any sentence-transformers model works. Change it, then re-run ingest.py --force.
#   BAAI/bge-small-en-v1.5   small + fast, English only (default)
#   BAAI/bge-base-en-v1.5    better quality, English only
#   BAAI/bge-m3              multilingual incl. Bangla, larger/slower (~2 GB)
MODEL_NAME = os.getenv("EMBED_MODEL", "BAAI/bge-small-en-v1.5")

# Every  <name>.jsonl  in this folder becomes one searchable "domain" called <name>.
DATA_DIR = Path(os.getenv("DATA_DIR", HERE.parent / "backend" / "data"))
DB_DIR = os.getenv("CHROMA_DIR", str(HERE / "chroma_db"))
DOMAINS_FILE = Path(DB_DIR) / "domains.json"  # written by ingest.py, read by server.py
COLLECTION_PREFIX = "law_"

# bge English models want an instruction on the *query* side only.
_name = MODEL_NAME.lower()
_default_query_prefix = (
    "Represent this sentence for searching relevant passages: "
    if "bge" in _name and "-en" in _name
    else ""
)
DOC_PREFIX = os.getenv("DOC_PREFIX", "")
QUERY_PREFIX = os.getenv("QUERY_PREFIX", _default_query_prefix)

_model = None


def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        print(f"Loading embedding model: {MODEL_NAME}")
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def embed(texts, prefix=""):
    vectors = get_model().encode(
        [prefix + t for t in texts],
        normalize_embeddings=True,  # cosine similarity = dot product
        batch_size=16,
        show_progress_bar=False,
    )
    return [list(map(float, v)) for v in vectors]


def domain_id(path: Path) -> str:
    """education.jsonl -> 'education'   Criminal Laws.jsonl -> 'criminal-laws'"""
    return re.sub(r"[^a-z0-9_-]+", "-", path.stem.lower()).strip("-_")


def collection_name(domain: str) -> str:
    return COLLECTION_PREFIX + domain


def default_label(domain: str) -> str:
    base = " ".join(re.split(r"[_-]+", domain)).title()
    return base if re.search(r"\blaws?\b", base, re.I) else base + " law"


def load_manifest() -> dict:
    """Optional data/domains.json: {"land": {"label": "Land law", "description": "..."}}"""
    f = DATA_DIR / "domains.json"
    if not f.exists():
        return {}
    try:
        return json.loads(f.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise SystemExit(f"{f} is not valid JSON: {e}")
