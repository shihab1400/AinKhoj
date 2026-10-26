"""
Search service used by the NestJS backend.

    python -m uvicorn server:app --port 8000

Serves one vector database per domain (one per .jsonl file). After running
ingest.py the server notices the change by itself; no restart needed.
"""
import json
import threading
from contextlib import asynccontextmanager
from typing import List, Optional

import chromadb
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

import common

state = {"client": None, "mtime": None, "domains": {}, "cols": {}}
lock = threading.Lock()


def refresh(force: bool = False):
    """(Re)load domains.json and reopen the database when ingest.py changed it."""
    f = common.DOMAINS_FILE
    mtime = f.stat().st_mtime if f.exists() else None
    with lock:
        if not force and mtime == state["mtime"] and state["client"] is not None:
            return
        try:  # make sure we see data written by another process
            from chromadb.api.client import SharedSystemClient

            SharedSystemClient.clear_system_cache()
        except Exception:
            pass
        state["client"] = chromadb.PersistentClient(path=common.DB_DIR)
        state["cols"] = {}
        state["domains"] = json.loads(f.read_text(encoding="utf-8")) if mtime else {}
        state["mtime"] = mtime
        for d, meta in state["domains"].items():
            if meta.get("model") != common.MODEL_NAME:
                print(f"!! '{d}' was embedded with '{meta.get('model')}' but EMBED_MODEL is "
                      f"'{common.MODEL_NAME}'. Run: python ingest.py --force")
        print(f"Domains loaded: {list(state['domains']) or 'none (run ingest.py)'}")


def collection(domain: str):
    if domain not in state["cols"]:
        state["cols"][domain] = state["client"].get_collection(common.collection_name(domain))
    return state["cols"][domain]


@asynccontextmanager
async def lifespan(app: FastAPI):
    refresh(force=True)
    common.get_model()  # load now so the first request is fast
    yield


app = FastAPI(lifespan=lifespan)


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    k: int = Field(default=5, ge=1, le=20)
    domains: Optional[List[str]] = None  # None = search every domain


def excerpt(text: str, limit: int = 450) -> str:
    lines = text.split("\n")
    idx = next((i for i, l in enumerate(lines) if l.startswith("Section")), -1)
    body = " ".join(lines[idx + 1 :])
    return body if len(body) <= limit else body[:limit] + "…"


@app.get("/health")
def health():
    refresh()
    return {"ok": bool(state["domains"]), "domains": list(state["domains"]),
            "model": common.MODEL_NAME}


@app.get("/domains")
def domains():
    refresh()
    return {"domains": list(state["domains"].values())}


@app.post("/search")
def search(req: SearchRequest):
    refresh()
    available = state["domains"]
    if not available:
        raise HTTPException(503, "No vector databases yet. Run: python ingest.py")
    wanted = req.domains if req.domains else list(available)
    unknown = [d for d in wanted if d not in available]
    if unknown:
        raise HTTPException(400, f"Unknown domain(s): {unknown}. Available: {list(available)}")

    qv = common.embed([req.query], common.QUERY_PREFIX)
    results = []
    for d in wanted:
        col = collection(d)
        if col.count() == 0:
            continue
        res = col.query(
            query_embeddings=qv,
            n_results=min(req.k, col.count()),
            include=["documents", "metadatas", "distances"],
        )
        for id_, doc, meta, dist in zip(
            res["ids"][0], res["documents"][0], res["metadatas"][0], res["distances"][0]
        ):
            results.append(
                {
                    "id": id_,
                    "domain": d,
                    "act": meta["act"],
                    "year": meta["year"],
                    "actNo": meta["act_no"],
                    "section": meta["section"],
                    "title": meta["title"],
                    "chapter": meta["chapter"],
                    "score": round(1 - dist, 3),  # cosine distance -> similarity
                    "excerpt": excerpt(doc),
                    "text": doc,  # full chunk, used by the backend to build the prompt
                }
            )
    results.sort(key=lambda r: r["score"], reverse=True)
    return {"results": results[: req.k]}
