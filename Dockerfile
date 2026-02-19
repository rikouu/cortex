FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install dependencies
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/server/package.json packages/server/
COPY packages/bridge-openclaw/package.json packages/bridge-openclaw/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/mcp-client/package.json packages/mcp-client/
RUN pnpm install --frozen-lockfile

# Copy source
COPY . .

# Build dashboard
RUN cd packages/dashboard && pnpm build || true

EXPOSE 21100

CMD ["npx", "tsx", "packages/server/src/index.ts"]
