# Security and data handling

The complete ModelOps Lab workspace is intended for a local workstation or a trusted evaluation environment. It is not a hardened, multi-tenant production service. Version 0.2 adds a separate, restricted public demo profile.

## Reporting a vulnerability

If this repository has GitHub private vulnerability reporting enabled, use **Security → Report a vulnerability**. If it is unavailable, open an issue requesting a private reporting channel without publishing exploit details, credentials, private tickets, or customer data. No dedicated security response SLA is provided.

Include the affected version, minimal reproduction, impact, and suggested mitigation when available. Only the current release line is actively maintained.

## Access and credentials

- Set `MODEL_OPS_API_KEY` to require a Bearer token for data APIs and `/metrics`. It is a single shared access key, not per-user authentication or role-based authorization.
- `/api/health`, static frontend assets, and API schema/documentation remain publicly readable. They do not return stored ticket records.
- The UI keeps the platform access key in session storage for the browser tab. Protect the workstation and use HTTPS when operating across a network.
- Provider credentials are read from server environment variables. The model registry stores only the variable name in `api_key_env`, not the credential value.
- Do not put keys in service URLs, prompts, dataset files, screenshots, or Git history.

## Upstream network access

Remote providers are restricted by the administrator-managed `MODEL_OPS_ALLOWED_HOSTS` list. The default permits only local development hosts. The adapters reject credentials in URLs, do not follow redirects, and ignore proxy environment variables.

This allowlist is a configuration guard, not complete SSRF protection or a network sandbox. Administrators must trust permitted hostnames and their DNS configuration. Use network egress controls in shared deployments; do not expose registry mutations to untrusted users. A configured remote model receives the submitted ticket text.

## Stored data

In the complete workspace, the SQLite database stores model configurations, datasets and expected answers, experiment snapshots, request text, parsed output, timing, and errors. Application diagnostic logs omit request bodies and secrets. Raw provider response text is not additionally persisted.

**There is no automatic redaction, encryption at rest, retention expiry, or record deletion interface.** Protect the runtime directory or Docker volume, restrict backups, and define a retention policy before importing private records. A stopped local demo can be reset by removing its runtime database/volume, which also removes all imported data and experiment history. Back up/export first if records must be kept.

The repository's bundled data is entirely synthetic. Do not contribute internal customer data, production credentials, personal information, or proprietary documents. Use authorized and appropriately anonymized samples for private evaluation.

## Public demo profile

`MODEL_OPS_PUBLIC_DEMO=true` rejects configuration changes, imports, and experiment mutations even when a platform key is supplied. Interactive inference is restricted to the built-in deterministic demo models; submitted text and output are returned to the visitor without database persistence. Diagnostic request IDs, status, latency, aggregate counters, and normal proxy access logs remain available.

Use a dedicated database. Startup rejects non-bundled model/data configuration, free-text request history, and unapproved evaluation records. Offline-prepared reports must contain bundled synthetic samples and verified demo outputs. The supplied Linux public Compose profile uses a separate data volume, no published host ports, read-only filesystem, resource limits, and an isolated network without outbound access. Host Nginx reaches the container by its internal bridge address and adds rate and connection limits. See [public deployment](docs/PUBLIC_DEMO.md).

## Operational limits

Use one backend process and one worker. In-process concurrency limits are not distributed rate limiting. SQLite storage and background task recovery do not provide high availability. Restarted evaluations are marked interrupted rather than automatically replayed.

The extraction prompt treats ticket text as data, but prompt instructions cannot guarantee resistance to every model-specific prompt injection. Validate outputs and independently review consequential results. This application does not operate machinery and is not designed to make automated safety or maintenance decisions.

Before any shared deployment, provide transport encryption, appropriate access controls, trusted upstreams, backup handling, and resource limits suitable for the environment.
