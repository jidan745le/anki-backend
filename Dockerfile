FROM node:18.17-alpine3.17 as build-stage

WORKDIR /app
# 安装指定版本的 npm
RUN npm install -g npm@10.2.3

# 验证 npm 版本
RUN echo "NPM Version:" && npm -v

COPY package.json .
COPY package-lock.json .

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ffmpeg

RUN npm install

COPY . .

RUN npm run build

# production stage
FROM node:18.17-alpine3.17 as production-stage

RUN apk add --no-cache ffmpeg chromium

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV NODE_ENV=production

# 创建非 root 用户
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# 安装指定版本的 npm
RUN npm install -g npm@10.2.3

# 验证 npm 版本
RUN echo "NPM Version:" && npm -v

COPY --from=build-stage --chown=appuser:appgroup /app/dist /app
COPY --from=build-stage --chown=appuser:appgroup /app/package.json /app/package.json
COPY --from=build-stage --chown=appuser:appgroup /app/package-lock.json /app/package-lock.json

WORKDIR /app

USER appuser

RUN npm install --production

# 切换到非 root 用户

EXPOSE 3000

CMD ["node", "/app/main.js"]