# Image for the hosted MCP server and the Telegram bot. No Chrome is installed:
# in a hosted deployment the app connects to a remote headless Chrome via
# CHROME_WS_ENDPOINT (the vendored library uses puppeteer-core, which does not
# download Chromium). Pick which process to run with the container command:
#   MCP server (default):  npm run mcp:http
#   Telegram bot:          npm run bot
FROM node:22-slim

WORKDIR /app

# Install dependencies first for better layer caching. The vendored library lives
# under vendor/ and is a file: dependency, so it must be present before install.
COPY package.json package-lock.json ./
COPY vendor ./vendor
COPY .npmrc ./
RUN npm ci

# App source.
COPY tsconfig.json ./
COPY scripts ./scripts
COPY bot ./bot

# Personal files (product-dictionary.json, order-stats.json) are NOT baked in —
# they are gitignored and mounted at runtime. Point the app at them with
# SHUFERSAL_DICT_PATH / SHUFERSAL_ORDER_STATS_PATH (see docker-compose.yml).
ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "mcp:http"]
