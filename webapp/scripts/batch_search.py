#!/usr/bin/env python3
"""
batch_search.py — invoke inference-service's POST /api/instruments/search
(semantic search over instruments — embeddings + ChromaDB) either for a
single ad hoc query (console, "unit test" style) or in batch from a CSV file
of {id, query} rows, saving one <id>.txt result file per row and printing
timing statistics (count, avg/min/max, total wall-clock time).

Unlike batch_analyze.py, the saved output per request is NOT JSON — just a
plain-text, human-readable ranked summary of the search results (or the raw
error message on failure), one string per query, as requested.

Usage:
    # Single query, unit-test style — result printed to the console.
    python batch_search.py --query "un stock europeen du luxe qui price bien"

    # Batch from a CSV file (columns: id,query — optional per-row columns
    # assetClass,limit override --asset-class/--limit; extra columns ignored),
    # one result written to <output-dir>/<id>.txt per row.
    python batch_search.py --csv requests.csv --output-dir out/

Run with a Python that has httpx + python-dotenv installed — the
inference-service venv already does:
    inference-service/.venv/bin/python scripts/batch_search.py ...

Auth/URL default to INFERENCE_SERVICE_URL / INFERENCE_SERVICE_API_KEY, loaded
from the repo root's .env unless overridden with --url / --token / --env-file.
"""
import argparse
import csv
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
class SearchResult:
    id: str
    query: str
    duration_seconds: float
    http_status: Optional[int]
    text: str
    success: bool


def call_search(base_url: str, token: str, query: str, asset_class: Optional[str], limit: int, timeout: float) -> tuple[Optional[int], dict, float]:
    """Calls POST {base_url}/api/instruments/search. Never raises — network/timeout
    errors are captured into the same {"success": false, "error": ...} envelope the
    service itself uses on failure (no silent fallback: always visible, never fatal
    to the run)."""
    url = f"{base_url.rstrip('/')}/api/instruments/search"
    payload: dict = {"query": query, "limit": limit}
    if asset_class:
        payload["assetClass"] = asset_class

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


def format_search_result(body: dict) -> str:
    """Renders the JSON response as a single human-readable string: a ranked
    list of "code — name (score)" lines with the description underneath, or
    the error message on failure."""
    if not body.get("success"):
        return f"ERREUR: {body.get('error', 'erreur inconnue')}"

    results = body.get("results") or []
    if not results:
        return "Aucun résultat."

    lines = []
    for i, item in enumerate(results, start=1):
        score = item.get("score")
        score_str = f"{score:.4f}" if isinstance(score, (int, float)) else "?"
        lines.append(f"{i}. {item.get('code')} — {item.get('name')} [{item.get('assetClass', '')}] (score: {score_str})")
        description = (item.get("description") or "").strip()
        if description:
            lines.append(f"   {description}")
    return "\n".join(lines)


def print_stats(results: list[SearchResult], wall_clock_seconds: float) -> None:
    durations = [r.duration_seconds for r in results]
    successes = sum(1 for r in results if r.success)
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


def run_single(base_url: str, token: str, query: str, asset_class: Optional[str], limit: int, timeout: float, output_dir: Optional[Path]) -> None:
    wall_start = time.perf_counter()
    status, body, duration = call_search(base_url, token, query, asset_class, limit, timeout)
    wall_clock = time.perf_counter() - wall_start

    text = format_search_result(body)
    result = SearchResult(id="single", query=query, duration_seconds=duration, http_status=status, text=text, success=bool(body.get("success")))

    print(text)

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        out_path = output_dir / f"{result.id}.txt"
        out_path.write_text(text, encoding="utf-8")
        print(f"\n[Sauvegardé] {out_path}", file=sys.stderr)

    print_stats([result], wall_clock)
    if not result.success:
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


def run_batch(base_url: str, token: str, csv_path: Path, output_dir: Path, asset_class: Optional[str], limit: int, timeout: float) -> None:
    rows = load_csv_rows(csv_path)
    if not rows:
        print(f"[Erreur] Aucune ligne dans {csv_path}.", file=sys.stderr)
        sys.exit(1)

    output_dir.mkdir(parents=True, exist_ok=True)
    seen_ids: set[str] = set()
    results: list[SearchResult] = []

    wall_start = time.perf_counter()
    for i, row in enumerate(rows, start=1):
        row_id = (row.get("id") or "").strip()
        query = (row.get("query") or "").strip()
        row_asset_class = (row.get("assetclass") or "").strip() or asset_class
        row_limit_raw = (row.get("limit") or "").strip()
        row_limit = int(row_limit_raw) if row_limit_raw.isdigit() else limit

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
            status, body, duration = call_search(base_url, token, query, row_asset_class, row_limit, timeout)

        text = format_search_result(body)
        result = SearchResult(id=row_id, query=query, duration_seconds=duration, http_status=status, text=text, success=bool(body.get("success")))
        results.append(result)

        out_path = output_dir / f"{row_id}.txt"
        out_path.write_text(text, encoding="utf-8")

        status_label = "OK" if result.success else "ÉCHEC"
        print(f"    -> {status_label} en {duration:.2f}s -> {out_path.name}", file=sys.stderr)

    wall_clock = time.perf_counter() - wall_start
    print_stats(results, wall_clock)

    failures = sum(1 for r in results if not r.success)
    if failures:
        print(f"\n{failures} requête(s) en échec — voir les fichiers .txt correspondants dans {output_dir}.", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Invoque inference-service POST /api/instruments/search — requête unique ou batch CSV.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--query", help="Requête unique (texte libre ou ticker) — résultat affiché sur la console.")
    mode.add_argument("--csv", type=Path, help="Fichier CSV avec des colonnes 'id' et 'query' — traitement par lot.")
    parser.add_argument(
        "--output-dir", type=Path,
        help="Répertoire où écrire les fichiers <id>.txt (requis avec --csv, optionnel avec --query).",
    )
    parser.add_argument("--asset-class", default=None, help="Filtre optionnel par classe d'actif (ex: EQUITY). Surchargeable par ligne via une colonne 'assetClass' dans le CSV.")
    parser.add_argument("--limit", type=int, default=5, help="Nombre max. de résultats par requête (défaut : 5). Surchargeable par ligne via une colonne 'limit' dans le CSV.")
    parser.add_argument("--url", help="URL de base d'inference-service (défaut : $INFERENCE_SERVICE_URL ou http://localhost:4001).")
    parser.add_argument("--token", help="Jeton d'authentification — clé API isk_... ou JWT (défaut : $INFERENCE_SERVICE_API_KEY).")
    parser.add_argument("--timeout", type=float, default=60.0, help="Timeout HTTP par requête, en secondes (défaut : 60).")
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
        run_single(base_url, token, args.query, args.asset_class, args.limit, args.timeout, args.output_dir)
    else:
        run_batch(base_url, token, args.csv, args.output_dir, args.asset_class, args.limit, args.timeout)


if __name__ == "__main__":
    main()
