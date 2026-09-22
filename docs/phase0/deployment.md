# ADR-0004: Docker reference host, release identity and infrastructure ownership

Date: 2026-09-22. Status: concrete reference design selected; no external infrastructure has been created, paid commitment made, or owner assignment confirmed. The measured local service versions may differ from upstream deployment candidates below; preserve that distinction in evidence.

## Host and service selection

Default profile is `docker`: one persistent application container supervises Node web and worker children. Choose an AWS EC2 Linux x86-64 host in `eu-central-1` with Ubuntu 24.04 LTS, a minimum initial 2 vCPU/4 GiB allocation, encrypted host volume, and Caddy 2.11.4 terminating TLS. GHCR is the immutable OCI registry. Use distinct AWS accounts/hosts for staging and production; staging uses synthetic data. No host size is a demonstrated capacity or availability claim.

Use external PostgreSQL 18.6 (reference production provider: Amazon RDS, subject to the engine/region availability check at provisioning), a separately provisioned private OpenFGA service with its own PostgreSQL database, and private S3 storage. An unavailable exact RDS engine patch blocks that provider's provisioning until the current supported patch is tested; it does not justify relabeling the local PostgreSQL result. OpenFGA is outside the application image and has separate migration credentials/upgrade ownership. Recovery resources/credentials remain outside application accounts under [ADR-0003](recovery.md).

The selected application image remains portable to another prepared Docker host. AWS-specific identity and object/recovery adapters are explicit deployment defaults, not implicit prerequisites for local Foundation use. Kubernetes is out of the reference decision: no Helm/kubectl version or cluster access is required for this profile. Offering that optional profile requires its own version matrix and acceptance evidence.

## Tool versions and source verification

| Tool | Reference pin | Evidence/status |
| --- | --- | --- |
| Node | 24.19.0 | Local measured baseline; latest LTS 24.21.0 is a required preproduction patch review/test |
| Bun | 1.4.2 | Exact workspace install/script entry point |
| Docker Engine/CLI | 29.7.2 measured locally; 29.8.1 deployment candidate | Do not infer remote host compatibility from local Docker Desktop; test the selected Linux host before acceptance |
| Docker buildx | 0.37.1 | Upstream release verified; candidate for Phase 1 build/push/provenance checks |
| BuildKit | 0.33.0 | Upstream release verified; pin builder image digest at provisioning/release |
| OpenFGA | 1.21.0 | Upstream release verified; use prototype's actual pulled image digest for evidence |
| PostgreSQL | 18.6 | Supported upstream major/patch; provider offering and exact image digest separately verified |
| Caddy | 2.11.4 | Upstream release verified; host package/binary checksum retained in provisioning receipt |
| Cosign | 3.1.3 | Upstream release verified; sign/verify trusted CI identity and exact digest |
| AWS CLI | 2.36.50 | Official v2 changelog checked; pin distribution/checksum for deployment job |
| Ubuntu / runner | 24.04 LTS / GitHub `ubuntu-24.04` | OS series selected; provisioning records immutable AMI ID and CI records actual runner image/version |

