# --- 1. lépés: a React / Radix UI frontend statikus buildje ---
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2. lépés: Flask API + a lebuildelt felület kiszolgálása ---
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .
COPY --from=web /web/dist /app/web

RUN mkdir -p /data /app/uploads

EXPOSE 5000

CMD ["python", "main.py"]
