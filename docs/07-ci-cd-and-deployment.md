# 7. CI/CD and deployment

## 7.1 Delivery decisions and scope

Implement CI/CD with **GitHub Actions**, **Docker BuildKit/buildx**, and **GitHub Container Registry (GHCR)**. The default deployment runs **one application container directly with Docker** on a host or VM. **Kubernetes with Helm is optional**, for products needing independent scaling or orchestration. Set the deployment profile to `docker` by default or explicitly opt into `kubernetes`; Docker builds, installation, and promotion must work without Helm, kubectl, or cluster credentials. Build each release once and promote the same image digests from staging to production within the selected profile.

**Status: planned.** The files, scripts, chart values, and commands below are implementation contracts; this repository does not yet contain a runnable application or pipeline. Phase 0 selects supported tool versions, the host/cloud/region, runner connectivity, and infrastructure ownership. Phase 1 delivers the combined application image and direct Docker staging deployment with synthetic data. Production customer data remains subject to the Phase 6 recovery gate. Kubernetes is an optional deployment extension, not a Foundation, Commercial, or Enterprise milestone prerequisite.

The single container contains the Next.js web process and Node.js background worker. PostgreSQL, OpenFGA, object storage, and enabled providers remain external dependencies configured by URL/credentials; the application image does not embed their servers. Local development can provision these dependencies with Compose, but Compose is not required to run the application container against existing services.

Keep production on a separate host, or a separate cluster when Kubernetes is selected, with separate databases, OpenFGA stores, object storage, secrets, and recovery control plane. Version optional infrastructure provisioning under `infra/terraform/`: Docker hosts or cluster/node pools, networking, registry access, managed data services, identities, and secret-store integration. An existing Docker host can be prepared using the runbook without Terraform. Provisioning uses a separate privileged workflow; application delivery uses an environment-specific host deployment identity or namespace-scoped cluster permissions.

## 7.2 Planned repository deliverables

| Path | Responsibility |
| --- | --- |
| `.github/workflows/ci.yml` | Pull-request and protected default-branch checks |
| `.github/workflows/release.yml` | Build, test, scan, attest, and publish a release; deploy staging |
| `.github/workflows/deploy.yml` | Reusable deployment workflow; production promotion of a verified release |
| `.github/workflows/infra.yml` | Optional provisioning workflow: review infrastructure plans and apply approved environment changes |
| `package.json`, `bun.lock`, `turbo.json` | Pinned Bun package manager, workspace scripts, reproducible dependency graph and build tasks |
| `biome.json`, `commitlint.config.ts`, `lefthook.yml`, `knip.config.ts` | Formatting/lint, Conventional Commits, local Git hooks and unused-code/dependency checks |
| `vitest.config.ts`, `playwright.config.ts`, `packages/ui/.storybook/` | Unit/integration projects, browser journeys and component development/build configuration |
| `packages/config/`, `packages/observability/`, `AGENTS.md` | T3 Env schemas, LogTape/redaction and documented AI coding context/commands |
| `infra/docker/Dockerfile`, `.dockerignore` | Default combined `app` target; optional separate `web`, `worker`, and `migrate` targets for Kubernetes |
| `infra/docker/entrypoint.sh`, `infra/docker/healthcheck.js` | Supervise web/worker, forward signals, expose one-off command modes, and check combined health |
| `infra/helm/common-sass/` | Optional Kubernetes chart, values schema, and web/worker resources |
| `infra/environments/{staging,production}.yaml` | Non-secret profile (`docker` by default), target host or cluster, runtime settings, and secret references |
| `infra/k8s/jobs/` | Optional Kubernetes migration and authorization-publication Job templates |
| `scripts/deploy.sh`, `scripts/rollback.sh` | Profile-aware deployment, release locks, migration execution, health/smoke checks, and recovery decisions |
| `docs/runbooks/deployment.md` | Bootstrap, promotion, failed deployment, rollback, secret rotation, and ownership |

## 7.3 Continuous integration

Run required checks for pull requests and the exact merged commit on the protected default branch. Use Bun for package management and workspace script invocation, with Node.js LTS as the application/tool runtime where required. The planned command contracts are:

