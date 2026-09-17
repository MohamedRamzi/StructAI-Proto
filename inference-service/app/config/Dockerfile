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

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
