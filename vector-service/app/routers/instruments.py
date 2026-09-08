from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, status
from fastapi.responses import PlainTextResponse

from .. import db
from ..auth.dependencies import require_api_key_or_auth, require_role
from ..schemas import InstrumentIn, InstrumentUpdate, SearchRequest
from ..services import csv_io, instruments as instruments_service

router = APIRouter(prefix="/api/instruments", tags=["instruments"])


@router.get("", dependencies=[Depends(require_api_key_or_auth)])
def list_instruments(assetClass: Optional[str] = None, q: Optional[str] = None, limit: int = 100, offset: int = 0):
    return {"success": True, "instruments": instruments_service.list_all(assetClass, q, limit, offset)}


@router.get("/export")
def export_instruments(format: str = Query("json", pattern="^(csv|json)$"), assetClass: Optional[str] = None, current: dict = Depends(require_role("admin"))):
    rows = instruments_service.list_all(assetClass, None, limit=10_000, offset=0)
    if format == "csv":
        return PlainTextResponse(csv_io.export_equity_csv(rows), media_type="text/csv")
    return {"success": True, "instruments": rows}


@router.post("/import/csv")
async def import_csv(file: UploadFile, current: dict = Depends(require_role("admin"))):
    raw = (await file.read()).decode("utf-8")
    rows = csv_io.parse_equity_csv(raw)
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Aucune ligne exploitable dans ce fichier CSV (colonnes Code/Ticker et Name requises).")
    count = instruments_service.import_instruments(rows)
    return {"success": True, "imported": count}


@router.post("/import/json")
def import_json(payload: list[InstrumentIn], current: dict = Depends(require_role("admin"))):
    if not payload:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Le tableau d'instruments est vide.")
    count = instruments_service.import_instruments([row.model_dump() for row in payload])
    return {"success": True, "imported": count}


@router.post("/search", dependencies=[Depends(require_api_key_or_auth)])
def search_instruments(payload: SearchRequest):
    try:
        results = instruments_service.search(payload.query, payload.assetClass, payload.limit)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    return {"success": True, "results": results}


@router.get("/{instrument_id:path}", dependencies=[Depends(require_api_key_or_auth)])
def get_instrument(instrument_id: str):
    instrument = instruments_service.get(instrument_id)
    if not instrument:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instrument introuvable.")
    return {"success": True, "instrument": instrument}


@router.post("", status_code=status.HTTP_201_CREATED)
def create_instrument(payload: InstrumentIn, current: dict = Depends(require_role("admin"))):
    try:
        instrument = instruments_service.create_or_replace(payload.assetClass, payload.code, payload.name, payload.description, payload.tags, payload.metadata)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    return {"success": True, "instrument": instrument}


@router.put("/{instrument_id:path}")
def update_instrument(instrument_id: str, payload: InstrumentUpdate, current: dict = Depends(require_role("admin"))):
    try:
        instrument = instruments_service.update_partial(instrument_id, payload.name, payload.description, payload.tags, payload.metadata)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))
    if not instrument:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instrument introuvable.")
    return {"success": True, "instrument": instrument}


@router.delete("/{instrument_id:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete_instrument(instrument_id: str, current: dict = Depends(require_role("admin"))):
    if not instruments_service.delete(instrument_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Instrument introuvable.")
