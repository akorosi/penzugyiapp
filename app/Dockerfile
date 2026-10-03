# Helyi futtatás (Docker Compose). AWS-en a Lambda csomagot a
# scripts/build_lambda.sh állítja össze, ez a kép csak helyi fejlesztéshez kell.

# --- 1. lépés: a React / Radix UI frontend statikus buildje ---
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# --- 2. lépés: Flask API + a lebuildelt felület kiszolgálása ---
FROM python:3.13-slim

WORKDIR /app

COPY app/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ .
COPY --from=web /web/dist /app/web

EXPOSE 5000

CMD ["python", "main.py"]
