FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 先装依赖，利用镜像层缓存
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

# 数据目录（可用卷挂载持久化）
ENV DATA_DIR=/app/data
RUN mkdir -p /app/data && chown -R node:node /app
USER node

EXPOSE 3000
CMD ["node", "server.js"]
