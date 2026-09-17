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
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
