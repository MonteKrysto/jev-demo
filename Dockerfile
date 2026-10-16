FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS development
ENV NODE_ENV=development HOST=0.0.0.0
# concurrently uses ps to terminate its child processes cleanly.
RUN apt-get update && apt-get install -y --no-install-recommends procps && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node . .
RUN install -d -o node -g node /app/.data /app/node_modules/.vite /app/node_modules/.vite-temp
# Node 22 watch mode needs this path to exist even with --env-file-if-exists.
# Secrets still come from Compose environment variables, never this empty file.
RUN touch /app/.env
USER node
EXPOSE 3001
CMD ["npm", "run", "dev"]

FROM dependencies AS build
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS production
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --from=build --chown=node:node /app /app
RUN install -d -o node -g node /app/.data
USER node
EXPOSE 3001
CMD ["npm", "start"]
