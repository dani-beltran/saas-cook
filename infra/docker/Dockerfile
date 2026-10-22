FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS bun
FROM node:24.19.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS dependencies
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /source
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1
RUN bun install --frozen-lockfile

FROM dependencies AS build
RUN bun run build:customer

FROM dependencies AS backoffice-build
RUN bun run build:backoffice

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:59c479c9b8c123e66047315c968aa2d35e31ae5149c856e4110a79c8b3563f0b AS backoffice
ARG SOURCE_COMMIT=unknown
ARG SOURCE_FINGERPRINT=unknown
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT dev.saas-cook.source-fingerprint=$SOURCE_FINGERPRINT org.opencontainers.image.title="saas-cook-backoffice"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3001
COPY --from=backoffice-build --chown=65532:65532 /source/apps/backoffice/.next/standalone ./
COPY --from=backoffice-build --chown=65532:65532 /source/apps/backoffice/.next/static ./apps/backoffice/.next/static
COPY --from=backoffice-build --chown=65532:65532 /source/apps/backoffice/public ./apps/backoffice/public
COPY --from=backoffice-build --chown=65532:65532 /source/dist/backoffice/start.cjs ./start.cjs
USER 65532:65532
EXPOSE 3001
HEALTHCHECK --interval=5s --timeout=4s --start-period=30s --retries=3 CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:3001/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/nodejs/bin/node", "/app/start.cjs"]

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:59c479c9b8c123e66047315c968aa2d35e31ae5149c856e4110a79c8b3563f0b AS app
ARG SOURCE_COMMIT=unknown
ARG SOURCE_FINGERPRINT=unknown
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
LABEL dev.saas-cook.source-fingerprint=$SOURCE_FINGERPRINT
LABEL org.opencontainers.image.title="saas-cook"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 MIGRATIONS_DIR=/app/migrations
COPY --from=build --chown=65532:65532 /source/apps/web/.next/standalone ./
COPY --from=build --chown=65532:65532 /source/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=65532:65532 /source/apps/web/public ./apps/web/public
COPY --from=build --chown=65532:65532 /source/dist ./dist
COPY --from=build --chown=65532:65532 /source/packages/db/migrations ./migrations
COPY --chown=65532:65532 infra/docker/entrypoint.mjs infra/docker/healthcheck.cjs ./infra/docker/
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=4s --start-period=30s --retries=3 CMD ["/nodejs/bin/node", "/app/infra/docker/healthcheck.cjs"]
ENTRYPOINT ["/nodejs/bin/node", "/app/infra/docker/entrypoint.mjs"]
CMD ["serve"]
