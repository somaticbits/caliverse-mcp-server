# Security Policy

## Scope

This is a local, personal-use MCP server. Security-sensitive areas are credential persistence, outbound HTTP requests, dependency changes, and MCP tools that mutate a Caliverse account.

## Reporting

Do not open a public issue with credentials, tokens, or a reproducible exploit that could expose another user's Caliverse account. Contact the repository owner privately instead.

## Local security controls

- Credentials are refresh tokens only, stored in `~/.config/caliverse-mcp/credentials.json` with owner-only permissions. Firebase-rotated replacements are atomically persisted; environment-supplied tokens are never written to disk.
- The server accepts no credential through a tool call and does not log request headers or bodies.
- API hosts are compile-time constants; tool input cannot select an endpoint.
- All writes require an explicit `confirm: true` input.
- Runtime dependencies and the package manager are exact-pinned; `pnpm-lock.yaml` must be reviewed and committed with every dependency change.
- `.npmrc` enforces Node 22+, disables package lifecycle scripts, and rejects non-conforming installs. Installation should always use `pnpm install --frozen-lockfile --ignore-scripts`.
- CI typechecks, tests, and audits production dependencies on each pull request and push; Renovate proposes dependency updates for review.
- Google login uses a temporary loopback-only listener with a per-run nonce, CSP/no-cache headers, and SRI-pinned Firebase browser scripts. Its stylesheet is self-hosted (`style-src 'self'`, no inline styles, no remote fonts or images). Its returned token is validated before being persisted.

## Dependency updates

For every intentional update:

1. Review the package maintainer, release notes, and resulting `pnpm-lock.yaml` diff.
2. Install with `pnpm install --frozen-lockfile --ignore-scripts` after the lockfile is committed.
3. Run `pnpm typecheck`, `pnpm test`, and `pnpm audit --prod`.
4. Commit the source, manifest, and lockfile changes together with a focused message.

Never bypass the lockfile, enable lifecycle scripts globally, or install packages using an unreviewed `npx`/`pnpm dlx` command.
