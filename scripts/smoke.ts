import { TokenManager } from "../src/auth.js";
import { CaliverseApi } from "../src/client.js";
import { loadRefreshToken } from "../src/credentials.js";

function exerciseId(value: unknown): number | undefined {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "number"
    ? (value as { id: number }).id
    : undefined;
}

async function main(): Promise<void> {
  if (process.env.CALIVERSE_LIVE_TEST !== "1") {
    throw new Error("Refusing live network access. Set CALIVERSE_LIVE_TEST=1 to run this smoke test.");
  }

  const api = new CaliverseApi({ tokenManager: new TokenManager(await loadRefreshToken()) });
  const [exercises, workouts] = await Promise.all([api.listExercises(), api.listMyWorkouts()]);
  const exerciseCount = Array.isArray(exercises) ? exercises.length : "unknown";
  const workoutCount = Array.isArray(workouts) ? workouts.length : "unknown";
  process.stderr.write(`Read-only smoke test passed: ${exerciseCount} exercises, ${workoutCount} workouts.\n`);

  if (process.env.CALIVERSE_LIVE_MUTATION_TEST !== "1") {
    return;
  }
  const firstExerciseId = Array.isArray(exercises) ? exerciseId(exercises[0]) : undefined;
  if (firstExerciseId === undefined) {
    throw new Error("Cannot run mutation smoke test: no usable exercise was returned.");
  }
  const level = process.env.CALIVERSE_TEST_LEVEL;
  if (level === undefined || level.length === 0) {
    throw new Error("Set CALIVERSE_TEST_LEVEL to a level observed in caliverse_list_my_workouts before mutation testing.");
  }

  let createdId: number | undefined;
  try {
    const created = await api.createWorkout({
      title: `MCP smoke test ${new Date().toISOString()}`,
      isPublic: false,
      isPro: false,
      lengthInMinutes: 5,
      level,
      groupIds: [],
      categoryIds: [],
      supersets: [{
        restBetweenCycles: 30,
        orderInWorkout: 1,
        title: "Smoke test",
        exercises: [{
          exerciseId: firstExerciseId,
          setCount: 1,
          repetitionCount: 1,
          repetitionType: "count",
          orderInWorkout: 1,
          restTimeBeforeExercise: 0
        }]
      }]
    });
    createdId = exerciseId(created);
    if (createdId === undefined) {
      throw new Error("Creation returned no workout ID; refusing automatic cleanup.");
    }
    await api.getWorkout(createdId);
    process.stderr.write(`Mutation smoke test created and read workout ${createdId}.\n`);
  } finally {
    if (createdId !== undefined) {
      await api.deleteWorkout(createdId);
      process.stderr.write(`Mutation smoke test deleted workout ${createdId}.\n`);
    }
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown smoke-test error.";
  process.stderr.write(`Smoke test failed: ${message}\n`);
  process.exitCode = 1;
});
