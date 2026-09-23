# Changelog

## 0.2.0 — 2026-09-23

- Added an optional public demo with transient inference, locked management actions, and validation of public-only stored data.
- Added configurable subpath hosting for frontend assets, API requests, and API documentation.
- Added a restricted deployment profile, Nginx configuration, and an offline synthetic report preparation script.
- Preserved the full local platform workflow when public demo mode is disabled.

## 0.1.0 — 2026-09-23

First public release of the manufacturing ticket serving and evaluation workbench.

- Chinese React dashboard with model registry, ticket playground, evaluations, datasets and request logs.
- Local Ollama and OpenAI-compatible structured-output adapters; explicit rule-based demo and fault injection.
- 160 synthetic labeled tickets, with scenario-separated development and test splits.
- Persistent bounded evaluation jobs, cancellation, restart recovery, configuration snapshots and dataset hashes.
- Exact field scoring, category accuracy, four-class macro-F1, confusion matrices, latency and throughput.
- Markdown, JSON and CSV reports; import/export of labeled JSON datasets.
- Request tracing, API-process CPU/RSS sampling, Prometheus metrics and optional bearer authentication.
- Provider host allowlisting, upstream secret references, bounded request/response bodies and sanitized errors.
- Docker deployment, locked dependencies, GitHub Actions, API documentation and a reproducible smoke script.
- Real-model integration evidence with Qwen2.5 0.5B through two protocols; see docs/VALIDATION.md for limits.

This release is a single-process, trusted-workspace application. Demo results are not LLM benchmarks.
