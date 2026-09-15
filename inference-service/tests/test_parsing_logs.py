"""
The parsing_logs audit trail: routers/analyze.py writes one row per POST
/api/analyze call (success or failure), and /api/parsing-logs exposes
read (any authenticated user) + delete (admin) access to it, paginated like
/api/instruments.
"""
import json

import pytest

from .test_analyze_integration import GENERIC_EXTRACTION, ROUTER_EQUITY_AUTOCALL, make_fake_chat


@pytest.fixture()
def member_headers(client, auth_headers):
    client.post(
        "/api/users",
        json={"email": "member@test.local", "password": "member-password", "role": "user"},
        headers=auth_headers,
    )
    token = client.post(
        "/api/auth/login", json={"email": "member@test.local", "password": "member-password"}
    ).json()["token"]
    return {"Authorization": f"Bearer {token}"}


def test_a_successful_routed_call_logs_routing_and_extraction_with_durations(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    res = client.post("/api/analyze", json={"query": "Autocall LVMH 3 ans PDI 70%"}, headers=auth_headers)
    assert res.status_code == 200

    logs = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"]
    assert len(logs) == 1
    log = logs[0]
    assert log["query"] == "Autocall LVMH 3 ans PDI 70%"
    assert log["pipeline"] == "routed"
    assert log["success"] is True
    assert log["errorMessage"] is None
    assert log["createdBy"] == "admin@test.local"
    assert log["chatModel"]  # whatever llm_settings.model is seeded to
    assert log["embeddingModel"]
    assert log["routingResult"] == [{**ROUTER_EQUITY_AUTOCALL, "label": None}]
    assert log["extractionResult"][0]["schemaVersion"] == "generic/v1"
    assert isinstance(log["routingDurationMs"], int) and log["routingDurationMs"] >= 0
    assert isinstance(log["extractionDurationMs"], int) and log["extractionDurationMs"] >= 0
    assert isinstance(log["totalDurationMs"], int) and log["totalDurationMs"] >= log["routingDurationMs"]


def test_route_only_pipeline_logs_routing_but_no_extraction(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], []))
    client.post("/api/analyze", json={"query": "Autocall LVMH", "pipeline": "route"}, headers=auth_headers)

    log = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]
    assert log["pipeline"] == "route"
    assert log["routingResult"] == [{**ROUTER_EQUITY_AUTOCALL, "label": None}]
    assert log["extractionResult"] is None
    assert log["extractionDurationMs"] is None


def test_single_pipeline_logs_extraction_but_no_routing(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user, reasoning_mode=None: json.dumps({"quotes": [GENERIC_EXTRACTION]}))
    client.post("/api/analyze", json={"query": "Autocall LVMH", "pipeline": "single"}, headers=auth_headers)

    log = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]
    assert log["pipeline"] == "single"
    assert log["routingResult"] is None
    assert log["routingDurationMs"] is None
    assert log["extractionResult"][0]["schemaVersion"] == "generic/v1"


def test_a_router_failure_is_logged_with_the_error_and_partial_data(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user, reasoning_mode=None: "désolé, pas de JSON ici")
    res = client.post("/api/analyze", json={"query": "requête imparsable"}, headers=auth_headers)
    assert res.status_code == 500

    log = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]
    assert log["success"] is False
    assert "routage" in log["errorMessage"]
    assert log["routingResult"] is None  # failed before producing any classification
    assert log["extractionResult"] is None


def test_an_empty_quote_list_is_logged_as_a_failure_with_502(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user, reasoning_mode=None: json.dumps({"quotes": []}))
    res = client.post("/api/analyze", json={"query": "single vide", "pipeline": "single"}, headers=auth_headers)
    assert res.status_code == 502

    log = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]
    assert log["success"] is False
    assert log["errorMessage"]


