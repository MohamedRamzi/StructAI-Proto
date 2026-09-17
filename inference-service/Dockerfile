# The `app` service in docker-compose.app.yml — this service NEVER imports
# vllm, so this image stays small and GPU-free. Only httpx is used to reach
# the two vLLM sidecars (vllm-chat, vllm-embedding), which run as their own,
# separately started/stopped Compose stack (see docker-compose.yml) built
# from the official vllm/vllm-openai image.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
