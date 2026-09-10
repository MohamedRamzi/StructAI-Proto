#!/usr/bin/env python3
"""
batch_analyze.py — invoke inference-service's POST /api/analyze (the NLP
parsing of client requests — prompt + LLM call + missing-field detection)
either for a single ad hoc query (console, "unit test" style) or in batch
from a CSV file of {id, query} rows, saving one <id>.json result file per row
and printing timing statistics (count, avg/min/max, total wall-clock time).

This calls inference-service directly (its own /api/analyze), not the main
app's POST /api/parse-query — no pricing, no underlying resolution, just the
raw LLM extraction, which is what makes it useful for testing/tuning the
parsing service in isolation (prompt changes, model changes, latency).

Usage:
    # Single query, unit-test style — result printed to the console.
    python batch_analyze.py --query "Autocall LVMH 3 ans PDI 70%"

    # Batch from a CSV file (columns: id,query — extra columns are ignored),
    # one result written to <output-dir>/<id>.json per row.
    python batch_analyze.py --csv requests.csv --output-dir out/

Run with a Python that has httpx + python-dotenv installed — the
inference-service venv already does:
    inference-service/.venv/bin/python scripts/batch_analyze.py ...

Auth/URL default to INFERENCE_SERVICE_URL / INFERENCE_SERVICE_API_KEY, loaded
from the repo root's .env (next to this script's parent directory) unless
overridden with --url / --token / --env-file.
"""
import argparse
import csv
import json
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent


@dataclass
class AnalyzeResult:
    id: str
    query: str
    duration_seconds: float
    http_status: Optional[int]
    response: dict


def call_analyze(base_url: str, token: str, query: str, timeout: float, pipeline: Optional[str] = None) -> tuple[Optional[int], dict, float]:
    """Calls POST {base_url}/api/analyze. Never raises — network/timeout errors
    are captured into the same {"success": false, "error": ...} envelope the
    service itself uses on failure, so callers always get a uniform,
    inspectable result instead of a crashed batch (no silent fallback: the
    error is always visible in the saved JSON, just never fatal to the run).

    `pipeline` is forwarded as-is when given ("routed" — the default the
    service applies — or "single" for the legacy flat-schema single call)."""
    url = f"{base_url.rstrip('/')}/api/analyze"
    payload: dict = {"query": query}
    if pipeline:
        payload["pipeline"] = pipeline
    started = time.perf_counter()
    try:
        resp = httpx.post(
            url,
            json=payload,
            headers={"Authorization": f"Bearer {token}"} if token else {},
            timeout=timeout,
        )
        duration = time.perf_counter() - started
        try:
            body = resp.json()
        except ValueError:
            body = {"success": False, "error": f"Réponse non-JSON (HTTP {resp.status_code}) : {resp.text[:500]}"}
        return resp.status_code, body, duration
    except httpx.TimeoutException as exc:
        duration = time.perf_counter() - started
        return None, {"success": False, "error": f"Timeout après {timeout}s : {exc}"}, duration
    except httpx.RequestError as exc:
        duration = time.perf_counter() - started
        return None, {
            "success": False,
            "error": f"Erreur réseau : {exc}. Vérifiez qu'inference-service tourne sur {base_url}.",
        }, duration


def print_stats(results: list[AnalyzeResult], wall_clock_seconds: float) -> None:
    durations = [r.duration_seconds for r in results]
    successes = sum(1 for r in results if r.response.get("success") is True)
    failures = len(results) - successes

    print("\n" + "=" * 60)
    print("STATISTIQUES")
    print("=" * 60)
    print(f"Requêtes traitées  : {len(results)}  ({successes} succès, {failures} échec(s))")
    if durations:
        print(f"Temps moyen / req. : {sum(durations) / len(durations):.2f} s")
        print(f"Temps min / req.   : {min(durations):.2f} s")
        print(f"Temps max / req.   : {max(durations):.2f} s")
    print(f"Temps global       : {wall_clock_seconds:.2f} s")
    print("=" * 60)


def make_envelope(result: AnalyzeResult) -> dict:
    return {
        "id": result.id,
        "query": result.query,
        "durationSeconds": round(result.duration_seconds, 3),
        "httpStatus": result.http_status,
        "response": result.response,
    }


def _routing_summary(body: dict) -> str:
    """One-line recap of how the routed pipeline classified each quote, for the
    console. Empty string when the response carries no routing info (e.g.
    pipeline=single or an error envelope)."""
    quotes = body.get("quotes") if isinstance(body, dict) else None
    if not isinstance(quotes, list):
        return ""
    parts = []
    for q in quotes:
        routing = (q or {}).get("routing") or {}
        prompt_key = routing.get("promptKey")
        if prompt_key:
            parts.append(f"#{q.get('quoteId', '?')}->{prompt_key}(p{routing.get('scopePrecision', '?')})")
    return ("  [" + ", ".join(parts) + "]") if parts else ""


