FROM node:18.17-slim as build-stage

WORKDIR /app

COPY package.json .

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    wget \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN npm install

COPY . .

RUN npm run build

# production stage
FROM node:18.17-slim as production-stage

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

# 先复制 package.json 和 package-lock.json
COPY --from=build-stage /app/package*.json ./

# 安装生产依赖（以 root 用户身份）
RUN npm install --production

# 复制编译后的代码
COPY --from=build-stage /app/dist ./
COPY --from=build-stage /app/src/.env ./.env

# 创建非 root 用户并更改文件所有权
RUN groupadd -r appgroup && useradd -r -g appgroup appuser && \
    chown -R appuser:appgroup /app

# 切换到非 root 用户
USER appuser

EXPOSE 3000

CMD ["node", "main.js"]