# The `app` service in ./docker-compose.app.yml (this file lives right next
# to it, inference-service/app/config/) — this service NEVER imports vllm, so
# this image stays small and GPU-free. Only httpx is used to reach the two
# vLLM sidecars (vllm-chat, vllm-embedding), which run as their own,
# separately started/stopped Compose stack (see ../../config/docker-compose.yml)
# built from the official vllm/vllm-openai image.
#
# Build context is inference-service/ (two levels up from this file — see
# docker-compose.app.yml's `build:`), because COPY . . below needs
# requirements.txt, run.py, app/, public/, prompts/ — all siblings of this
# file's own app/config/ directory, not inside it.
#
# `slim-trixie` currently resolves to Python 3.14 (Debian 13) — confirmed
# compatible 2026-09-17: `pip install -r requirements.txt` installs entirely
# from precompiled wheels and the full pytest suite (188 tests) passes
# unmodified. It's a FLOATING tag — a future rebuild picks up whatever
# `slim-trixie` points to then (e.g. once 3.15 is promoted), not necessarily
# 3.14 — pin to an exact tag (e.g. 3.14.7-slim-trixie) instead if that drift
# is undesirable. Pulled through the internal Artifactory Docker Hub proxy,
# same pattern as vllm/vllm-openai in ../../config/docker-compose.yml.
FROM docker-proxy-dockerhub.artifactory.mycloud.intrabpce.fr/python:slim-trixie

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
