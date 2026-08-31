import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "./client.js";
import { omittedKeys, projectExercise, projectPlan, projectWorkout } from "./projection.js";
import { fieldsSchema, pageSchema, pagedResult, textResult } from "./response.js";
import { workoutInputSchema } from "./types.js";

const readAnnotations = { readOnlyHint: true, openWorldHint: true };
const exerciseDetailSchema = z.enum(["summary", "full"]);
const workoutDetailSchema = z.enum(["summary", "structure", "full"]);
const planDetailSchema = z.enum(["summary", "full"]);

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
}
