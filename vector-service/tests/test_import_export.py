import io


def test_import_json_then_export_json(client, auth_headers):
    payload = [
        {"assetClass": "EQUITY", "code": "MC FP", "name": "LVMH", "description": "Luxe", "tags": [], "metadata": {"sector": "Luxe"}},
        {"assetClass": "EQUITY", "code": "KER FP", "name": "Kering", "description": "Luxe aussi", "tags": [], "metadata": {"sector": "Luxe"}},
    ]
    import_res = client.post("/api/instruments/import/json", json=payload, headers=auth_headers)
    assert import_res.status_code == 200
    assert import_res.json()["imported"] == 2

    export_res = client.get("/api/instruments/export", params={"format": "json"}, headers=auth_headers)
    assert export_res.status_code == 200
    codes = {i["code"] for i in export_res.json()["instruments"]}
    assert codes == {"MC FP", "KER FP"}


def test_import_json_requires_admin(client):
    res = client.post("/api/instruments/import/json", json=[{"code": "X", "name": "Y"}])
    assert res.status_code == 401


def test_import_empty_json_array_is_rejected(client, auth_headers):
    res = client.post("/api/instruments/import/json", json=[], headers=auth_headers)
    assert res.status_code == 400


def test_import_csv_file_upload(client, auth_headers):
    csv_content = (
        "AssetClass,Code,Name,ISIN,Sector,Region,SpotPrice,Currency,ImpliedVol3m,DividendYield,RepoRate,VolatilityScore,Reasoning,Description,Tags\n"
        "EQUITY,MC FP,LVMH,FR0000121014,Luxe,Europe,685.4,EUR,0.285,0.021,0.001,EXCELLENT_FOR_AUTOCALL,Leader du luxe,,luxe;europe\n"
    )
    files = {"file": ("underlyings.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    res = client.post("/api/instruments/import/csv", files=files, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["imported"] == 1

    list_res = client.get("/api/instruments", headers=auth_headers)
    codes = {i["code"] for i in list_res.json()["instruments"]}
    assert "MC FP" in codes


def test_export_csv_round_trips_through_import_csv_format(client, auth_headers):
    client.post(
        "/api/instruments",
        json={"assetClass": "EQUITY", "code": "MC FP", "name": "LVMH", "description": "Leader du luxe", "tags": ["luxe"], "metadata": {"sector": "Luxe", "spotPrice": 685.4}},
        headers=auth_headers,
    )
    export_res = client.get("/api/instruments/export", params={"format": "csv"}, headers=auth_headers)
    assert export_res.status_code == 200
    assert "MC FP" in export_res.text
    assert export_res.headers["content-type"].startswith("text/csv")
