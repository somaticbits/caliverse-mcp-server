import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "./client.js";
import { omittedKeys, projectExercise, projectPlan, projectWorkout } from "./projection.js";
import { fieldsSchema, pageSchema, pagedResult, textResult } from "./response.js";
import { todayDateString, workoutInputSchema, workoutLogInputSchema } from "./types.js";

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const exerciseDetailSchema = z.enum(["summary", "full"]);
const workoutDetailSchema = z.enum(["summary", "structure", "full"]);
const planDetailSchema = z.enum(["summary", "full"]);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.");

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return todayDateString(() => date);
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Caliverse MCP error.";
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function exerciseMatches(exercise: unknown, query: string): boolean {
  const item = record(exercise);
  return item !== undefined && Object.values(item).some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
}

function projectedResult(raw: unknown, projected: unknown, detail: string) {
  if (raw === projected) {
    return textResult(raw);
  }
  return textResult({ detail, omitted: omittedKeys(raw, projected), value: projected });
}

function projectedPage(items: unknown[], offset: number, limit: number, detail: string, project: (item: unknown) => unknown) {
  const projectedItems = items.map(project);
  const omitted = [...new Set(items.flatMap((item, index) => omittedKeys(item, projectedItems[index])))].sort();
  return textResult(pagedResult(projectedItems, offset, limit, detail, omitted));
}

export function registerTools(server: McpServer, api: CaliverseApi): void {
  // Do not add outputSchema here: SDK 1.30 requires structuredContent when one is set,
  // duplicating every JSON payload alongside the required text content.
  server.registerTool("caliverse_list_exercises", {
    title: "List Caliverse Exercises",
    description: "List exercises. Default detail is summary; use offset and nextOffset to page through results. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: exerciseDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    try {
      const exercises = await api.listExercises();
      if (!Array.isArray(exercises)) return textResult(exercises);
      const normalizedQuery = query?.toLocaleLowerCase();
      const results = normalizedQuery === undefined ? exercises : exercises.filter((exercise) => exerciseMatches(exercise, normalizedQuery));
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

  server.registerTool("caliverse_list_my_workouts", {
    title: "List My Caliverse Workouts",
    description: "List account workouts. Default detail is summary; use offset and nextOffset to page. fields selects explicit top-level fields.",
    inputSchema: { query: z.string().trim().min(1).max(100).optional(), ...pageSchema, detail: workoutDetailSchema.default("summary"), fields: fieldsSchema },
    annotations: readAnnotations
  }, async ({ query, offset, limit, detail, fields }) => {
    try {
      const workouts = await api.listMyWorkouts();
      if (!Array.isArray(workouts)) return textResult(workouts);
      const normalizedQuery = query?.toLocaleLowerCase();
      const results = normalizedQuery === undefined ? workouts : workouts.filter((workout) => exerciseMatches(workout, normalizedQuery));
      return projectedPage(results, offset, limit, detail, (item) => projectWorkout(item, detail, fields));
    } catch (error) { return errorResult(error); }
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

  server.registerTool("caliverse_create_workout", {
    title: "Create Caliverse Workout", description: "Create a custom workout. Requires confirm: true.", inputSchema: { ...workoutInputSchema.shape, confirm: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ confirm: _confirm, ...input }) => {
    try { return textResult(await api.createWorkout(input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_update_workout", {
    title: "Update Caliverse Workout", description: "Replace a custom workout's complete definition. Read it first with detail structure, preserve fields to keep, and pass confirm: true.", inputSchema: { ...workoutInputSchema.shape, workoutId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, async ({ workoutId, confirm: _confirm, ...input }) => {
    try { return textResult(await api.updateWorkout(workoutId, input)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_clone_workout", {
    title: "Clone Caliverse Workout", description: "Clone a workout with a new title. Requires confirm: true.", inputSchema: { workoutId: z.number().int().positive(), title: z.string().trim().min(1).max(200), confirm: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }, async ({ workoutId, title }) => {
    try { return textResult(await api.cloneWorkout(workoutId, title)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_delete_workout", {
    title: "Delete Caliverse Workout", description: "Permanently delete a custom workout. Requires confirm: true.", inputSchema: { workoutId: z.number().int().positive(), confirm: z.literal(true) },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, async ({ workoutId }) => {
    try { return textResult(await api.deleteWorkout(workoutId)); } catch (error) { return errorResult(error); }
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
    inputSchema: { from: dateSchema.optional(), to: dateSchema.default(() => todayDateString()) },
    annotations: readAnnotations
  }, async ({ from, to }) => {
    try { return textResult(await api.getExercisePrs(from ?? dateDaysAgo(89), to)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_available_equipment", {
    title: "Get Available Caliverse Equipment",
    description: "Get only equipment available to you. An exercise is suitable when every required_equipments[].id from caliverse_list_exercises appears in this list.",
    inputSchema: {},
    annotations: readAnnotations
  }, async () => {
    try { return textResult(await api.getAvailableEquipment()); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_my_day", {
    title: "Get Caliverse Day Schedule",
    description: "Get one day's scheduled, missed, attended, and finished workouts. date defaults to today (YYYY-MM-DD).",
    inputSchema: { date: dateSchema.default(() => todayDateString()) },
    annotations: readAnnotations
  }, async ({ date }) => {
    try { return textResult(await api.getMyDay(date)); } catch (error) { return errorResult(error); }
  });

  server.registerTool("caliverse_get_schedule_calendar", {
    title: "Get Caliverse Schedule Calendar",
    description: "Get the dates with scheduled workouts within a date range (YYYY-MM-DD, inclusive).",
    inputSchema: { dateFrom: dateSchema, dateTo: dateSchema },
    annotations: readAnnotations
  }, async ({ dateFrom, dateTo }) => {
    try { return textResult(await api.getScheduleCalendar(dateFrom, dateTo)); } catch (error) { return errorResult(error); }
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
    inputSchema: { from: dateSchema, to: dateSchema },
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
    try {
      const workouts = await api.listFavoriteWorkouts();
      if (!Array.isArray(workouts)) return textResult(workouts);
      const normalizedQuery = query?.toLocaleLowerCase();
      const results = normalizedQuery === undefined ? workouts : workouts.filter((workout) => exerciseMatches(workout, normalizedQuery));
      return projectedPage(results, offset, limit, detail, (item) => projectWorkout(item, detail, fields));
    } catch (error) { return errorResult(error); }
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
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true }
  }, async ({ logId }) => {
    try { return textResult(await api.deleteWorkoutLog(logId)); } catch (error) { return errorResult(error); }
  });
}
