FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# python3 lets the agent's run_script tool execute Python.
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data && chown node:node /data
WORKDIR /app
COPY --from=build --chown=root:root /app/package.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/server/package.json ./server/
COPY --from=build --chown=root:root /app/server/dist ./server/dist
COPY --from=build --chown=root:root /app/web/dist ./web/dist
ENV NODE_ENV=production SABLE_DATA_DIR=/data PORT=8787
# Run unprivileged: the app code is read-only to it; only /data is writable.
USER node
VOLUME /data
# 8787: the private app. 8788: the optional public front (set SABLE_PUBLIC_PORT=8788).
EXPOSE 8787 8788
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
