"""
Read/delete access to the parsing_logs audit trail (written automatically by
routers/analyze.py on every POST /api/analyze call, success or failure — see
db.create_parsing_log). There is deliberately no POST/PUT here: a log entry
is a record of what actually happened, produced by the system itself, not
something an admin authors or edits after the fact — the "C" and "U" of CRUD
don't apply to an audit trail the way they do to config data like prompts or
instruments. Read is open to any authenticated user (same convention as
prompts/instruments); delete is admin-only.
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from .. import db
from ..auth.dependencies import require_auth, require_role

router = APIRouter(prefix="/api/parsing-logs", tags=["parsing-logs"])

_VALID_PIPELINES = ("routed", "single", "route")


@router.get("", dependencies=[Depends(require_auth)])
def list_parsing_logs(
    limit: int = 25,
    offset: int = 0,
    pipeline: Optional[str] = Query(None),
    success: Optional[bool] = Query(None),
    q: Optional[str] = Query(None),
):
    pipeline = pipeline if pipeline in _VALID_PIPELINES else None
    return {
        "success": True,
        "logs": db.list_parsing_logs(limit=limit, offset=offset, pipeline=pipeline, success=success, search=q),
        "total": db.count_parsing_logs(pipeline=pipeline, success=success, search=q),
    }


@router.get("/{log_id}", dependencies=[Depends(require_auth)])
def get_parsing_log(log_id: int):
    row = db.get_parsing_log(log_id)
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrée de log introuvable.")
    return {"success": True, "log": row}


@router.delete("", status_code=status.HTTP_200_OK)
def clear_parsing_logs(_current: dict = Depends(require_role("admin"))):
    return {"success": True, "deleted": db.delete_all_parsing_logs()}


@router.delete("/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_parsing_log(log_id: int, _current: dict = Depends(require_role("admin"))):
    if not db.delete_parsing_log(log_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Entrée de log introuvable.")
