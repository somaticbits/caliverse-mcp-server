# Caliverse MCP

Personal-use, stdio-based MCP server for creating and managing Caliverse custom workouts through Caliverse's web API.

This project is intentionally small: it uses the official MCP SDK, Zod, TypeScript, and Node 22 built-ins. It does not use a third-party HTTP client, form serializer, test framework, credential manager, or runtime transpiler.

## Capabilities

- Search Caliverse's exercise library and inspect individual exercises.
- List, read, create, update, clone, and delete custom workouts.
- List workout categories, groups, favorites, featured/generated workouts, workout goals, and workout plans; create custom workout plans.
- Read per-exercise progress signals (personal bests, last performed), account training days and workout-generation settings, day/calendar schedules, Smart Coach profile/today/history, active plan, and exercise progression trees.
- Log a completed workout (auto-mapping library exercise IDs to the workout's internal slots) and delete a logged session.
- Require `confirm: true` for every account mutation.

The read/write endpoints for custom workouts and metadata were derived from Caliverse's public web dashboard behavior. The progress, coaching, schedule, and workout-logging endpoints were derived from observing the official iOS app's own network traffic to the same authenticated API (see `docs/ios-api-map.md`). All of this is unofficial, intended only for the authenticated account owner, and may need updates if Caliverse changes its API. Workout-log weight is recorded in kilograms only, and the completion-logging shape was verified from a single observed request that logged an entire workout at once; partial logs are unverified.

## Requirements

- Node.js 22 or newer
- pnpm 10.7.0, activated through Corepack
- A Caliverse account with workout-creation access

This repository includes `.nvmrc`; run `nvm use` before installing when using nvm.

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

Alternatively, set `CALIVERSE_REFRESH_TOKEN` in the MCP client's environment instead of creating the local credential file. Prefer the local credential file: it is permission-checked at mode `0600`, whereas the environment variable bypasses that check. Never commit an `.env` file or this token.

### Google account login

If your Caliverse account uses Google sign-in, run:

```sh
pnpm login:google
```

This opens a one-time loopback-only `localhost` page styled with a self-hosted, inline-free stylesheet. Click its **Sign in with Google** button to open Firebase's Google sign-in popup. The local page uses Firebase 9.22.2 scripts with pinned SHA-384 Subresource Integrity hashes, has a restrictive CSP (`style-src 'self'`, no inline scripts or styles, no remote fonts or images), accepts a single random-nonce-bound response, validates the resulting refresh token with Firebase, and stores only the rotated refresh token. It times out after five minutes.

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
2. Call `caliverse_list_exercises` (with `query` when possible) to get real exercise IDs. Collection tools return `nextOffset`; pass it as `offset` until it is `null`.
3. Call `caliverse_create_workout` with valid exercise IDs and `confirm: true`.
4. Read the created workout back with `detail: "structure"` before making a replacement update.

For workouts planned to run in the Caliverse app, put concise execution cues in each superset title:
the app displays titles but stores `workout_exercise.description` without displaying it. Preserve
existing descriptions when updating or cloning a workout, but do not use them for new visible notes.

To preview a planned workout in the chat, call `caliverse_show_workout_images` with its workout ID.
It returns compact image blocks alongside each exercise's sets, reps, and rest. For a designed
Claude artifact, call `caliverse_get_workout_card_data`: its default `thumbnailMode: "url"` is
lean, while `thumbnailMode: "dataUri"` embeds only `thumbnail_url` for artifact sandboxes that
block remote images. `card_image_url` remains remote, so use the embedded thumbnail for that mode.

`caliverse_update_workout` replaces the complete workout definition. Always read a workout first and preserve every field you intend to keep. `caliverse_delete_workout` is irreversible. Read tools default to compact summaries; use `detail: "full"` for the unmodified API object, or `fields` to select explicit top-level fields.

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

- Firebase ID tokens remain in memory and refresh automatically. When Firebase rotates a file-backed refresh token, the replacement is atomically persisted with owner-only permissions. The persisted refresh token can be invalidated by changing your Caliverse password or revoking access.
- All production endpoints are fixed HTTPS URLs in source. The server never accepts an arbitrary URL from an MCP tool input.
- API error responses are capped at 1,000 characters. MCP tool responses default to 65,536 UTF-8 bytes (configurable with `CALIVERSE_MAX_RESULT_BYTES`), and credentials are never included in errors or logs.
- Request timeouts are 15 seconds for Firebase, 20 seconds for standard Caliverse calls, and 45 seconds for the large plan catalog.
- A 401 causes exactly one refresh-and-retry; loops are impossible.
- Mutating MCP tools require a literal `confirm: true`; this prevents accidental agent writes from incomplete calls.
- `pnpm-lock.yaml` integrity hashes and `pnpm install --frozen-lockfile --ignore-scripts` provide repeatable installs without lifecycle-script execution.

No local project can eliminate all supply-chain or upstream API risk. Keep Node and pnpm patched, inspect lockfile changes, run `pnpm audit --prod` before intentional dependency upgrades, and do not run this server with credentials belonging to anyone else.
