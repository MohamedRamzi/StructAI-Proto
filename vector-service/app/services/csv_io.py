"""
CSV import/export — scoped to the EQUITY asset class (CSV is inherently flat/
tabular, convenient for one asset class's column set at a time; future asset
classes get their own column mapping when they're added). JSON import/export
(see instruments.py) is fully generic across every asset class instead.

The column set mirrors src/services/underlyings-storage.ts's existing CSV
export in the main app (Ticker,ISIN,Name,Sector,Region,SpotPrice,Currency,
ImpliedVol3m,DividendYield,VolatilityScore,Reasoning) so that file can be
imported here with just an added AssetClass column — `Ticker` is accepted as
an alias for `Code` for exactly that migration path.
"""
import csv
import io

EQUITY_CSV_HEADERS = [
    "AssetClass", "Code", "Name", "ISIN", "Sector", "Region", "SpotPrice",
    "Currency", "ImpliedVol3m", "DividendYield", "RepoRate", "VolatilityScore",
    "Reasoning", "Description", "Tags",
]


def _to_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value) if value not in (None, "") else default
    except ValueError:
        return default


def parse_equity_csv(csv_text: str) -> list[dict]:
    """Returns a list of dicts shaped like schemas.InstrumentIn (assetClass/code/name/description/tags/metadata)."""
    reader = csv.DictReader(io.StringIO(csv_text))
    rows: list[dict] = []
    for raw in reader:
        code = (raw.get("Code") or raw.get("Ticker") or "").strip().upper()
        name = (raw.get("Name") or "").strip()
        if not code or not name:
            continue  # skip rows missing the two required fields rather than failing the whole import

        reasoning = (raw.get("Reasoning") or "").strip()
        description = (raw.get("Description") or "").strip() or reasoning
        tags = [t.strip() for t in (raw.get("Tags") or "").split(";") if t.strip()]

        rows.append({
            "assetClass": (raw.get("AssetClass") or "EQUITY").strip().upper() or "EQUITY",
            "code": code,
            "name": name,
            "description": description,
            "tags": tags,
            "metadata": {
                "isin": (raw.get("ISIN") or "").strip(),
                "sector": (raw.get("Sector") or "").strip(),
                "region": (raw.get("Region") or "").strip(),
                "spotPrice": _to_float(raw.get("SpotPrice")),
                "currency": (raw.get("Currency") or "EUR").strip(),
                "impliedVol3m": _to_float(raw.get("ImpliedVol3m")),
                "dividendYield": _to_float(raw.get("DividendYield")),
                "repoRate": _to_float(raw.get("RepoRate")),
                "volatilityScore": (raw.get("VolatilityScore") or "MEDIUM").strip().upper(),
                "reasoningForRecommendation": reasoning,
            },
        })
    return rows


def export_equity_csv(instruments: list[dict]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=EQUITY_CSV_HEADERS)
    writer.writeheader()
    for instrument in instruments:
        meta = instrument.get("metadata", {})
        writer.writerow({
            "AssetClass": instrument["assetClass"],
            "Code": instrument["code"],
            "Name": instrument["name"],
            "ISIN": meta.get("isin", ""),
            "Sector": meta.get("sector", ""),
            "Region": meta.get("region", ""),
            "SpotPrice": meta.get("spotPrice", ""),
            "Currency": meta.get("currency", ""),
            "ImpliedVol3m": meta.get("impliedVol3m", ""),
            "DividendYield": meta.get("dividendYield", ""),
            "RepoRate": meta.get("repoRate", ""),
            "VolatilityScore": meta.get("volatilityScore", ""),
            "Reasoning": meta.get("reasoningForRecommendation", ""),
            "Description": instrument.get("description", ""),
            "Tags": ";".join(instrument.get("tags", [])),
        })
    return output.getvalue()
