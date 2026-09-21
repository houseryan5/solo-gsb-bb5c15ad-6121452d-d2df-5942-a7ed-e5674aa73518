FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# 先拷贝依赖清单，充分利用构建缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY src ./src
COPY public ./public

# 数据目录（保存的分析记录），以非 root 用户运行
RUN mkdir -p /app/data/analyses && chown -R node:node /app
USER node

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
