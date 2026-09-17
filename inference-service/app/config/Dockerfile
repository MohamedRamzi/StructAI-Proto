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
# CA.pem is copied from the build context root (inference-service/CA.pem —
# the same cert the vLLM sidecars trust via /srv/CA.pem, see
# ../../config/docker-compose.yml, just placed inside this build context
# too) to /srv/CA.pem in the image, matching that same path convention.
# A `RUN --mount=type=bind,source=/srv/CA.pem,...` (reading the host's
# /srv/CA.pem directly at build time, nothing copied into the image) was
# tried first but didn't work in this environment — plain COPY does, so
# that's what's used. One consequence of COPY over the bind-mount: the cert
# ends up baked into an image layer, unlike the bind-mount approach — fine
# for a CA cert (public trust material, not a secret/private key), but
# worth knowing if that image is ever pushed somewhere less trusted.
#
# PIP_INDEX_URL is a normal (persistent) ENV — harmless at runtime, and it
# means an ad-hoc `docker exec ... pip install` later still goes through the
# mirror instead of trying (and failing) to reach the public internet.
ENV PIP_INDEX_URL=https://artifactory.mycloud.intranatixis.com/artifactory/api/pypi/python/simple

COPY CA.pem /srv/CA.pem
COPY requirements.txt .
RUN PIP_CERT=/srv/CA.pem pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
