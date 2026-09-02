import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "./client.js";
import { buildThumbnailUrl, fetchThumbnails, maxImageTotalBytes } from "./media.js";
import { omittedKeys, planSummary, projectExercise, projectPlan, projectWorkout, workoutSlots } from "./projection.js";
import { fieldsSchema, pageSchema, pagedResult, textResult } from "./response.js";
import { isoDateSchema, planInputSchema, todayDateString, workoutInputSchema, workoutLogInputSchema } from "./types.js";
import { WORKOUT_CARDS_MIME_TYPE, WORKOUT_CARDS_URI, workoutCardsHtml } from "./ui/workout-cards.js";

export const SERVER_INSTRUCTIONS = "Use caliverse_get_workout_filters for canonical workout levels. Page collection tools with nextOffset. Use caliverse_show_workout_cards to display a workout visually in Claude Desktop. Read a workout with detail structure before replacing it, preserving all fields and stored exercise descriptions. Put new visible coaching cues in superset titles. Every account mutation requires confirm: true.";
const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const destructiveAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };
const exerciseDetailSchema = z.enum(["summary", "full"]);
const workoutDetailSchema = z.enum(["summary", "structure", "full"]);
const planDetailSchema = z.enum(["summary", "full"]);
const thumbnailFormatSchema = z.enum(["webp", "jpeg"]);
const SEARCH_FIELDS = ["title", "private_title", "slug", "description", "level"] as const;
const workoutImageInputSchema = {
  workoutId: z.number().int().positive(),
  include: z.enum(["main", "all"]).default("main"),
  size: z.number().int().min(48).max(256).default(96),
  format: thumbnailFormatSchema.default("webp"),
  quality: z.number().int().min(1).max(100).default(70),
  limit: z.number().int().positive().max(24).default(12)
};
const fromToDateRangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema }).refine(
  ({ from, to }) => from <= to,
  { message: "from must be on or before to.", path: ["to"] }
);
const calendarDateRangeSchema = z.object({ dateFrom: isoDateSchema, dateTo: isoDateSchema }).refine(
  ({ dateFrom, dateTo }) => dateFrom <= dateTo,
  { message: "dateFrom must be on or before dateTo.", path: ["dateTo"] }
);

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return todayDateString(() => date);
}

