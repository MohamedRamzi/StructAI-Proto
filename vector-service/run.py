"""Entry point: `python run.py` (dev) — reads PORT from .env via app.config."""
import uvicorn

from app import config

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=config.PORT, reload=True)
