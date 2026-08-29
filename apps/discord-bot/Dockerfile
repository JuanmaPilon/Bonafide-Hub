# Build de producción del bot de Discord.
# Incluye ffmpeg (conversión a opus) y python3 (yt-dlp es un script de Python).
# El apt de nixpacks no funcionaba en Railway, así que usamos Dockerfile
# para tener control total del entorno.
FROM node:20-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg python3 libfontconfig1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN npm run build

# Sacamos dependencias de desarrollo para producción.
RUN npm prune --omit=dev

ENV NODE_ENV=production

# Los slash commands se registran con `npm run register` (ya están registrados).
CMD ["node", "dist/index.js"]