| Command | Implementation and purpose |
| --- | --- |
| `bun install --frozen-lockfile` | Reproduce the committed `bun.lock` without changing dependency resolution |
| `bun run check` | Biome CI checks for formatting and lint; `bun run format` provides local formatting |
| `bun run typecheck` | Strict TypeScript checks, including oRPC client/contract inference |
| `bun run commitlint --from <base> --to <head>` | Commitlint Conventional Commits validation for the applicable commit range |
| `bun run knip` | Detect unexplained unused files, exports and dependencies across configured workspaces |
| `bun run test:unit` | Vitest unit suites |
| `bun run test:integration` | Vitest suites using real isolated data/authorization services |
| `bun run test:e2e` | Playwright end-to-end suites |
| `bun run storybook`, `bun run storybook:build` | Storybook local component development and CI static build |
| `bun run authz:validate` | OpenFGA model and assertion validation |
| `bun run build` | Production package and Next.js builds |
| `bun run hooks:install` | Explicit Lefthook installation during local setup |

Lefthook runs Biome checks before commit and Commitlint against the commit message in `commit-msg`. Hooks invoke the same policies as CI. CI checks the PR commit range and proposed squash title, then validates actual new default-branch commits; define squash/merge conventions in `commitlint.config.ts` and fetch enough history to resolve the checked range. Knip configuration includes Next.js routes, oRPC registries, Storybook stories, React Email templates, tests and tooling entry points; document narrow exceptions rather than ignoring whole packages. `AGENTS.md` documents this setup and these commands.

1. Install pinned Node.js/Bun versions and dependencies using `bun install --frozen-lockfile`; cache dependencies with `bun.lock` and tool-version keys. Review dependency lifecycle scripts and Bun trust configuration, and verify required native/tool setup during Phase 0. Install Playwright browser dependencies explicitly for browser jobs. Run Biome, TypeScript, Commitlint, Knip, Vitest unit tests, authorization validation, Storybook and production builds.
2. Start disposable PostgreSQL, OpenFGA with its own database, object storage, and mail capture. Apply migrations to both an empty database and a previous-release fixture. Use real restricted runtime roles and the two-organization synthetic fixtures.
3. Run the applicable Vitest integration and Playwright browser suites for tenant isolation, authorization, entitlements/capacity, API keys and workers. Exercise Zod input/output contracts and policy/error parity through the oRPC RPC and public OpenAPI handlers, next-intl rendering and React Hook Form validation, T3 Env startup rejection, and LogTape redaction. Phase 2 adds Better Auth magic-link/passkey/ownership-transfer suites and React Email rendering/delivery. Phase 4 adds skill-artifact validation, customization/evolution checks and reference/agent-authored feature coverage; isolated skill behavior evaluations produce separate versioned release evidence rather than requiring a live AI service in ordinary CI. Phase 5 adds Stripe billing/checkout/portal/webhook suites. Phase 6 adds product-analytics attribution/controls/deletion and multi-organization account-closure/ownership-continuity recovery suites; later presets add their required module suites. Do not report an unimplemented capability as passed.
4. Build the combined `app` image and test it with direct `docker run`: startup, static assets, web/worker health, child-process failure, graceful shutdown, migration modes, install/upgrade, and rollback. Verify host reboot recovery on a disposable test VM. The default CI path needs no Kubernetes tools or cluster. When the optional Kubernetes adapter is implemented or changed, a separate opt-in job builds its split images, lints/renders its chart, validates manifests, and runs installation/upgrade tests in kind; these checks are required to release that adapter, not to release a Docker-only product.
5. Check dependencies and built images against the recorded vulnerability policy; block critical/high findings unless a reviewed, owned, expiring exception applies. Preserve Vitest/Playwright reports, Storybook build output, migration results, rendered manifests, and scan evidence with the workflow run.

Pull-request jobs have read-only repository access and no deployment credentials. Pin third-party Actions to reviewed commit SHAs. Never run untrusted pull-request code in a privileged release job. Optional previews use synthetic data, separate credentials and storage, restricted network access, and automatic cleanup when the pull request closes.

## 7.4 Building and publishing Docker images

Use one multi-stage Dockerfile with a supported Node.js LTS base pinned by digest. A dependency stage installs the pinned Bun binary and runs `bun install --frozen-lockfile`; a build stage uses Bun workspace scripts to compile the required packages and applications. Verify the dependency layout and any native modules against the final Node.js runtime. Final targets copy only their runtime files and production dependencies; one-off migration/publication modes invoke packaged Node.js commands and do not need a runtime package install:

