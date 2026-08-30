# Caliverse MCP

Personal-use, stdio-based MCP server for creating and managing Caliverse custom workouts through Caliverse's web API.

This project is intentionally small: it uses the official MCP SDK, Zod, TypeScript, and Node 22 built-ins. It does not use a third-party HTTP client, form serializer, test framework, credential manager, or runtime transpiler.

## Capabilities

- Search Caliverse's exercise library and inspect individual exercises.
- List, read, create, update, clone, and delete custom workouts.
- List workout categories, groups, and workout plans.
- Require `confirm: true` for every account mutation.

The implementation was derived from Caliverse's public web dashboard behavior. It is unofficial, intended only for the authenticated account owner, and may need updates if Caliverse changes its API.

## Requirements

- Node.js 22 or newer
- pnpm 10.7.0, activated through Corepack
- A Caliverse account with workout-creation access

## Secure installation

Review `package.json` and `pnpm-lock.yaml` before installing. All direct dependency versions are exact and the lockfile is committed.

```sh
corepack enable
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm test
pnpm audit --prod
```

`.npmrc` blocks package lifecycle scripts, disables automatic peer installation, uses pnpm's isolated linker, and writes exact versions for any future dependency additions. Do not use `pnpm update` or add a dependency without reviewing the resulting lockfile and rerunning the commands above.

## Login

The server stores only a Firebase refresh token at `~/.config/caliverse-mcp/credentials.json`, with mode `0600`. It never stores your password.

In zsh, read credentials without writing them to shell history or echoing the password:

```sh
read -r 'CALIVERSE_EMAIL?Caliverse email: '
read -rs 'CALIVERSE_PASSWORD?Caliverse password: '
pnpm login
unset CALIVERSE_EMAIL CALIVERSE_PASSWORD
```

Alternatively, set `CALIVERSE_REFRESH_TOKEN` in the MCP client's environment instead of creating the local credential file. Never commit an `.env` file or this token.

### Google account login

If your Caliverse account uses Google sign-in, run:

```sh
pnpm login:google
```

This opens a one-time loopback-only `localhost` page. Click its **Sign in with Google** button to open Firebase's Google sign-in popup. The local page uses Firebase 9.22.2 scripts with pinned SHA-384 Subresource Integrity hashes, has a restrictive CSP, accepts a single random-nonce-bound response, validates the resulting refresh token with Firebase, and stores only the rotated refresh token. It times out after five minutes.

Do not paste a Google password, an ID token, or a refresh token into an MCP tool or chat. If the browser does not open, the command prints the local URL to stderr; open only that `http://localhost:<port>/` URL yourself.

## MCP client configuration

Build first, then configure any stdio-compatible client to run the compiled server. The server writes protocol messages only to stdout; diagnostic startup failures go to stderr.

```json
{
  "mcpServers": {
    "caliverse": {
      "command": "node",
      "args": ["/absolute/path/to/caliverse-mcp/dist/src/index.js"]
    }
  }
}
```

Use a normal absolute path, not `pnpm exec`, `npx`, a shell wrapper, or a remote binary runner. This guarantees the client runs the reviewed, locally compiled source.

## Tool workflow

1. Call `caliverse_list_my_workouts` to inspect accepted `level` values in your account.
2. Call `caliverse_list_exercises` (with `query` when possible) to get real exercise IDs.
3. Call `caliverse_create_workout` with valid exercise IDs and `confirm: true`.
4. Read the created workout back before making a replacement update.

`caliverse_update_workout` replaces the complete workout definition. Always read a workout first and preserve every field you intend to keep. `caliverse_delete_workout` is irreversible.

## Testing

Offline tests never contact Firebase or Caliverse. They inject `fetch` and cover nested PHP-style form serialization, Firebase auth response handling, token caching, 401 refresh/retry behavior, bounded API errors, and read-to-write workout cloning.

```sh
pnpm typecheck
pnpm test
```

The test command uses Node's built-in test runner and prints a coverage report. The serializer has 100% line/branch/function coverage; auth and client error/retry paths have dedicated tests.

### Opt-in live smoke test

Live tests are intentionally disabled by default:

```sh
CALIVERSE_LIVE_TEST=1 pnpm smoke
```

That performs authenticated read-only calls. To test a real create/read/delete cycle, first identify a level from an existing workout, then explicitly opt in:

```sh
CALIVERSE_LIVE_TEST=1 \
CALIVERSE_LIVE_MUTATION_TEST=1 \
CALIVERSE_TEST_LEVEL=beginner \
pnpm smoke
```

The mutation smoke test creates a short, timestamped workout and deletes it in `finally`. If creation succeeds but no ID is returned, cleanup is intentionally skipped rather than risking deletion of an unknown workout; remove that test workout manually in Caliverse.

## Security model

- Firebase ID tokens remain in memory and refresh automatically. The persisted refresh token is permission-restricted and can be invalidated by changing your Caliverse password or revoking access.
- All production endpoints are fixed HTTPS URLs in source. The server never accepts an arbitrary URL from an MCP tool input.
- API error responses are capped at 1,000 characters, and credentials are never included in errors or logs.
- Request timeouts are 15 seconds for Firebase and 20 seconds for Caliverse.
- A 401 causes exactly one refresh-and-retry; loops are impossible.
- Mutating MCP tools require a literal `confirm: true`; this prevents accidental agent writes from incomplete calls.
- `pnpm-lock.yaml` integrity hashes and `pnpm install --frozen-lockfile --ignore-scripts` provide repeatable installs without lifecycle-script execution.

No local project can eliminate all supply-chain or upstream API risk. Keep Node and pnpm patched, inspect lockfile changes, run `pnpm audit --prod` before intentional dependency upgrades, and do not run this server with credentials belonging to anyone else.
