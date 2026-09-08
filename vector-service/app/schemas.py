"""
Pydantic models. Field names are camelCase on the wire (JSON) to match the
convention already used across this project's other services (quotation-service,
the main Node app) — even though that's not idiomatic Python naming, matching
the cross-service JSON contract directly is worth more here than PEP8 purity.
"""
from typing import Literal, Optional
from pydantic import BaseModel, Field

# Extensible on purpose: only EQUITY is populated today, but the schema (and every
# layer built on top of it — SQLite, Chroma metadata, the admin UI) already accepts
# RATE_INDEX / FX / CREDIT without any migration, per the "à terme, étendre" requirement.
AssetClass = Literal["EQUITY", "RATE_INDEX", "FX", "CREDIT"]


class InstrumentIn(BaseModel):
    """What a client sends to create or fully replace an instrument."""
    assetClass: AssetClass = "EQUITY"
    code: str = Field(..., min_length=1, description="Primary identifier within its asset class (e.g. a Bloomberg ticker for EQUITY).")
    name: str = Field(..., min_length=1)
    description: str = Field("", description="Free-text qualitative blurb — this is the text that gets embedded for semantic search.")
    tags: list[str] = []
    metadata: dict = Field(default_factory=dict, description="Asset-class-specific fields (spotPrice, sector, ... for EQUITY; different keys for future asset classes).")


class InstrumentUpdate(BaseModel):
    """Partial update — every field optional, only provided ones are changed."""
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    metadata: Optional[dict] = None


class Instrument(InstrumentIn):
    id: str
    createdAt: str
    updatedAt: str


class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1)
    assetClass: Optional[AssetClass] = None
    limit: int = Field(5, ge=1, le=50)


class SearchResultItem(BaseModel):
    id: str
    assetClass: str
    code: str
    name: str
    description: str
    tags: list[str]
    metadata: dict
    score: float


class UserRole:
    ADMIN = "admin"
    USER = "user"


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    createdAt: str


class EmbeddingConfigOut(BaseModel):
    provider: str
    model: str
    baseUrl: str
    updatedAt: str


class ApiKeyOut(BaseModel):
    id: int
    label: str
    keyPrefix: str
    createdBy: Optional[int]
    createdAt: str
    revokedAt: Optional[str]
