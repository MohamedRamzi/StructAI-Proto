from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.dependencies import require_api_key_or_auth
from ..services import analyze as analyze_service
from ..services.validation import detect_missing_fields

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


class AnalyzeRequest(BaseModel):
    query: Optional[str] = None
    # "routed" (default): router step + per-scope pre-prompt + rich schema.
    # "single": one call with the `default` pre-prompt, flat generic/v1 schema.
    pipeline: Optional[str] = None
    # Per-request override of the configured reasoning mode:
    # "auto" | "fast" | "thinking". Anything else -> the stored default.
    reasoningMode: Optional[str] = None


@router.post("", dependencies=[Depends(require_api_key_or_auth)])
def analyze(payload: AnalyzeRequest):
    if not payload.query or not payload.query.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "query (texte de la demande client) est requis.")

    pipeline = payload.pipeline if payload.pipeline in ("routed", "single") else "routed"
    reasoning_mode = payload.reasoningMode if payload.reasoningMode in ("auto", "fast", "thinking") else None

    try:
        outcome = analyze_service.analyze_query(payload.query, pipeline=pipeline, reasoning_mode=reasoning_mode)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))

    if not outcome["quotes"]:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Le moteur LLM configuré n'a retourné aucune cotation exploitable.")

    quotes = [
        {**quote, "missingFields": detect_missing_fields(quote["extraction"], quote.get("schemaVersion"))}
        for quote in outcome["quotes"]
    ]

    return {
        "success": True,
        "modelUsed": outcome["modelUsed"],
        "pipeline": outcome["pipeline"],
        "quotes": quotes,
    }
