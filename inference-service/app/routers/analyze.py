import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from .. import db
from ..auth.dependencies import require_api_key_or_auth
from ..services import analyze as analyze_service
from ..services.validation import detect_missing_fields

router = APIRouter(prefix="/api/analyze", tags=["analyze"])


_VALID_PIPELINES = ("routed", "single", "route")


class AnalyzeRequest(BaseModel):
    query: Optional[str] = None
    # "routed" (default): router step + per-scope pre-prompt + rich schema.
    # "single": one call with the `default` pre-prompt, flat generic/v1 schema.
    # "route": ONLY the router step + prompt cascade, no extraction call —
    #          for iterating on the router prompt / asset-class selection.
    pipeline: Optional[str] = None
    # Per-request override of the configured reasoning mode:
    # "auto" | "fast" | "thinking". Anything else -> the stored default.
    reasoningMode: Optional[str] = None


def _caller_label(current: dict) -> Optional[str]:
    if current.get("email"):
        return current["email"]
    if current.get("apiKeyId") is not None:
        return f"apiKey#{current['apiKeyId']}"
    return None


def _log_parsing_attempt(
    query: str, pipeline: str, reasoning_mode: Optional[str], current: dict, trace: dict,
    started: float, success: bool, error: Optional[str] = None, quotes: Optional[list] = None,
) -> None:
    """Writes one parsing_logs row. Swallows its own failures (logged to
    stderr) rather than raising — a broken audit-trail write must never turn
    a successful (or already-failed, and about to be reported as such) analyze
    call into an unrelated 500. This is unrelated to the project's
    no-silent-fallback rule for INFERENCE failures (still enforced above,
    unchanged) — it's about not letting a secondary concern (logging) take
    down the primary one (answering the request)."""
    try:
        db.create_parsing_log(
            query=query,
            pipeline=pipeline,
            total_duration_ms=round((time.monotonic() - started) * 1000),
            success=success,
            created_by=_caller_label(current),
            reasoning_mode=reasoning_mode,
            chat_model=db.get_llm_settings()["model"],
            embedding_model=db.get_embedding_settings()["model"],
            routing_result=trace.get("routing"),
            routing_duration_ms=trace.get("routingMs"),
            # "route" pipeline quotes carry only `routing` (see analyze.py) —
            # logging them as extractionResult too would duplicate routingResult
            # under a misleading name, since no domain pré-prompt ever ran.
            extraction_result=quotes if pipeline != "route" else None,
            extraction_duration_ms=trace.get("extractionMs"),
            error_message=error,
        )
    except Exception as exc:  # noqa: BLE001 — see docstring
        print(f"[inference-service] Échec de l'écriture du log de parsing (ignoré) : {exc}")


@router.post("")
def analyze(payload: AnalyzeRequest, current: dict = Depends(require_api_key_or_auth)):
    if not payload.query or not payload.query.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "query (texte de la demande client) est requis.")

    pipeline = payload.pipeline if payload.pipeline in _VALID_PIPELINES else "routed"
    reasoning_mode = payload.reasoningMode if payload.reasoningMode in ("auto", "fast", "thinking") else None

    trace: dict = {}
    started = time.monotonic()
    try:
        outcome = analyze_service.analyze_query(payload.query, pipeline=pipeline, reasoning_mode=reasoning_mode, trace=trace)
    except RuntimeError as exc:
        _log_parsing_attempt(payload.query, pipeline, reasoning_mode, current, trace, started, success=False, error=str(exc))
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(exc))

    if not outcome["quotes"]:
        _log_parsing_attempt(
            payload.query, pipeline, reasoning_mode, current, trace, started, success=False,
            error="Le moteur LLM configuré n'a retourné aucune cotation exploitable.",
        )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Le moteur LLM configuré n'a retourné aucune cotation exploitable.")

    # Route-only quotes carry no `extraction` — nothing to check for missing fields.
    quotes = [
        {**quote, "missingFields": detect_missing_fields(quote["extraction"], quote.get("schemaVersion"))}
        if "extraction" in quote else quote
        for quote in outcome["quotes"]
    ]

    _log_parsing_attempt(payload.query, pipeline, reasoning_mode, current, trace, started, success=True, quotes=quotes)

    return {
        "success": True,
        "modelUsed": outcome["modelUsed"],
        "pipeline": outcome["pipeline"],
        "quotes": quotes,
    }
