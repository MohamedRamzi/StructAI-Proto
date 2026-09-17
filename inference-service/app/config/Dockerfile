# syntax=docker/dockerfile:1
# The above parser directive MUST be the file's first line (Docker only scans
# leading comment lines for it) — it opts into the `RUN --mount=type=bind`
# form used below, needed to reach /srv/CA.pem at build time. Requires
# BuildKit, the default backend for `docker build` / `docker compose build`
# on any reasonably current Docker Engine; if it's ever disabled, set
# DOCKER_BUILDKIT=1 (or COMPOSE_BAKE / a compose.yml `x-bake` override) before
# building.
#
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
# Pinned (not the floating `slim-trixie` tag) so a rebuild always gets the
# same Python — confirmed compatible 2026-09-17: `pip install -r
# requirements.txt` installs entirely from precompiled wheels and the full
# pytest suite (188 tests) passes unmodified. User confirmed this exact tag
# pulls through the internal Artifactory Docker Hub proxy (2026-09-17), same
# pattern as vllm/vllm-openai in ../../config/docker-compose.yml. Bump the
# version deliberately, not by drifting with the base tag.
FROM docker-proxy-dockerhub.artifactory.mycloud.intrabpce.fr/python:3.14.7-slim-trixie

WORKDIR /app

# pip must go through the internal Artifactory PyPI mirror, trusting its CA
# (the outside world isn't reachable from this network) — same two settings
# either way: a pip.conf [global] section (cert / index-url) or, as used
# here, the equivalent PIP_CERT / PIP_INDEX_URL env vars pip maps them to.
#
# /srv/CA.pem is a HOST path (same file the vLLM sidecars trust — see
# ../../config/docker-compose.yml), outside this Dockerfile's build context,
# so a plain COPY can't reach it. `--mount=type=bind` exposes it to this ONE
# RUN layer only, at build time — it's never copied into an image layer, so
# it doesn't need to exist at runtime and isn't baked into the final image.
# Needs /srv/CA.pem present on whatever machine actually runs `docker build`
# (i.e. the deployment host — this isn't built elsewhere and pushed).
#
# PIP_INDEX_URL is also kept as a normal (persistent) ENV below — harmless at
# runtime, and it means an ad-hoc `docker exec ... pip install` later still
# goes through the mirror instead of trying (and failing) to reach the public
# internet.
ENV PIP_INDEX_URL=https://artifactory.mycloud.intranatixis.com/artifactory/api/pypi/python/simple

COPY requirements.txt .
RUN --mount=type=bind,source=/srv/CA.pem,target=/srv/CA.pem \
    PIP_CERT=/srv/CA.pem pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
