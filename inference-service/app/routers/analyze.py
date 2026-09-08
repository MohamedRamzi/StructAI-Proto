from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.dependencies import require_api_key_or_auth
from ..services import analyze as analyze_service
from ..services.validation import detect_missing_fields

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


class AnalyzeRequest(BaseModel):
    query: Optional[str] = None


@router.post("", dependencies=[Depends(require_api_key_or_auth)])
def analyze(payload: AnalyzeRequest):
    if not payload.query or not payload.query.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "query (texte de la demande client) est requis.")

    try:
        outcome = analyze_service.analyze_query(payload.query)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))

    if not outcome["rawQuotes"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Le moteur LLM configuré n'a retourné aucune cotation exploitable.")

    quotes = []
    for index, extraction in enumerate(outcome["rawQuotes"]):
        quotes.append({
            "quoteId": extraction.get("quoteId", index + 1),
            "label": extraction.get("label") or extraction.get("productTypeName") or f"Cotation {index + 1}",
            "extraction": extraction,
            "missingFields": detect_missing_fields(extraction),
        })

    return {"success": True, "modelUsed": outcome["modelUsed"], "quotes": quotes}
