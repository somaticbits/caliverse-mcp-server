import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "./client.js";
import { workoutInputSchema } from "./types.js";

function textResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown Caliverse MCP error.";
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined;
}

function exerciseMatches(exercise: unknown, query: string): boolean {
  const item = record(exercise);
  if (item === undefined) {
    return false;
  }
  return Object.values(item).some((value) => typeof value === "string" && value.toLocaleLowerCase().includes(query));
}

export function registerTools(server: McpServer, api: CaliverseApi): void {
  server.tool(
    "caliverse_list_exercises",
    "List Caliverse exercises. Use query to filter locally by any text field; results are capped at 100.",
    { query: z.string().trim().min(1).max(100).optional() },
    async ({ query }) => {
      try {
        const exercises = await api.listExercises();
        if (!Array.isArray(exercises)) {
          return textResult(exercises);
        }
        const normalizedQuery = query?.toLocaleLowerCase();
        const results = normalizedQuery === undefined
          ? exercises
          : exercises.filter((exercise) => exerciseMatches(exercise, normalizedQuery));
        return textResult({ total: results.length, exercises: results.slice(0, 100) });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "caliverse_get_exercise",
    "Get one exercise from Caliverse's exercise library by ID.",
    { exerciseId: z.number().int().positive() },
    async ({ exerciseId }) => {
      try {
        const exercises = await api.listExercises();
        if (!Array.isArray(exercises)) {
          return errorResult("Caliverse returned an invalid exercise list.");
        }
        const exercise = exercises.find((item) => record(item)?.id === exerciseId);
        return exercise === undefined ? errorResult(`Exercise ${exerciseId} was not found.`) : textResult(exercise);
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool("caliverse_list_my_workouts", "List workouts owned by the authenticated Caliverse account.", {}, async () => {
    try {
      return textResult(await api.listMyWorkouts());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool(
    "caliverse_get_workout",
    "Get a Caliverse workout and its complete superset/exercise structure.",
    { workoutId: z.number().int().positive() },
    async ({ workoutId }) => {
      try {
        return textResult(await api.getWorkout(workoutId));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool("caliverse_list_categories", "List workout categories.", {}, async () => {
    try {
      return textResult(await api.listCategories());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool("caliverse_list_groups", "List workout groups.", {}, async () => {
    try {
      return textResult(await api.listGroups());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool("caliverse_list_workout_plans", "List available Caliverse workout plans.", {}, async () => {
    try {
      return textResult(await api.listPlans());
    } catch (error) {
      return errorResult(error);
    }
  });

  server.tool(
    "caliverse_get_workout_plan",
    "Get a Caliverse workout plan by ID.",
    { planId: z.number().int().positive() },
    async ({ planId }) => {
      try {
        return textResult(await api.getPlan(planId));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "caliverse_create_workout",
    "Create a custom workout. Call caliverse_list_exercises first to obtain valid exercise IDs. level must match a value used by your existing workouts. This writes to your account and requires confirm: true.",
    { ...workoutInputSchema.shape, confirm: z.literal(true) },
    async ({ confirm: _confirm, ...input }) => {
      try {
        return textResult(await api.createWorkout(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "caliverse_update_workout",
    "Replace a custom workout's complete definition. Read it first, preserve fields you intend to keep, and pass confirm: true.",
    { ...workoutInputSchema.shape, workoutId: z.number().int().positive(), confirm: z.literal(true) },
    async ({ workoutId, confirm: _confirm, ...input }) => {
      try {
        return textResult(await api.updateWorkout(workoutId, input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "caliverse_clone_workout",
    "Clone an existing workout with a new title. This writes to your account and requires confirm: true.",
    { workoutId: z.number().int().positive(), title: z.string().trim().min(1).max(200), confirm: z.literal(true) },
    async ({ workoutId, title }) => {
      try {
        return textResult(await api.cloneWorkout(workoutId, title));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.tool(
    "caliverse_delete_workout",
    "Permanently delete a custom workout. This is irreversible and requires confirm: true.",
    { workoutId: z.number().int().positive(), confirm: z.literal(true) },
    async ({ workoutId }) => {
      try {
        return textResult(await api.deleteWorkout(workoutId));
      } catch (error) {
        return errorResult(error);
      }
    }
  );
}
