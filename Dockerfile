FROM node:22.23.3-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates make python3 g++ pkg-config libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV COREPACK_HOME=/app/.sites-runtime/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    CLOUDFLARE_CF_FETCH_ENABLED=false \
    WRANGLER_SEND_METRICS=false \
    WRANGLER_WRITE_LOGS=false \
    SHARP_IGNORE_GLOBAL_LIBVIPS=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc .nvmrc ./
COPY scripts/check-runtime.mjs scripts/setup.mjs ./scripts/
RUN node scripts/setup.mjs

COPY . .
RUN make test && make build

# Mount .dev.vars read-only at runtime; the image contains placeholders only.
# This runs a local Worker/D1 preview. Cloud deployment is a separate operator step.
EXPOSE 8787
CMD ["make", "container-start"]