[Upstream release references and action commits](tool-releases.json) were fetched from repository release/tag APIs on 2026-09-22. Annotated release tag object hashes in that file are **not** action commit pins; all action entries below resolve to commits. The file is discovery evidence, not evidence those tools executed. AWS CLI reference: [official v2 changelog](https://github.com/aws/aws-cli/blob/v2/CHANGELOG.rst).

| Action | Release label | Immutable `uses` reference |
| --- | --- | --- |
| Checkout | v7.0.1 | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` |
| Node setup | v7.0.0 | `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020` |
| Bun setup | v2.2.0 | `oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6` |
| Evidence upload | v7.0.1 | `actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| Buildx setup | v4.4.1 | `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| Registry login | v4.6.0 | `docker/login-action@dbcb813823bdd20940b903addbd779551569679f` |
| Image build/push | v7.4.0 | `docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
| AWS OIDC credentials | v6.3.0 | `aws-actions/configure-aws-credentials@e1253824e5c10ff9df46874f81ed3ec929e19cfd` |

Action updates are reviewed with upstream source/permissions and runner requirements; no floating `@main`/major tag. Release images include an SBOM and provenance and are deployed by digest. Build tools run without production credentials. A release manifest records source SHA, platform, all image digests, Node/Bun/tool versions, configuration schema, compatible migration/model range and evidence.

## Identity and runner/network contract

Use GitHub-hosted isolated runners for PR/merge checks and image publication. PR jobs have read-only repository access, no environment secrets, no cloud identity, and no Docker-host reachability. Publishing uses scoped `GITHUB_TOKEN` package-write permission only in the protected default-branch release job. Production promotion uses the protected GitHub `production` environment and the already-built release digest.

For this AWS reference adapter, choose **OIDC plus a narrowly constrained SSM Run Command document** for host invocation. This refines the plan's generic SSH/private-runner transport: the existing host-local `scripts/deploy.sh` still owns locking, verification, migration, replacement and rollback. No public inbound SSH or persistent SSH private key is required. SSM supports remote managed-node commands, but its status APIs are eventually consistent; a submitted command ID is never deployment success. Poll bounded status and require the host's signed/retained readiness and smoke-test receipt. [AWS Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html).

Trust policy requirements:

- Issuer `https://token.actions.githubusercontent.com`; exact audience `sts.amazonaws.com`; exact repository/environment subject `repo:<owner>/<repo>:environment:production` (and a separate staging role). Resolve real repository/account identifiers before provisioning; angle-bracket values are placeholders, never deployable defaults.
- Restrict the GitHub environment to the protected default branch/tag policy and designated reviewers. An environment-subject trust policy does not independently constrain the branch, so both settings are necessary. Production and staging IAM roles are separate. [GitHub AWS OIDC guidance](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-aws).
- Deployment role may invoke only a version-pinned custom SSM document on the tagged environment host and read its result. It cannot invoke arbitrary `AWS-RunShellScript`, alter the document, create IAM roles, provision hosts, change recovery gates or read application secrets. Document parameters are validated environment ID, explicit `install`/`upgrade`/compatible rollback mode, and release digest/manifest ID, never shell fragments.
- The host instance role retrieves only its environment's secret references. Root-owned `0600` files separate runtime, migration and bootstrap/publication configuration. Runtime container cannot reach instance metadata and has no Docker socket, host IAM credential or migration/bootstrap secret. Enforce this at host firewall/network boundaries as well as application code.
- Host registry pull uses a read-only GHCR machine credential from the secret store, rotated independently of CI publication. Use no personal all-repository token. Cosign verification binds the expected repository/workflow/source identity and manifest digest before executing any container.
- Provisioning identity, release identity, migration DB role, publication identity and recovery administration are distinct. Only the independently authorized install/bootstrap operation can initialize a new installation record; an upgrade cannot reset readiness.

Network matrix:

| Source → destination | Allowed path | Reason |
| --- | --- | --- |
| Internet → Caddy host | TCP 443; 80 only for redirect/ACME if selected | Public TLS app; port 3000 bound to loopback |
| PR runner → public registries/test fixtures | HTTPS / local disposable services | Build/tests; no production network |
| Protected runner → AWS STS/SSM, GHCR, signature/evidence endpoints | HTTPS 443 | Short-lived deployment identity and signed release invocation |
| Host → SSM endpoints | Outbound HTTPS 443 via VPC endpoints or controlled egress | Management channel; no public SSH listener |
| Web/worker → application PostgreSQL | Private TLS 5432, separate restricted roles | Tenant transactions and jobs |
| Web/worker → OpenFGA | Private authenticated TLS endpoint | Checks/projection with separately scoped principals |
| OpenFGA → its PostgreSQL | Private TLS 5432 | Independent graph persistence |
| Runtime → storage, enabled billing/email/analytics, recovery reader/intake API | HTTPS 443 with destination/service allowlist | Scoped provider actions and current readiness |
| Recovery admin → control plane | Separate authenticated private/admin path | Epoch allocation/revalidation; runtime cannot impersonate it |

Provisioning must demonstrate DNS/TLS, endpoint egress, time synchronization, storage/backup encryption, log collection and host reboot behavior. Restrict workload egress to metadata/private admin endpoints; reserve admin reachability for host management. Combined web/worker packaging means process separation alone is not a security boundary.

## Ownership, installation and release conditions

| Asset/operation | Accountable role | Required recorded evidence |
| --- | --- | --- |
| AWS accounts/region/budget, network, host OS patching and TLS | Platform owner — unassigned | Real account/AMI/instance IDs, architecture, approver, maintenance/on-call contact |
| GHCR repository, GitHub environments/reviewers and workflow trust | Release owner — unassigned | Real repository/package path, policy screenshots/export, IAM trust/document digest |
| Application/FGA database backups and upgrades | Database/service owner — unassigned | Connection budget, restore policy, migration credentials, service version/digest |
| Object IAM/retention/provider contract | Storage/data owner — unassigned | Bucket policies, provider contract suite and capacity/cleanup ownership |
| Independent journal/epoch and recovery review | Recovery custodian — unassigned | Separate account/key/approver records from ADR-0003 |
| Incident response, recovery promises and commercial providers | Product/operations owner — unassigned | Named on-call, retention/provider terms, revalidation response commitment |

No external deployment can be represented as owned/ready while these assignments are absent. The maintainer fills a signed environment inventory with real values before Phase 1 staging provisioning; production adds the Phase 6 recovery/customer-data gates. This does not block local synthetic validation.

`install` and `upgrade` are explicit, resumable host operations under an environment-wide lock. Install requires independently recorded authorization, an empty database except reviewed migrations, and a new installation identity. Any existing tenant data, unknown history or restore marker rejects fresh initialization. Migrate/bootstrap/publication use one-off commands from the same image without starting ordinary processes. Upgrade runs compatible additive migrations first, gates/drains traffic, replaces one container, verifies both child processes/readiness and functional probes, observes health, then reopens. Rollback reuses retained verified image/configuration only if database/model/queue compatibility permits it.

The single host/container entails a maintenance interval and host failure domain. Record this availability limit; do not describe it as zero-downtime or automatic failover. Phase 1 must test child death, bounded SIGTERM drain, unhealthy dependency without restart storms, failed migration/pull/readiness, host reboot, interrupted install and compatible rollback. Real authorization bootstrap follows in Phase 2, deployed feature suites in Phases 3–4, independent recovery in Phase 6. A candidate version table or local prototype cannot satisfy those deployment gates.