function errorResult(error: unknown) {
  const message = typeof error === "string"
    ? error
    : error instanceof Error ? error.message : "Unknown Caliverse MCP error.";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function matchesQuery(value: unknown, query: string): boolean {
  const item = record(value);
  return item !== undefined && SEARCH_FIELDS.some((field) => typeof item[field] === "string" && item[field].toLowerCase().includes(query));
}

function projectedResult(raw: unknown, projected: unknown, detail: string) {
  if (raw === projected) {
    return textResult(raw);
  }
  return textResult({ detail, omitted: omittedKeys(raw, projected), value: projected });
}

function projectedPage(items: unknown[], offset: number, limit: number, detail: string, project: (item: unknown) => unknown) {
  const pageItems = items.slice(offset, offset + limit);
  const projectedItems = pageItems.map(project);
  const omitted = [...new Set(pageItems.flatMap((item, index) => omittedKeys(item, projectedItems[index])))].sort();
  const page = pagedResult(items, offset, limit, detail, omitted);
  return textResult({ ...page, items: projectedItems });
}

async function workoutListResult(
  fetchWorkouts: () => Promise<unknown>,
  query: string | undefined,
  offset: number,
  limit: number,
  detail: "summary" | "structure" | "full",
  fields: string[] | undefined
) {
  try {
    const workouts = await fetchWorkouts();
    if (!Array.isArray(workouts)) return textResult(workouts);
    const normalizedQuery = query?.toLowerCase();
    const results = normalizedQuery === undefined ? workouts : workouts.filter((workout) => matchesQuery(workout, normalizedQuery));
    return projectedPage(results, offset, limit, detail, (item) => projectWorkout(item, detail, fields));
  } catch (error) {
    return errorResult(error);
  }
}

function projectWorkoutGoal(value: unknown): unknown {
  const item = record(value);
  if (item === undefined) {
    return value;
  }
  const workoutPlan = item.workout_plan;
  return {
    ...(typeof item.id === "number" ? { id: item.id } : {}),
    ...(typeof item.title === "string" ? { title: item.title } : {}),
    ...(typeof item.goal_group === "string" ? { goal_group: item.goal_group } : {}),
    ...(workoutPlan === undefined ? {} : { workout_plan: workoutPlan === null ? null : planSummary(workoutPlan) })
  };
}

function workoutTitle(value: unknown): string {
  const title = record(value)?.title;
  return typeof title === "string" ? title : "Workout";
}

function slotCaption(slot: ReturnType<typeof workoutSlots>[number]): string {
  const work = slot.set_count === null || slot.repetition_count === null
    ? ""
    : ` - ${slot.set_count} x ${slot.repetition_count}${slot.repetition_type === "time" ? "s" : ""}`;
  const rest = slot.rest_time_before_exercise === null || slot.rest_time_before_exercise === 0 ? "" : `, rest ${slot.rest_time_before_exercise}s`;
  return `${slot.position}. ${slot.title ?? "Unnamed exercise"}${work}${rest}`;
}

const workoutSections = ["warmup", "main", "cooldown"] as const;

function limitedWorkoutSlots(workout: unknown, include: "main" | "all", limit: number) {
  const slots = workoutSlots(workout, include);
  return workoutSections.flatMap((section) => {
    if (include === "main" && section !== "main") return [];
    const sectionSlots = slots.filter((slot) => slot.section === section);
    return sectionSlots.length === 0 ? [] : [{ section, slots: sectionSlots.slice(0, limit), omitted: Math.max(0, sectionSlots.length - limit) }];
  });
}

export function registerTools(server: McpServer, api: CaliverseApi): void {
  // Do not add outputSchema here: SDK 1.30 requires structuredContent when one is set,
  // duplicating every JSON payload alongside the required text content.
  server.registerResource("caliverse_workout_cards", WORKOUT_CARDS_URI, {
    title: "Caliverse Workout Cards",
    description: "Interactive Caliverse workout exercise card view.",
    mimeType: WORKOUT_CARDS_MIME_TYPE,
    _meta: { ui: { prefersBorder: true } }
  }, async () => ({ contents: [{
    uri: WORKOUT_CARDS_URI,
    mimeType: WORKOUT_CARDS_MIME_TYPE,
    text: workoutCardsHtml(),
    _meta: { ui: { csp: { resourceDomains: ["https://assets.caliverse.app", "https://cdn.caliverse.app"] }, prefersBorder: true } }
  }] }));

  server.registerTool("caliverse_list_exercises", {
    title: "List Caliverse Exercises",
    description: "List exercises. Default detail is summary; use offset and nextOffset to page through results. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: exerciseDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    try {
      const exercises = await api.listExercises();
      if (!Array.isArray(exercises)) return textResult(exercises);
      const normalizedQuery = query?.toLowerCase();
      const results = normalizedQuery === undefined ? exercises : exercises.filter((exercise) => matchesQuery(exercise, normalizedQuery));
      return projectedPage(results, offset, limit, detail, (item) => projectExercise(item, detail, fields));
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_exercise", {
    title: "Get Caliverse Exercise",
    description: "Get one exercise by ID. detail full preserves the unmodified API object; fields selects explicit top-level fields.",
    inputSchema: { exerciseId: z.number().int().positive(), detail: exerciseDetailSchema.default("full"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ exerciseId, detail, fields }) => {
    try {
      const exercises = await api.listExercises();
      if (!Array.isArray(exercises)) return errorResult("Caliverse returned an invalid exercise list.");
      const exercise = exercises.find((item) => record(item)?.id === exerciseId);
      return exercise === undefined ? errorResult(`Exercise ${exerciseId} was not found.`) : projectedResult(exercise, projectExercise(exercise, detail, fields), detail);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_show_workout_images", {
    title: "Show Planned Workout Exercise Images",
    description: "Display exercise thumbnails for a workout directly in the conversation, with each exercise's sets, reps, and rest. Defaults to compact 96px WebP thumbnails.",
    inputSchema: workoutImageInputSchema,
    annotations: readAnnotations
  }, async ({ workoutId, include, size, format, quality, limit }) => {
    try {
      const workout = await api.getWorkout(workoutId);
      const sections = limitedWorkoutSlots(workout, include, limit);
      const slots = sections.flatMap((section) => section.slots);
      const thumbnailUrls = new Map(slots.flatMap((slot) => slot.image_url === null ? [] : [[slot, buildThumbnailUrl(slot.image_url, { size, format, quality })]]));
      const urls = [...thumbnailUrls.values()];
      const thumbnails = await fetchThumbnails(urls, api.fetchAsset.bind(api));
      const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: "image/webp" | "image/jpeg" | "image/png" | "image/gif" }> = [
        { type: "text", text: `${workoutTitle(workout)}: ${slots.length} displayed exercise${slots.length === 1 ? "" : "s"}.` }
      ];
      let imageBytes = 0;
      let budgetOmitted = 0;
      for (const section of sections) {
        content.push({ type: "text", text: section.section === "main" ? "Main workout" : section.section === "warmup" ? "Warm-up" : "Cooldown" });
        for (const slot of section.slots) {
          content.push({ type: "text", text: slotCaption(slot) });
          if (slot.image_url === null) {
            content.push({ type: "text", text: "No exercise image is available." });
            continue;
          }
          const result = thumbnails.get(thumbnailUrls.get(slot)!);
          if (result instanceof Error || result === undefined) {
            content.push({ type: "text", text: `Exercise image unavailable: ${result instanceof Error ? result.message : "Unknown image error."}` });
          } else if (imageBytes + Buffer.from(result.data, "base64").length > maxImageTotalBytes) {
            budgetOmitted += 1;
          } else {
            imageBytes += Buffer.from(result.data, "base64").length;
            content.push({ type: "image", ...result });
          }
        }
        if (section.omitted > 0) content.push({ type: "text", text: `${section.omitted} more ${section.section} exercise${section.omitted === 1 ? "" : "s"} omitted by the per-section limit.` });
      }
      if (budgetOmitted > 0) content.push({ type: "text", text: `${budgetOmitted} thumbnail${budgetOmitted === 1 ? "" : "s"} omitted to stay within the ${maxImageTotalBytes}-byte image budget.` });
      return { content };
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_show_workout_cards", {
    title: "Show Planned Workout Cards",
    description: "Display the workout as an interactive exercise table with Caliverse thumbnails, sets, reps, rest, and playable exercise videos inside Claude Desktop.",
    inputSchema: { workoutId: z.number().int().positive(), cardImageSize: z.number().int().min(128).max(512).default(320), quality: z.number().int().min(1).max(100).default(70), limit: z.number().int().positive().max(24).default(24) },
    annotations: readAnnotations,
    _meta: { ui: { resourceUri: WORKOUT_CARDS_URI } }
  }, async ({ workoutId, cardImageSize, quality, limit }) => {
    try {
      const workout = await api.getWorkout(workoutId);
      const sections = limitedWorkoutSlots(workout, "main", limit);
      const cards = sections.flatMap((section) => section.slots).map((slot) => ({
        ...slot,
        card_image_url: slot.image_url === null ? null : buildThumbnailUrl(slot.image_url, { size: cardImageSize, format: "webp", quality })
      }));
      const source = record(workout);
      const result = {
        workout: { id: workoutId, title: workoutTitle(workout), level: typeof source?.level === "string" ? source.level : null, length_in_minutes: typeof source?.length_in_minutes === "number" ? source.length_in_minutes : null },
        cards,
        omitted_by_section: Object.fromEntries(sections.filter((section) => section.omitted > 0).map((section) => [section.section, section.omitted]))
      };
      return { content: [{ type: "text" as const, text: `${workoutTitle(workout)}: ${cards.length} exercise${cards.length === 1 ? "" : "s"} displayed in the workout card view.` }], structuredContent: result };
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_my_workouts", {
    title: "List My Caliverse Workouts",
    description: "List account workouts. Default detail is summary; use offset and nextOffset to page. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: workoutDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    return workoutListResult(() => api.listMyWorkouts(), query, offset, limit, detail, fields);
  });

  server.registerTool("caliverse_get_workout", {
    title: "Get Caliverse Workout",
    description: "Get a workout. Default detail structure preserves the complete editable superset structure without expanded warmup/cooldown workouts. Use full for the unmodified API object.",
    inputSchema: { workoutId: z.number().int().positive(), detail: workoutDetailSchema.default("structure"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ workoutId, detail, fields }) => {
    try {
      const workout = await api.getWorkout(workoutId);
      return projectedResult(workout, projectWorkout(workout, detail, fields), detail);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_categories", { title: "List Workout Categories", description: "List workout categories.", inputSchema: {}, annotations: readAnnotations }, async () => {
    try { return textResult(await api.listCategories()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_groups", { title: "List Workout Groups", description: "List workout groups.", inputSchema: {}, annotations: readAnnotations }, async () => {
    try { return textResult(await api.listGroups()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_workout_plans", {
    title: "List Caliverse Workout Plans",
    description: "List workout plans. Default summary uses Caliverse's compact plan endpoint; full preserves the existing complete plan API response. Use offset and nextOffset to page.",
    inputSchema: { ...pageSchema, detail: planDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ offset, limit, detail, fields }) => {
    try {
      const plans = detail === "summary" && fields === undefined ? await api.listPlansShort() : await api.listPlans();
      return Array.isArray(plans) ? projectedPage(plans, offset, limit, detail, (item) => projectPlan(item, detail, fields)) : textResult(plans);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_workout_plan", {
    title: "Get Caliverse Workout Plan",
    description: "Get a workout plan by ID. Default summary omits the large levels tree; use full for the unmodified API object.",
    inputSchema: { planId: z.number().int().positive(), detail: planDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ planId, detail, fields }) => {
    try {
      const plan = await api.getPlan(planId);
      return projectedResult(plan, projectPlan(plan, detail, fields), detail);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_create_workout_plan", {
    title: "Create Caliverse Workout Plan",
    description: "Create a custom workout plan. This does not activate the plan; no plan-update or activation endpoint has been verified. Requires confirm: true.",
    inputSchema: { ...planInputSchema.shape, confirm: z.literal(true) },
    annotations: writeAnnotations
  }, async ({ confirm: _confirm, ...input }) => {
    try { return textResult(await api.createPlan(input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_create_workout", {
    title: "Create Caliverse Workout", description: "Create a custom workout. Put concise execution cues in visible superset titles; Caliverse stores but does not show workout-exercise descriptions in the app. Requires confirm: true.", inputSchema: { ...workoutInputSchema.shape, confirm: z.literal(true) },
    annotations: writeAnnotations
  }, async ({ confirm: _confirm, ...input }) => {
    try { return textResult(await api.createWorkout(input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_update_workout", {
    title: "Update Caliverse Workout", description: "Replace a custom workout's complete definition. Read it first with detail structure and preserve existing workout-exercise descriptions even though Caliverse does not display them in the app. Put new concise cues in superset titles. Requires confirm: true.", inputSchema: { ...workoutInputSchema.shape, workoutId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: destructiveAnnotations
  }, async ({ workoutId, confirm: _confirm, ...input }) => {
    try { return textResult(await api.updateWorkout(workoutId, input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_clone_workout", {
    title: "Clone Caliverse Workout", description: "Clone a workout with a new title. The clone is always private and non-Pro regardless of the source. Requires confirm: true.", inputSchema: { workoutId: z.number().int().positive(), title: z.string().trim().min(1).max(200), confirm: z.literal(true) },
    annotations: writeAnnotations
  }, async ({ workoutId, title }) => {
    try { return textResult(await api.cloneWorkout(workoutId, title)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_delete_workout", {
    title: "Delete Caliverse Workout", description: "Permanently delete a custom workout. Requires confirm: true.", inputSchema: { workoutId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: destructiveAnnotations
  }, async ({ workoutId }) => {
    try { return textResult(await api.deleteWorkout(workoutId)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_delete_workout_plan", {
    title: "Delete Caliverse Workout Plan", description: "Permanently delete a custom workout plan. Refuses to delete the active plan; deactivate it in Caliverse first. Requires confirm: true.", inputSchema: { planId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: destructiveAnnotations
  }, async ({ planId }) => {
    try { return textResult(await api.deleteWorkoutPlan(planId)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_progress_signals", {
    title: "Get Caliverse Progress Signals",
    description: "Get progress signals only for exercises in today's Smart Coach workout. tier_b reports a personal-best change when one occurred; tier_c reports the most recent performance, not an all-time record.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getProgressSignals()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_exercise_prs", {
    title: "Get Caliverse Exercise PRs",
    description: "Aggregate exercise PRs from completed daily logs. Scans one read-only API request per day; defaults to the last 90 days and accepts at most 120 days per request. Repetition count/time and kilograms are reported separately.",
    inputSchema: { from: isoDateSchema.optional(), to: isoDateSchema.default(() => todayDateString()) },
    annotations: readAnnotations
  }, async ({ from, to }) => {
    try { return textResult(await api.getExercisePrs(from ?? dateDaysAgo(89), to)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_available_equipment", {
    title: "Get Available Caliverse Equipment",
    description: "Get only equipment available to you. Exercise suitability normally requires every required_equipments[].id to appear in this list, but that field has been absent from observed caliverse_list_exercises responses; do not assume library filtering is complete.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getAvailableEquipment()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_equipment_catalog", {
    title: "List Caliverse Equipment Catalog",
    description: "List all Caliverse equipment IDs and titles. Use these IDs with caliverse_set_available_equipment.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.listEquipmentCatalog()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_set_available_equipment", {
    title: "Set Available Caliverse Equipment",
    description: "Replace your complete available-equipment list. This affects future Smart Coach workouts. Requires confirm: true.",
    inputSchema: { equipmentIds: z.array(z.number().int().positive()).min(1).max(100), confirm: z.literal(true) },
    annotations: destructiveAnnotations
  }, async ({ equipmentIds }) => {
    try { return textResult(await api.setAvailableEquipment(equipmentIds)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_workout_filters", {
    title: "Get Caliverse Workout Filters",
    description: "Get Caliverse's canonical workout level values and muscle-group filter IDs.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getWorkoutFilters()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_subscription", {
    title: "Get Caliverse Subscription",
    description: "Get your Caliverse subscription type, status, and expiry.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getSubscription()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_my_day", {
    title: "Get Caliverse Day Schedule",
    description: "Get one day's scheduled, missed, attended, and finished workouts. date defaults to today (YYYY-MM-DD).",
    inputSchema: { date: isoDateSchema.default(() => todayDateString()) },
    annotations: readAnnotations
  }, async ({ date }) => {
    try { return textResult(await api.getMyDay(date)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_schedule_calendar", {
    title: "Get Caliverse Schedule Calendar",
    description: "Get the dates with scheduled workouts within a date range (YYYY-MM-DD, inclusive).",
    inputSchema: calendarDateRangeSchema,
    annotations: readAnnotations
  }, async ({ dateFrom, dateTo }) => {
    try { return textResult(await api.getScheduleCalendar(dateFrom, dateTo)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_available_days", {
    title: "Get Available Caliverse Days",
    description: "Get your available training days. Day numbers are inferred to use ISO weekdays: 1 is Monday and 7 is Sunday.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getAvailableDays()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_user_properties", {
    title: "Get Caliverse User Properties",
    description: "Get account workout-generation settings as key-value records. Known keys include DAILY_WORKOUT_FITNESS_LEVEL, DAILY_WORKOUT_GENERERATION_ENABLED (server spelling), DAILY_WORKOUT_PREFERRED_LENGTH, and DAILY_WORKOUT_FITNESS_GOAL.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getUserProperties()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_workout_goals", {
    title: "List Caliverse Workout Goals",
    description: "List Caliverse's goal catalog and each goal's linked workout-plan summary.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try {
      const goals = await api.listWorkoutGoals();
      return Array.isArray(goals) ? textResult(goals.map(projectWorkoutGoal)) : textResult(goals);
    } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_featured_workouts", {
    title: "List Featured Caliverse Workouts",
    description: "List featured public workouts. Default detail is summary; use offset and nextOffset to page. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: workoutDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    return workoutListResult(() => api.listFeaturedWorkouts(), query, offset, limit, detail, fields);
  });

  server.registerTool("caliverse_list_generated_workouts", {
    title: "List Generated Caliverse Workouts",
    description: "List recently AI-generated workouts. generatedLimit controls Caliverse's server-side result count (default 5); use offset and limit to page the returned results. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), generatedLimit: z.number().int().positive().max(200).default(5), ...pageSchema, detail: workoutDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, generatedLimit, offset, limit, detail, fields }) => {
    return workoutListResult(() => api.listGeneratedWorkouts(generatedLimit), query, offset, limit, detail, fields);
  });

  server.registerTool("caliverse_get_coach_profile", {
    title: "Get Smart Coach Profile",
    description: "Get the Smart Coach profile: goal, experience level, training days per week, and coaching notes.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getCoachProfile()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_coach_today", {
    title: "Get Smart Coach Today",
    description: "Get today's Smart Coach-assigned workout.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getCoachToday()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_coach_history", {
    title: "Get Smart Coach History",
    description: "Get Smart Coach-assigned workouts within a date range (YYYY-MM-DD, inclusive).",
    inputSchema: fromToDateRangeSchema,
    annotations: readAnnotations
  }, async ({ from, to }) => {
    try { return textResult(await api.getCoachHistory(from, to)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_active_plan", {
    title: "Get Active Caliverse Plan",
    description: "Get the currently active workout plan, if any.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getActivePlan()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_progression_tree", {
    title: "Get Exercise Progression Tree",
    description: "Get the regression/progression ladder of exercises related to one exercise ID.",
    inputSchema: { exerciseId: z.number().int().positive() },
    annotations: readAnnotations
  }, async ({ exerciseId }) => {
    try { return textResult(await api.getProgressionTree(exerciseId)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_muscle_groups", {
    title: "List Muscle Groups",
    description: "List Caliverse's muscle-group catalog (id and title).",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.listMuscleGroups()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_my_workout_rating", {
    title: "Get My Workout Rating",
    description: "Get the account's own rating for one workout (distinct from the workout's average rating/rating_count).",
    inputSchema: { workoutId: z.number().int().positive() },
    annotations: readAnnotations
  }, async ({ workoutId }) => {
    try { return textResult(await api.getMyWorkoutRating(workoutId)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_list_favorite_workouts", {
    title: "List Favorite Workouts",
    description: "List workouts favorited by the account. Default detail is summary; use offset and nextOffset to page.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: workoutDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    return workoutListResult(() => api.listFavoriteWorkouts(), query, offset, limit, detail, fields);
  });

  server.registerTool("caliverse_get_log_feedback_options", {
    title: "Get Workout Log Feedback Options",
    description: "Get the fixed post-workout feedback questions and their allowed answers.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getLogFeedbackOptions()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_log_workout_completion", {
    title: "Log a Completed Caliverse Workout",
    description: [
      "Log a completed workout session so it counts toward history, streaks, and progress signals.",
      "Identify each exercise performed by its library exerciseId (from caliverse_get_workout or caliverse_list_exercises) and list its sets in order; this tool resolves each exerciseId to its position-specific slot in the workout automatically.",
      "Weight is recorded in kilograms only. Timestamps accept \"YYYY-MM-DD HH:mm:ss\" (local time) or an ISO 8601 string; per-set timestamps are optional and default to the overall session start/finish.",
      "This was derived from a single observed mobile-app request that logged an entire workout at once; behavior for partial logs (not every exercise/set in the workout) has not been verified. Requires confirm: true."
    ].join(" "),
    inputSchema: { ...workoutLogInputSchema.shape, confirm: z.literal(true) },
    annotations: writeAnnotations
  }, async ({ confirm: _confirm, ...input }) => {
    try { return textResult(await api.logWorkoutCompletion(input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_delete_workout_log", {
    title: "Delete a Workout Log",
    description: "Delete a previously logged completed workout session by its log ID. Requires confirm: true.",
    inputSchema: { logId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: destructiveAnnotations
  }, async ({ logId }) => {
    try { return textResult(await api.deleteWorkoutLog(logId)); } catch (error) { return errorResult(error); }
  });

}