def test_logs_are_ordered_most_recent_first(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    for i in range(3):
        client.post("/api/analyze", json={"query": f"requête {i}"}, headers=auth_headers)

    logs = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"]
    assert [l["query"] for l in logs] == ["requête 2", "requête 1", "requête 0"]


def test_list_reports_a_total_independent_of_the_page(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    for i in range(5):
        client.post("/api/analyze", json={"query": f"requête {i}"}, headers=auth_headers)

    res = client.get("/api/parsing-logs", params={"limit": 2, "offset": 0}, headers=auth_headers)
    body = res.json()
    assert body["total"] == 5
    assert len(body["logs"]) == 2

    res2 = client.get("/api/parsing-logs", params={"limit": 2, "offset": 4}, headers=auth_headers)
    assert res2.json()["total"] == 5
    assert len(res2.json()["logs"]) == 1


def test_filters_by_pipeline_success_and_query_text(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    client.post("/api/analyze", json={"query": "Autocall LVMH", "pipeline": "routed"}, headers=auth_headers)
    client.post("/api/analyze", json={"query": "Autocall Kering", "pipeline": "route"}, headers=auth_headers)

    monkeypatch.setattr(inference_client, "chat_completion", lambda system, user, reasoning_mode=None: "pas de json")
    client.post("/api/analyze", json={"query": "TARF EUR/USD"}, headers=auth_headers)

    by_pipeline = client.get("/api/parsing-logs", params={"pipeline": "route"}, headers=auth_headers).json()
    assert by_pipeline["total"] == 1
    assert by_pipeline["logs"][0]["query"] == "Autocall Kering"

    by_success = client.get("/api/parsing-logs", params={"success": "false"}, headers=auth_headers).json()
    assert by_success["total"] == 1
    assert by_success["logs"][0]["query"] == "TARF EUR/USD"

    by_search = client.get("/api/parsing-logs", params={"q": "kering"}, headers=auth_headers).json()
    assert by_search["total"] == 1


def test_get_single_log_returns_its_full_content(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    client.post("/api/analyze", json={"query": "Autocall LVMH"}, headers=auth_headers)
    log_id = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]["id"]

    res = client.get(f"/api/parsing-logs/{log_id}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["log"]["id"] == log_id


def test_get_unknown_log_returns_404(client, auth_headers):
    assert client.get("/api/parsing-logs/999999", headers=auth_headers).status_code == 404


def test_read_requires_authentication(client):
    assert client.get("/api/parsing-logs").status_code == 401
    assert client.get("/api/parsing-logs/1").status_code == 401


def test_member_can_read_but_not_delete(client, member_headers, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    client.post("/api/analyze", json={"query": "Autocall LVMH"}, headers=auth_headers)
    log_id = client.get("/api/parsing-logs", headers=member_headers).json()["logs"][0]["id"]

    assert client.get("/api/parsing-logs", headers=member_headers).status_code == 200
    assert client.delete(f"/api/parsing-logs/{log_id}", headers=member_headers).status_code == 403
    assert client.delete("/api/parsing-logs", headers=member_headers).status_code == 403


def test_admin_can_delete_a_single_log(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    client.post("/api/analyze", json={"query": "Autocall LVMH"}, headers=auth_headers)
    log_id = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]["id"]

    assert client.delete(f"/api/parsing-logs/{log_id}", headers=auth_headers).status_code == 204
    assert client.get(f"/api/parsing-logs/{log_id}", headers=auth_headers).status_code == 404


def test_delete_unknown_log_returns_404(client, auth_headers):
    assert client.delete("/api/parsing-logs/999999", headers=auth_headers).status_code == 404


def test_admin_can_clear_all_logs(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    for i in range(3):
        client.post("/api/analyze", json={"query": f"requête {i}"}, headers=auth_headers)

    res = client.delete("/api/parsing-logs", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["deleted"] == 3
    assert client.get("/api/parsing-logs", headers=auth_headers).json()["total"] == 0


def test_a_call_made_with_a_service_api_key_is_logged_with_the_key_as_caller(client, auth_headers, monkeypatch):
    from app.services import inference_client

    monkeypatch.setattr(inference_client, "chat_completion", make_fake_chat([ROUTER_EQUITY_AUTOCALL], [GENERIC_EXTRACTION]))
    token = client.post("/api/api-keys", json={"label": "main-app"}, headers=auth_headers).json()["token"]

    client.post("/api/analyze", json={"query": "Autocall LVMH"}, headers={"Authorization": f"Bearer {token}"})

    log = client.get("/api/parsing-logs", headers=auth_headers).json()["logs"][0]
    assert log["createdBy"].startswith("apiKey#")
