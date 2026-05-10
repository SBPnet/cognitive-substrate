# Security Policy

Security reports should include affected components, reproduction steps, impact, and suggested mitigations when available.

Until a dedicated disclosure address is configured, security issues should be reported privately to the project maintainers through the repository owner.

Do not disclose vulnerabilities publicly until maintainers have had time to assess and remediate the issue.

## Supported Versions

No public stable release is supported yet. Security fixes are handled on the default development branch until the first tagged local runtime release exists.

## Disclosure Handling

Maintainers should acknowledge private reports within 7 calendar days, triage severity, and coordinate a fix before public disclosure when practical. Reports that affect event payloads, memory storage, policy state, telemetry exports, or deployment secrets should be treated as security-sensitive by default.

## Security-Sensitive Areas

- Kafka event payloads and replay topics
- OpenSearch memory indices and embeddings
- ClickHouse telemetry exports
- PostgreSQL policy and coordination state
- Object-storage payload archives
- API authentication, authorization, and streaming routes
- Deployment templates, environment files, and secrets handling