def run_single(base_url: str, token: str, query: str, timeout: float, output_dir: Optional[Path], pipeline: Optional[str]) -> None:
    wall_start = time.perf_counter()
    status, body, duration = call_analyze(base_url, token, query, timeout, pipeline)
    wall_clock = time.perf_counter() - wall_start

    result = AnalyzeResult(id="single", query=query, duration_seconds=duration, http_status=status, response=body)
    envelope = make_envelope(result)

    print(json.dumps(envelope, indent=2, ensure_ascii=False))

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{result.id}.json"
        out_path.write_text(json.dumps(envelope, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n[Sauvegardé] {out_path}", file=sys.stderr)

    print_stats([result], wall_clock)
    if not body.get("success"):
        sys.exit(1)


def load_csv_rows(csv_path: Path) -> list[dict]:
    with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        if not reader.fieldnames:
            print(f"[Erreur] Fichier CSV vide ou illisible : {csv_path}", file=sys.stderr)
            sys.exit(1)
        normalized = {name: name.strip().lower() for name in reader.fieldnames}
        if "id" not in normalized.values() or "query" not in normalized.values():
            print(
                f"[Erreur] Le CSV doit contenir des colonnes 'id' et 'query' "
                f"(colonnes trouvées : {list(reader.fieldnames)}).",
                file=sys.stderr,
            )
            sys.exit(1)
        return [{normalized[k]: v for k, v in raw_row.items() if k in normalized} for raw_row in reader]


def run_batch(base_url: str, token: str, csv_path: Path, output_dir: Path, timeout: float, pipeline: Optional[str]) -> None:
    rows = load_csv_rows(csv_path)
    if not rows:
        print(f"[Erreur] Aucune ligne dans {csv_path}.", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    seen_ids: set[str] = set()
    results: list[AnalyzeResult] = []

    wall_start = time.perf_counter()
    for i, row in enumerate(rows, start=1):
        row_id = (row.get("id") or "").strip()
        query = (row.get("query") or "").strip()

        if not row_id:
            print(f"[Avertissement] Ligne {i} ignorée : id manquant.", file=sys.stderr)
            continue
        if row_id in seen_ids:
            print(f"[Avertissement] id '{row_id}' dupliqué — le fichier de sortie sera écrasé.", file=sys.stderr)
        seen_ids.add(row_id)

        preview = query[:70] + ("..." if len(query) > 70 else "")
        print(f"[{i}/{len(rows)}] id={row_id} : \"{preview}\"", file=sys.stderr)

        if not query:
            status, body, duration = None, {"success": False, "error": "query vide ou manquante pour cet id."}, 0.0
        else:
            status, body, duration = call_analyze(base_url, token, query, timeout, pipeline)

        result = AnalyzeResult(id=row_id, query=query, duration_seconds=duration, http_status=status, response=body)
        results.append(result)

        out_path = output_dir / f"{row_id}.json"
        out_path.write_text(json.dumps(make_envelope(result), indent=2, ensure_ascii=False), encoding="utf-8")

        status_label = "OK" if body.get("success") else "ÉCHEC"
        print(f"    -> {status_label} en {duration:.2f}s -> {out_path.name}{_routing_summary(body)}", file=sys.stderr)

    wall_clock = time.perf_counter() - wall_start
    print_stats(results, wall_clock)

    failures = sum(1 for r in results if not r.response.get("success"))
    if failures:
        print(f"\n{failures} requête(s) en échec — voir les fichiers JSON correspondants dans {output_dir}.", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Invoque inference-service POST /api/analyze — requête unique ou batch CSV.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query", help="Requête unique (texte client) à analyser — résultat affiché sur la console.")
    mode.add_argument("--csv", type=Path, help="Fichier CSV avec des colonnes 'id' et 'query' — traitement par lot.")
    parser.add_argument(
        "--output-dir", type=Path,
        help="Répertoire où écrire les fichiers <id>.json (requis avec --csv, optionnel avec --query).",
    )
    parser.add_argument("--url", help="URL de base d'inference-service (défaut : $INFERENCE_SERVICE_URL ou http://localhost:4001).")
    parser.add_argument("--token", help="Jeton d'authentification — clé API isk_... ou JWT (défaut : $INFERENCE_SERVICE_API_KEY).")
    parser.add_argument("--timeout", type=float, default=120.0, help="Timeout HTTP par requête, en secondes (défaut : 120).")
    parser.add_argument(
        "--pipeline", choices=("routed", "single"),
        help="Pipeline d'analyse : 'routed' (défaut du service — routeur + pré-prompt par scope + schéma riche) "
             "ou 'single' (un seul appel, pré-prompt 'default', schéma plat generic/v1). Omis = laisser le service décider.",
    )
    parser.add_argument(
        "--env-file", type=Path, default=REPO_ROOT / ".env",
        help="Fichier .env à charger pour INFERENCE_SERVICE_URL / INFERENCE_SERVICE_API_KEY (défaut : .env à la racine du repo).",
    )
    args = parser.parse_args()

    if args.csv and not args.output_dir:
        parser.error("--output-dir est requis avec --csv.")

    if args.env_file.exists():
        load_dotenv(args.env_file)

    base_url = args.url or os.environ.get("INFERENCE_SERVICE_URL") or "http://localhost:4001"
    token = args.token or os.environ.get("INFERENCE_SERVICE_API_KEY") or ""
    if not token:
        print(
            "[Avertissement] Aucun jeton fourni (--token / INFERENCE_SERVICE_API_KEY) "
            "— les requêtes échoueront probablement avec 401.",
            file=sys.stderr,
        )

    if args.query:
        run_single(base_url, token, args.query, args.timeout, args.output_dir, args.pipeline)
    else:
        run_batch(base_url, token, args.csv, args.output_dir, args.timeout, args.pipeline)


if __name__ == "__main__":
    main()
