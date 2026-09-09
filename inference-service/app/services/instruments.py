"""
Business logic tying SQLite (db.py, system of record) and Chroma
(vector_store.py, semantic index) together. Every write goes through here so
the two never drift apart: create/update/delete/import all re-embed and
re-index in the same call that touches SQLite. Embeddings themselves come
from the vLLM sidecar via services/inference_client.py.
"""
from typing import Optional

from .. import db
from . import inference_client, vector_store


def build_description_text(code: str, name: str, description: str, tags: list[str], metadata: dict) -> str:
    """
    Composes the actual text that gets embedded — folds quantitative metadata
    into descriptive text too, so a query like "fort dividende faible
    volatilité" can match assets with no hand-written qualitative blurb at all.

    `code` (the ticker, e.g. "MC FP") is deliberately included, and first: a
    caller searching for the exact Bloomberg ticker of an instrument must find
    it, not just a caller searching by qualitative theme. Without it, a query
    that IS the ticker has no lexical overlap with the embedded text at all
    and its ranking depends entirely on the embedding model happening to know
    that association — not reliable enough for what is effectively an exact
    lookup dressed up as a semantic one.
    """
    parts = [code, name, description, " ".join(tags)]
    for key, value in metadata.items():
        if value not in (None, ""):
            parts.append(f"{key}: {value}")
    return " ".join(p for p in parts if p).strip()


def _embed_and_index(instrument: dict) -> None:
    text = build_description_text(instrument["code"], instrument["name"], instrument["description"], instrument["tags"], instrument["metadata"])
    vector = inference_client.embed_one(text)
    vector_store.upsert(instrument["id"], vector, instrument["assetClass"])


def create_or_replace(asset_class: str, code: str, name: str, description: str, tags: list[str], metadata: dict) -> dict:
    instrument = db.upsert_instrument(asset_class, code.strip().upper(), name, description, tags, metadata)
    _embed_and_index(instrument)
    return instrument


def update_partial(instrument_id: str, name: Optional[str], description: Optional[str], tags: Optional[list[str]], metadata: Optional[dict]) -> Optional[dict]:
    existing = db.get_instrument(instrument_id)
    if not existing:
        return None
    return create_or_replace(
        existing["assetClass"],
        existing["code"],
        name if name is not None else existing["name"],
        description if description is not None else existing["description"],
        tags if tags is not None else existing["tags"],
        metadata if metadata is not None else existing["metadata"],
    )


def delete(instrument_id: str) -> bool:
    if not db.get_instrument(instrument_id):
        return False
    db.delete_instrument(instrument_id)
    vector_store.delete(instrument_id)
    return True


def list_all(asset_class: Optional[str] = None, search: Optional[str] = None, limit: int = 100, offset: int = 0) -> list[dict]:
    return db.list_instruments(asset_class, search, limit, offset)


def get(instrument_id: str) -> Optional[dict]:
    return db.get_instrument(instrument_id)


def search(query: str, asset_class: Optional[str], limit: int) -> list[dict]:
    query_vector = inference_client.embed_one(query)
    ranked = vector_store.query(query_vector, limit, asset_class)

    results = []
    for instrument_id, score in ranked:
        instrument = db.get_instrument(instrument_id)
        if instrument:
            results.append({**instrument, "score": round(score, 4)})
    return results


def reindex_all() -> int:
    """
    Re-embeds and re-indexes every stored instrument against the CURRENT
    build_description_text formula, without changing any of their SQLite
    fields. Needed after a change to that formula (e.g. adding `code` to the
    embedded text) so instruments created before the change benefit from it
    too — otherwise the fix would only apply to instruments created from then
    on. Reuses create_or_replace with each instrument's own existing values,
    which re-embeds unconditionally.
    """
    count = 0
    offset = 0
    batch_size = 500
    while True:
        batch = db.list_instruments(limit=batch_size, offset=offset)
        if not batch:
            break
        for instrument in batch:
            create_or_replace(
                instrument["assetClass"],
                instrument["code"],
                instrument["name"],
                instrument["description"],
                instrument["tags"],
                instrument["metadata"],
            )
            count += 1
        offset += batch_size
    return count


def import_instruments(rows: list[dict]) -> int:
    """Bulk upsert (used by both the CSV and JSON import routes). Returns the count imported."""
    count = 0
    for row in rows:
        create_or_replace(
            row.get("assetClass", "EQUITY"),
            row["code"],
            row["name"],
            row.get("description", ""),
            row.get("tags", []),
            row.get("metadata", {}),
        )
        count += 1
    return count
