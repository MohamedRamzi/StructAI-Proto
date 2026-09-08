"""
Chroma wrapper — the semantic index only. Deliberately minimal: Chroma stores
just the embedding vector and `assetClass` (for `where`-filtering by asset
class), NOT a duplicate copy of name/description/metadata. SQLite (db.py)
stays the single source of truth for instrument data; after a Chroma query
returns ranked ids, the caller (services/instruments.py) looks up the full
record by id. This avoids any risk of the two stores drifting apart.

Runs embedded in-process (chromadb.PersistentClient) rather than as a
separate `chroma run` server — one process, one venv, nothing extra to start
or coordinate.
"""
import chromadb

from .. import config

_client = chromadb.PersistentClient(path=config.CHROMA_PATH)
_collection = _client.get_or_create_collection(
    name="instruments",
    metadata={"hnsw:space": "cosine"},  # so distance == 1 - cosine_similarity
)


def upsert(instrument_id: str, embedding: list[float], asset_class: str) -> None:
    _collection.upsert(ids=[instrument_id], embeddings=[embedding], metadatas=[{"assetClass": asset_class}])


def delete(instrument_id: str) -> None:
    _collection.delete(ids=[instrument_id])


def query(embedding: list[float], n_results: int, asset_class: str | None = None) -> list[tuple[str, float]]:
    """Returns [(instrument_id, similarity_score), ...] ranked best-first."""
    if _collection.count() == 0:
        return []
    where = {"assetClass": asset_class} if asset_class else None
    result = _collection.query(
        query_embeddings=[embedding],
        n_results=min(n_results, _collection.count()),
        where=where,
    )
    ids = result["ids"][0] if result.get("ids") else []
    distances = result["distances"][0] if result.get("distances") else []
    return [(instrument_id, 1.0 - distance) for instrument_id, distance in zip(ids, distances)]
