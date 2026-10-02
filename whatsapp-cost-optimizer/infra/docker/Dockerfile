# syntax=docker/dockerfile:1.7
#
# One Dockerfile, four targets (build context = repository root of the project):
#   docker build -f infra/docker/Dockerfile --target api    -t wco-api .
#   docker build -f infra/docker/Dockerfile --target worker -t wco-worker .
#   docker build -f infra/docker/Dockerfile --target web    -t wco-web .
#   docker build -f infra/docker/Dockerfile --target tools  -t wco-tools .   (migrations, seed, CLIs)
#
# Behind a TLS-intercepting corporate proxy, pass its CA as a BuildKit secret:
#   docker build --secret id=ca,src=/path/to/proxy-ca.pem --build-arg HTTPS_PROXY=... ...
ARG NODE_IMAGE=node:22-alpine

# ---------------------------------------------------------------------------------------- base
FROM ${NODE_IMAGE} AS base
ENV CI=true \
    PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1
# The Alpine image already ships libssl 3, which the Prisma schema engine (migrations) needs.
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm install -g pnpm@10.28.0 --no-fund --no-audit
WORKDIR /app

# ---------------------------------------------------------------------------------------- deps
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY packages/logging/package.json packages/logging/
COPY packages/optimization/package.json packages/optimization/
COPY packages/policy/package.json packages/policy/
COPY packages/pricing/package.json packages/pricing/
COPY packages/services/package.json packages/services/
COPY packages/simulator/package.json packages/simulator/
COPY packages/testing/package.json packages/testing/
COPY packages/whatsapp/package.json packages/whatsapp/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------------------- build
FROM deps AS build
COPY . .
RUN pnpm --filter @wco/database run generate \
 && pnpm --filter @wco/api --filter @wco/worker run build
# The dashboard talks to the API through its own server-side BFF; no API URL is baked into the bundle.
RUN pnpm --filter @wco/web run build

# ---------------------------------------------------------------------------------------- prod deps
FROM base AS prod-deps
COPY --from=deps /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=deps /app/apps/api/package.json apps/api/
COPY --from=deps /app/apps/worker/package.json apps/worker/
COPY --from=deps /app/packages packages
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    pnpm config set store-dir /pnpm/store \
 && pnpm install --frozen-lockfile --prod --ignore-scripts --filter @wco/api --filter @wco/worker

# ---------------------------------------------------------------------------------------- runtime base
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules

# ---------------------------------------------------------------------------------------- api
FROM runtime AS api
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/api/dist/index.js"]

# ---------------------------------------------------------------------------------------- worker
FROM runtime AS worker
COPY --from=prod-deps /app/apps/worker/node_modules ./apps/worker/node_modules
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/package.json
USER node
EXPOSE 9100
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_METRICS_PORT||9100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "apps/worker/dist/index.js"]

# ---------------------------------------------------------------------------------------- web (Next.js standalone)
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---------------------------------------------------------------------------------------- tools (migrate / seed / CLIs)
FROM build AS tools
CMD ["sh", "-c", "pnpm db:migrate && if [ \"${SEED:-false}\" = \"true\" ]; then pnpm db:seed; fi"]
