# Roadmap

## Adding a feature

1. Probe the authenticated API shape without retaining account data. Record verified endpoints and
   response details in `docs/ios-api-map.md`.
2. Add the client request in `src/client.ts`. Keep authentication and request limits inside the
   client; do not call Caliverse directly from a tool.
3. Add input validation and payload mapping in `src/types.ts` when needed.
4. Add a projection in `src/projection.ts` when the raw response is too large or contains details
   a caller does not need.
5. Register the MCP tool in `src/tools.ts`. Read tools use `readAnnotations`; all mutations require
   an explicit `confirm: true` input.
6. Add offline tests using injected `fetchImpl`. Do not make ordinary tests depend on a live account.
7. Update the API map, README, and `.env.example`, then run `pnpm typecheck` and `pnpm test`.

Tool results normally use `textResult()` so response-size limits apply. Do not add an MCP
`outputSchema`: this SDK version requires duplicate `structuredContent` when one is set. Add no
runtime dependency unless Node's built-ins cannot safely do the job.

## Delivered

- [x] Exercise thumbnails in conversation: `caliverse_show_workout_images` fetches compact image
  blocks alongside sets, reps, and rest.
- [x] Interactive workout cards: `caliverse_show_workout_cards` renders an MCP App inside Claude
  Desktop with remote Caliverse thumbnails, a responsive card grid/table, and host-opened videos.
- [x] Stable workout-card ordering: slots are ordered by their superset then their position within
  that superset, rather than the ambiguous exercise order alone.
- [x] Local MCP App preview harness: `pnpm preview:cards` renders a fixture in a fake host for
  light/dark and responsive visual QA without Caliverse access.

## Next

- [ ] Consider inline exercise video after confirming the video host and iframe/video CSP behavior.
- [ ] Verify and repair equipment filtering. The `/exercises` list observed in August 2026 did not
  include `required_equipments`, although nested workout exercises did.
- [ ] Capture a completion-log request for a per-superset-numbered workout. The write path currently
  forwards raw exercise `order_in_workout`, while captures show continuous positions and response
  shapes use both numbering schemes.
- [ ] Resolve whether top-level `workout_exercises` or nested `supersets[].workout_exercises` is the
  authoritative warmup/cooldown list. Observed responses contain different counts.
- [ ] Expose Smart Coach chat and generation-task polling after recording stable async semantics.
- [ ] Investigate useful MCP resources and prompts for active-plan and daily-schedule workflows.
- [ ] Consider a disk-backed TTL cache for the 1.2 MB `/exercises` response.

## Deferred

- Exercise image uploads: no supported Caliverse upload endpoint has been observed.
- Pound-based workout logging: captures only establish `added_weight_unit: 1` for kilograms.
