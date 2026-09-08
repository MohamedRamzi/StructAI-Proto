# The `app` service in docker-compose.yml — this service NEVER imports vllm,
# so this image stays small and GPU-free. Only httpx is used to reach the two
# vLLM sidecars (vllm-chat, vllm-embed), themselves built from the official
# vllm/vllm-openai image (see docker-compose.yml).
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 4001

CMD ["python", "run.py"]
