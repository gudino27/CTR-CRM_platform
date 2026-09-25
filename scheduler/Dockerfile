# Build the SPA, then run the API, which also serves the built files (one container, one port).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server
COPY server server
COPY --from=build /app/client/dist client/dist
ENV DB_PATH=/data/scheduler.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server/src/index.js"]