| Target | Image contents and process |
| --- | --- |
| `app` (default) | Next.js standalone server, static/public assets, compiled worker, production dependencies, reviewed migrations and publication tooling; `serve` starts both application processes, while `migrate`, `bootstrap`, and `authz-publish` run one-off commands without starting web/worker |
| `web` (optional Kubernetes profile) | Same compiled web output and dependencies; Node serves on `0.0.0.0:3000` |
| `worker` (optional Kubernetes profile) | Same compiled worker and dependencies; Node runs the durable job/outbox consumer |
| `migrate` (optional Kubernetes profile) | Migration/bootstrap/publication tools and SQL history; runs a selected one-off command and exits |

Configure Next.js `output: 'standalone'` and a monorepo tracing root. Copy static/public assets explicitly and verify the emitted server entry path in the image test. [Next.js standalone output](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)

All targets run as non-root UID/GID `10001` and forward termination signals to Node. The combined target is the Dockerfile's final/default target. Exclude `.git`, local dependencies, `.env*`, credentials, and test output from the build context. Application/provider/database credentials are supplied at runtime. Private package credentials, if needed, use BuildKit secret mounts. Cache dependencies/build output without exporting credentials.

Keep environment-specific browser configuration in an allowlisted runtime configuration endpoint: `NEXT_PUBLIC_*` values are frozen during compilation and therefore must not contain staging-specific settings in an image promoted to production. T3 Env validates separate server/client schemas and each process's required runtime configuration before it starts work; the build validates only its declared build inputs and never needs production credentials. Replicas use the same build output; test Server Actions, deployment-version skew, and old-client asset handling during rollouts. Any build-generated Server Action key stays in the private server artifact and must never appear in public assets or logs. [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)

Proposed manual equivalent of the default release build, from the repository root after authenticating to the registry. Set `IMAGE_PREFIX` to the product's registry path, such as `ghcr.io/your-org/common-sass`:

```sh
set -eu
: "${IMAGE_PREFIX:?Set the product registry/image prefix}"
RELEASE_SHA="$(git rev-parse HEAD)"
mkdir -p artifacts
docker buildx build \
  --file infra/docker/Dockerfile \
  --target app \
  --platform linux/amd64 \
  --tag "${IMAGE_PREFIX}-app:${RELEASE_SHA}" \
  --label "org.opencontainers.image.revision=${RELEASE_SHA}" \
  --sbom=true --provenance=mode=max \
  --metadata-file artifacts/app.json \
  --push .
```

