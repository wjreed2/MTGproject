# dist/ is committed and is exactly what Railway served, so no build step here.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# --include=dev: the server spawns scripts/build-print-fingerprints.js (weekly
# scanner top-up, admin rebuild), which needs sharp, listed as a devDependency.
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force
COPY --chown=node:node . .
ARG GIT_COMMIT=""
ENV GIT_COMMIT=${GIT_COMMIT} PORT=80
# Docker lets unprivileged users bind <1024 inside the container namespace.
USER node
EXPOSE 80
CMD ["node", "server.js"]
