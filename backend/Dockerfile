FROM node:20-slim

ARG BUILD_SHA=unknown
ARG BUILD_TIME=unknown

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./

RUN mkdir -p /data/uploads
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3001
ENV BUILD_SHA=$BUILD_SHA
ENV BUILD_TIME=$BUILD_TIME

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3001
CMD ["/app/entrypoint.sh"]
