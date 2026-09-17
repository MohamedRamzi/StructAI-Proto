"""Raw, direct chat with the configured chat model — bypasses the entire
routed-analyze pipeline (no router pré-prompt, no domain pré-prompt cascade,
no schemaVersion/quotes envelope, no missing-fields detection): just the
model, a real multi-turn conversation, and the engine's own stats back
(tokens, duration, finish reason). For quickly testing raw model behaviour —
does it follow instructions, how fast is it, how does "thinking" mode change
its answers — without any of the pipeline's prompt engineering in the way.

Human-only (admin UI), same auth convention as prompts/instruments read
access: any authenticated user, not gated to admin specifically — this is a
"try it out" tool, not a config-mutating one.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from ..auth.dependencies import require_auth
from ..services import inference_client

router = APIRouter(prefix="/api/direct-chat", tags=["direct-chat"])

_VALID_ROLES = {"system", "user", "assistant"}


class ChatMessage(BaseModel):
    role: str
    content: str


class DirectChatRequest(BaseModel):
    messages: list[ChatMessage]
    reasoningMode: Optional[str] = None


@router.post("", dependencies=[Depends(require_auth)])
def direct_chat(payload: DirectChatRequest):
    if not payload.messages:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "messages est requis (au moins un message).")
    for m in payload.messages:
        if m.role not in _VALID_ROLES:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f'role invalide : "{m.role}". Attendu : system, user, assistant.')
        if not m.content.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Un message ne peut pas être vide.")

    reasoning_mode = payload.reasoningMode if payload.reasoningMode in ("auto", "fast", "thinking") else None

    try:
        result = inference_client.chat(
            messages=[m.model_dump() for m in payload.messages],
            reasoning_mode=reasoning_mode,
            json_mode=False,
        )
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc))

    return {"success": True, **result}
