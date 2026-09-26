# ADR-0004: Docker image build boundary

Date: 2026-09-26. Status: image packaging contract selected; implementation and image verification belong to Phase 1.

The template builds one portable `app` image containing the Next.js web server, Node.js worker and one-off migration/bootstrap/authorization commands. External services are supplied through runtime configuration. The build requires no cloud account, registry, application credentials or operator assignment.

Use Bun and the committed lockfile for dependencies and Node.js for application execution. The measured local baseline is Node 24.19.0 and Bun 1.4.2. Docker Engine 29.7.2 was measured locally; buildx 0.37.1 and BuildKit 0.33.0 are recorded build-tool candidates, not executed image-build evidence. Test base image and tool pins when implementing the Dockerfile.

The [image build plan](../07-ci-and-docker-image.md) defines contents, entrypoint behavior, configuration and acceptance. The [tool reference snapshot](tool-releases.json) retains build/test references; metadata alone does not prove compatibility.

Phase 0 settles this packaging boundary. Phase 1 must demonstrate the built image against disposable services. Infrastructure selection, operational ownership and recovery-time commitments are outside the template scope.
