LVMH = {
    "assetClass": "EQUITY",
    "code": "mc fp",  # lower-case on purpose — should be normalized to upper-case
    "name": "LVMH Moët Hennessy Louis Vuitton SE",
    "description": "Leader mondial du luxe.",
    "tags": ["luxe", "europe"],
    "metadata": {"sector": "Luxe", "spotPrice": 685.4, "impliedVol3m": 0.285},
}


def test_create_requires_admin(client):
    res = client.post("/api/instruments", json=LVMH)
    assert res.status_code == 401


def test_create_then_get_instrument(client, auth_headers):
    create_res = client.post("/api/instruments", json=LVMH, headers=auth_headers)
    assert create_res.status_code == 201
    instrument = create_res.json()["instrument"]
    assert instrument["id"] == "EQUITY:MC FP"
    assert instrument["code"] == "MC FP"  # normalized upper-case

    get_res = client.get(f"/api/instruments/{instrument['id']}", headers=auth_headers)
    assert get_res.status_code == 200
    assert get_res.json()["instrument"]["name"] == LVMH["name"]


def test_list_instruments_filters_by_asset_class(client, auth_headers):
    client.post("/api/instruments", json=LVMH, headers=auth_headers)
    client.post("/api/instruments", json={**LVMH, "code": "KER FP", "name": "Kering"}, headers=auth_headers)

    res = client.get("/api/instruments", params={"assetClass": "EQUITY"}, headers=auth_headers)
    assert res.status_code == 200
    codes = {i["code"] for i in res.json()["instruments"]}
    assert codes == {"MC FP", "KER FP"}


def test_update_instrument_partial(client, auth_headers):
    created = client.post("/api/instruments", json=LVMH, headers=auth_headers).json()["instrument"]
    res = client.put(f"/api/instruments/{created['id']}", json={"description": "Nouvelle description."}, headers=auth_headers)
    assert res.status_code == 200
    updated = res.json()["instrument"]
    assert updated["description"] == "Nouvelle description."
    assert updated["name"] == LVMH["name"]  # unchanged fields preserved


def test_update_unknown_instrument_returns_404(client, auth_headers):
    res = client.put("/api/instruments/EQUITY:NOPE", json={"description": "x"}, headers=auth_headers)
    assert res.status_code == 404


def test_delete_instrument(client, auth_headers):
    created = client.post("/api/instruments", json=LVMH, headers=auth_headers).json()["instrument"]
    del_res = client.delete(f"/api/instruments/{created['id']}", headers=auth_headers)
    assert del_res.status_code == 204

    get_res = client.get(f"/api/instruments/{created['id']}", headers=auth_headers)
    assert get_res.status_code == 404


def test_delete_unknown_instrument_returns_404(client, auth_headers):
    res = client.delete("/api/instruments/EQUITY:NOPE", headers=auth_headers)
    assert res.status_code == 404