Use the host's selected architecture; add `linux/arm64` only with corresponding runtime tests. A local build can use `docker build --file infra/docker/Dockerfile --target app --tag common-sass:local .` without a registry. For Kubernetes, repeat the release build for the `web`, `worker`, and `migrate` targets, using a matching image suffix and metadata filename for each. CI uses Docker's setup-buildx, login, metadata, and build-push Actions, with GHCR write permission confined to the publish job. Pull requests build without publishing. [Docker GitHub Actions](https://docs.docker.com/build/ci/github-actions/)

After publication, pull and test/scan the exact output digests. Record the profile, required image digest(s), source SHA, runtime configuration schema, migration range, authorization model checksum, and evidence in `release.json`. Docker deploys the `app` digest; Kubernetes additionally records its split digests and chart checksum/version and generates `release-values.yaml`. Both use immutable image references (`repository@sha256:…`); production never deploys `latest`. Attach SBOM and provenance attestations, sign the release images with the trusted CI identity, and verify that identity and source before deployment. Keep failed candidates ineligible for promotion and retain previous successful images/configuration and optional charts for rollback. [Docker build attestations](https://docs.docker.com/build/metadata/attestations/)

## 7.5 Single-container Docker deployment (default)

The `app` entrypoint defaults to `serve`, starts web and worker as separate supervised child processes, sends both logs to stdout/stderr, and exits nonzero after stopping the sibling if either child unexpectedly exits. Use Docker's `--init` for child reaping. On SIGTERM, stop new requests/job claims, drain bounded work, close database pools, and exit within the configured grace period. Keep runtime web and worker DB credentials distinct even though the container is their shared failure/security boundary. [Docker multi-process containers](https://docs.docker.com/engine/containers/multi-service_container/)

Prepare a Docker Engine host with registry access, outbound access to the external services, a TLS reverse proxy forwarding to localhost port 3000, and a root-owned configuration directory. Store runtime, migration, and bootstrap/publication environment files separately with mode `0600`; generate them from the selected secret store or provision them on the host. The persistent application container receives only runtime credentials. Configure CPU/memory limits and log rotation; do not mount the Docker socket into the application.

### Fresh-install initialization

The deployment workflow explicitly selects `install` or `upgrade`; a missing readiness record is never an automatic reason to initialize. `install` requires an operator-authorized new environment identity, an empty application database apart from reviewed migrations, and an independently recorded installation intent. Under the environment release lock, run migrations, then the one-off `bootstrap` command. It initializes a closed recovery gate/epoch in the independent control plane, creates or verifies the environment's FGA store, invokes the same model-publication implementation as `authz-publish`, and records the pinned store/model and schema/configuration identity. It verifies any explicitly authorized seed organizations through the projection protocol before releasing initial readiness. Normal web/worker processes are not needed to complete this command.

Bootstrap is resumable for the same installation identity and release: reuse verified store/model records, reject mismatches, and keep traffic gated on failure. A completed bootstrap may return its verified receipt on retry, but cannot reset readiness or overwrite state. Tenant data outside that installation's declared seeds, a different prior installation, missing historical control-plane evidence, or a restore marker rejects fresh initialization and requires the upgrade or [recovery procedure](04-billing-usage-operations.md#recovery-readiness-protocol). An upgrade cannot reset the epoch to make an unhealthy environment appear fresh. Phase 1 proves installation/readiness bookkeeping against synthetic infrastructure; Phase 2 adds real model publication and authorization fixtures before any identity/tenant acceptance can pass.

The following initial-install excerpt runs on that host inside the deployment workflow's release lock, after verifying the signed release and preparing the authorized installation identity. `APP_IMAGE` is the full `app` image reference with its digest from `release.json`; paths refer to host files prepared by infrastructure setup. The image entrypoint defaults to `serve` when no command is supplied. The cache path is part of the proposed image packaging contract.

```sh
set -eu
: "${APP_IMAGE:?Set the verified application image reference with digest}"
docker pull "$APP_IMAGE"

# One-off migration uses the same image, then exits; it is not a persistent service.
docker run --rm --init --read-only \
  --cap-drop ALL --security-opt no-new-privileges=true \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --env-file /etc/common-sass/migrate.env \
  "$APP_IMAGE" migrate

# Initialize recovery state and publish the first authorization model before serving.
docker run --rm --init --read-only \
  --cap-drop ALL --security-opt no-new-privileges=true \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --env-file /etc/common-sass/bootstrap.env \
  "$APP_IMAGE" bootstrap

docker run --detach --name common-sass \
  --init --restart unless-stopped --stop-timeout 60 \
  --read-only --cap-drop ALL --security-opt no-new-privileges=true \
  --cpus 2 --memory 1g \
  --tmpfs /tmp:rw,nosuid,nodev,size=64m,mode=1777 \
  --tmpfs /app/apps/web/.next/cache:rw,nosuid,nodev,size=128m,uid=10001,gid=10001,mode=0700 \
  --env-file /etc/common-sass/runtime.env \
  --publish 127.0.0.1:3000:3000 \
  --log-driver local \
  --log-opt max-size=10m --log-opt max-file=3 \
  "$APP_IMAGE"
```

The Dockerfile includes a bounded `HEALTHCHECK` using the packaged Node health script: web readiness, recent worker heartbeat, schema/configuration validity, and the recovery gate must pass. Deployment polls for healthy status and then runs functional smoke tests; a returned container ID alone is not success. Dependency outages fail readiness and stop protected effects without causing restart storms. The entrypoint must exit on a child-process failure; Docker's restart policy reacts to container exits, while an `unhealthy` state alone does not trigger a restart. Verify restart after a host reboot and alert on unhealthy or repeatedly restarting containers. [Docker restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/), [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/)

For upgrades, the deployment script pulls/verifies the candidate, acquires the release lock, and runs compatible one-off migrations/publication before replacement. It then puts the proxy in maintenance mode, drains/stops the existing container, retains its digest/configuration for rollback, and starts one replacement under the same name/port. Run readiness and synthetic smoke checks before reopening traffic. A failed replacement is removed and the prior verified image/configuration is recreated only when schema/model compatibility permits. One running application container means a brief deployment interruption and a single host failure domain; measure the availability target with this limitation. No zero-downtime or automatic host failover guarantee is implied.

The `authz-publish` one-off mode uses the same digest with separate publication credentials for later authorization model changes. All one-off modes must work without launching the normal web/worker processes. Database backups and uploaded files live outside the application container; recreating it must preserve data. Transitioning to Kubernetes drains the combined container before activating the split deployments and uses the same application contracts and external data services; that transition has its own deployment validation.

## 7.6 Kubernetes runtime (optional)

This profile adds the split images, Helm chart, cluster provisioning/runbook, and adapter-specific CI checks. It can be omitted entirely from a Docker-only product. It changes process placement and scaling, not business or security behavior.

The Helm chart creates separate web and worker Deployments, a ClusterIP Service for web, TLS ingress through a supported controller, ConfigMaps, secret references, ServiceAccounts/RBAC, NetworkPolicies, resource requests/limits, and disruption budgets. Production starts with at least two web replicas spread across nodes; scale workers independently within database pool and queue-concurrency budgets. Add autoscaling after measuring CPU/queue lag and confirming connection limits.

OpenFGA runs as a private service using a pinned upstream image and its own database; provision and upgrade it separately with its datastore migrations and compatibility checks. PostgreSQL and object storage use managed production services. No application database or upload depends on a pod's local filesystem. Confirm DNS/TLS, CNI NetworkPolicy support, metrics, secret delivery, image-pull access, and encrypted backups during cluster bootstrap.

Mount secrets from the selected external secret manager with separate web, worker, and migration identities; do not commit secret values to Helm files or pass them through logged command-line flags. Application pods have no Kubernetes API privileges by default. Require non-root execution, no privilege escalation, dropped capabilities, a read-only root filesystem, and bounded writable volumes for `/tmp` and required Next.js caches. Tenant responses remain uncached as defined in the architecture plan.

Expose startup, readiness, and liveness probes. Liveness checks process health without restarting every pod during a database outage. Web readiness includes configuration/schema compatibility and deployment recovery readiness. Worker readiness is diagnostic: the consumer itself must stop claiming work when the recovery gate is closed. On termination, web drains requests and workers stop claiming jobs, finish or release leases within a bounded grace period, and tolerate retries without duplicate semantic effects.

Use rolling updates with `maxUnavailable: 0` and `maxSurge: 1` for web, sufficient surge capacity, and a progress deadline. Keep old/new code compatible with the expanded database schema and queued payloads. A stalled Kubernetes Deployment reports failure; the delivery workflow must decide and execute rollback. [Kubernetes Deployments](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)

## 7.7 Continuous delivery and promotion

Each successful default-branch release automatically deploys to staging using the selected profile. Production promotion selects that existing release through a protected GitHub environment with designated reviewers. Recheck that its staging evidence applies to the same profile, digests/configuration, optional chart, and current production schema/model. Do not rebuild images during promotion or silently switch profiles.

For Docker, the protected deployment job invokes the host's deployment script through authenticated SSH with pinned host identity or an ephemeral trusted runner on the private network. Host bootstrap supplies the authorized deployment identity; Docker daemon access is privileged and must be isolated from untrusted PR jobs. Where the provider supports it, use GitHub OIDC to obtain short-lived cloud/session credentials. For Kubernetes, obtain namespace-scoped cluster access instead. Bootstrap records the login commands, target verification, and trust policy for the chosen profile. [GitHub OIDC deployment configuration](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-cloud-providers)

The reusable workflow and `scripts/deploy.sh` implement this order:

1. Acquire an environment-wide release lock across migrations and rollout; do not cancel an in-progress deployment for a newer commit. Verify the profile and target host or cluster/namespace, signed release identity, configuration, required secrets, and supported schema/model range. An `upgrade` requires current recovery readiness; an explicit `install` instead verifies the new-environment prerequisites in [§7.5](#fresh-install-initialization) and keeps traffic closed until bootstrap passes. Reject stale promotions that would move the environment backwards without an explicit rollback.
2. Validate the runtime configuration and host prerequisites for Docker, or render/validate the immutable chart and perform a server-side dry run for Kubernetes. Retain redacted evidence. Infrastructure setup prepares host access/secrets or namespaces/RBAC/secrets beforehand; application deployment cannot silently provision new infrastructure or select a different environment.
3. Run a one-off container with the `app` digest in `migrate` mode for Docker, or a separate Job with the `migrate` digest for Kubernetes. Use separate DDL credentials, a database advisory lock, and bounded execution/retry limits. Run the packaged equivalent of `bun run db:migrate` and wait for success before replacing the application. Never run migrations automatically on normal container/pod startup. A failed or ambiguous migration stops deployment and requires reconciliation before retry.
4. For `install`, run `bootstrap` from the same verified release (`app` command for Docker, `migrate` image Job for Kubernetes) with separate initialization credentials; require its recorded readiness evidence. For `upgrade`, run a separate one-off publication command/Job if the authorization model changes, using the `bun run authz:publish` contract. Verify model/generation readiness through the selected projection protocol. Changes incompatible with the existing application require a documented maintenance/drain sequence before publication; publication or container/Helm success cannot bypass the recovery gate.
5. For Docker, replace the combined container using §7.5 and wait for combined health. For Kubernetes only, upgrade the web/worker chart with verified digests using the commands below. `CHART_PACKAGE` is the verified archive recorded in that profile's release; the script supplies reviewed environment files and explicit context. The Docker branch never invokes these commands.

```sh
helm upgrade --install common-sass "$CHART_PACKAGE" \
  --kube-context "$KUBE_CONTEXT" \
  --namespace "$DEPLOY_NAMESPACE" \
  --values "infra/environments/${DEPLOY_ENV}.yaml" \
  --values release-values.yaml \
  --wait --timeout 10m
kubectl --context "$KUBE_CONTEXT" --namespace "$DEPLOY_NAMESPACE" \
  rollout status deployment/common-sass-web --timeout=5m
kubectl --context "$KUBE_CONTEXT" --namespace "$DEPLOY_NAMESPACE" \
  rollout status deployment/common-sass-worker --timeout=5m
```

The chart fixes these Deployment names for the `common-sass` release and validates complete repository/digest values. Pin and test the Helm version and flags in Phase 0. [Helm upgrade reference](https://helm.sh/docs/helm/helm_upgrade/)

6. Exercise HTTPS, sign-in, two-tenant allow/deny behavior, Project CRUD once available, authorization readiness, and a worker job using dedicated synthetic accounts. For Docker, allow the synthetic probes through the maintenance gate and reopen public traffic after they pass. Monitor errors, latency, restarts, queue lag, and projection health for an initial ten-minute observation window. Record rollout, smoke-test, and health evidence; mark success and release the lock only after the checks pass. Enable module-specific checks as their phases ship.

## 7.8 Migration failure, rollback, and acceptance

Use expand/backfill/contract migrations: deploy additive changes first, run resumable backfills separately, and remove old columns/contracts only in a later release after the rollback window closes. Test the previous application version against the expanded schema and the current queue format. OpenFGA model activation has its own compatibility/reconciliation procedure.

If rollout or smoke tests fail, stop further promotion, collect container logs/health or pod/Job events, and alert the release owner. `scripts/rollback.sh` recreates the previous Docker container from its verified digest/configuration, or restores the previous chart and split digests for Kubernetes, only after confirming schema, queue, and authorization compatibility. Re-run rollout and smoke checks. Otherwise keep affected traffic/workers gated and perform a reviewed forward fix. Container/Helm rollback does not undo SQL migrations, external effects, or graph activation. Database restoration follows [operations §4.8](04-billing-usage-operations.md#48-export-deletion-and-recovery-lifecycle), including journal replay and a fresh recovery epoch.

Required evidence by milestone:

- **Phase 1 / Foundation infrastructure:** a clean clone builds the combined image and deploys one persistent application container with direct Docker and external test services, without Kubernetes tools/credentials. Web and worker operate together; child-process failure, graceful stop, host reboot, additive upgrade and compatible rollback pass. Failed migration, readiness, or image pull blocks success. Smoke tests cover runtime behavior available in that phase.
- **Phases 2–4 / Foundation release:** Phase 2 proves `R-DEPLOY` fresh authorization bootstrap, interrupted retry, mismatch rejection, and refusal to initialize restored data; ownership transfer/recovery use real publication. Phases 3–4 run the actual Project and agent-authored feature suites against deployed images, including two-tenant denial and worker processing; staging and production promotion inputs retain identical digests.
- **Phase 6 / Commercial release:** protected production promotion, secret rotation, infrastructure ownership, and the independent recovery drill covering backups, account and organization deletion, ownership continuity, analytics cleanup, and authorization pass before customer data is accepted.
- **Phase 8 / Enterprise release:** load/drain/rollback exercises, measured RPO/RTO, previous-release upgrade rehearsal, retained provenance, and incident/runbook ownership pass on the selected reference deployment. Kubernetes is not required.
- **Optional Kubernetes extension:** before offering this profile, its split images, fresh namespace install, migration/model Jobs, readiness, rolling upgrade, compatible rollback, and deployed feature suites pass on a reference cluster. These gates apply only to products enabling the extension.
