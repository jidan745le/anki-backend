FROM node:18.0-slim as build-stage

WORKDIR /app

COPY package.json .

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    wget \
    && rm -rf /var/lib/apt/lists/*

RUN npm install

COPY . .

RUN npm run build

# production stage
FROM node:18.0-slim as production-stage

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

# 创建非 root 用户 (Debian 风格)
RUN groupadd -r appgroup && useradd -r -g appgroup appuser

COPY --from=build-stage --chown=appuser:appgroup /app/dist /app
COPY --from=build-stage --chown=appuser:appgroup /app/package.json /app/package.json
COPY --from=build-stage --chown=appuser:appgroup /app/src/.env /app/.env

WORKDIR /app

USER appuser

RUN npm install --production

EXPOSE 3000

CMD ["node", "main.js"]