from app.services.csv_io import export_equity_csv, parse_equity_csv


def test_parses_a_minimal_row():
    csv_text = "AssetClass,Code,Name,ISIN,Sector,Region,SpotPrice,Currency,ImpliedVol3m,DividendYield,RepoRate,VolatilityScore,Reasoning,Description,Tags\n" \
               "EQUITY,MC FP,LVMH,FR0000121014,Luxe,Europe,685.4,EUR,0.285,0.021,0.001,EXCELLENT_FOR_AUTOCALL,Leader du luxe,,luxe;europe\n"
    rows = parse_equity_csv(csv_text)
    assert len(rows) == 1
    row = rows[0]
    assert row["assetClass"] == "EQUITY"
    assert row["code"] == "MC FP"
    assert row["name"] == "LVMH"
    assert row["tags"] == ["luxe", "europe"]
    assert row["metadata"]["spotPrice"] == 685.4
    assert row["metadata"]["sector"] == "Luxe"
    # Description falls back to Reasoning when blank.
    assert row["description"] == "Leader du luxe"


def test_accepts_ticker_as_an_alias_for_code_for_backward_compatibility():
    # Exactly the old main-app export format (no AssetClass, "Ticker" not "Code").
    csv_text = "Ticker,ISIN,Name,Sector,Region,SpotPrice,Currency,ImpliedVol3m,DividendYield,VolatilityScore,Reasoning\n" \
               "KER FP,FR0000121485,Kering,Luxe,Europe,410.0,EUR,0.34,0.03,HIGH,Acteur du luxe\n"
    rows = parse_equity_csv(csv_text)
    assert len(rows) == 1
    assert rows[0]["code"] == "KER FP"
    assert rows[0]["assetClass"] == "EQUITY"  # defaulted


def test_skips_rows_missing_required_fields():
    csv_text = "Code,Name\n,Missing Code\nOK FP,\n"
    rows = parse_equity_csv(csv_text)
    assert rows == []


def test_export_then_import_round_trips():
    original = [{
        "assetClass": "EQUITY",
        "code": "MC FP",
        "name": "LVMH",
        "description": "Leader du luxe",
        "tags": ["luxe", "europe"],
        "metadata": {"isin": "FR0000121014", "sector": "Luxe", "region": "Europe", "spotPrice": 685.4, "currency": "EUR", "impliedVol3m": 0.285, "dividendYield": 0.021, "repoRate": 0.001, "volatilityScore": "EXCELLENT_FOR_AUTOCALL", "reasoningForRecommendation": "Leader du luxe"},
    }]
    csv_text = export_equity_csv(original)
    reimported = parse_equity_csv(csv_text)
    assert reimported[0]["code"] == "MC FP"
    assert reimported[0]["metadata"]["spotPrice"] == 685.4
    assert reimported[0]["tags"] == ["luxe", "europe"]
