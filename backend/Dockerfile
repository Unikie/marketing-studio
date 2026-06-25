FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY src ./src
COPY tsconfig.json ./

RUN mkdir -p /data/uploads
ENV DATA_DIR=/data
ENV NODE_ENV=production
ENV PORT=3001

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 3001
CMD ["/app/entrypoint.sh"]
