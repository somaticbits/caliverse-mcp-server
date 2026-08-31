import assert from "node:assert/strict";
import test from "node:test";
import { projectExercise, projectPlan, projectWorkout } from "../src/projection.js";
import { workoutInputSchema } from "../src/types.js";

test("exercise and plan summaries omit their large detail fields", () => {
  assert.deepEqual(projectExercise({ id: 1, title: "Push-up", description: "long", athlete: {} }, "summary"), { id: 1, title: "Push-up" });
  assert.deepEqual(projectPlan({ id: 2, title: "Plan", levels: [{ workouts: [] }], description: "long" }, "summary"), { id: 2, title: "Plan" });
});

test("workout structure retains the clone input fields while removing expanded relations", () => {
  const source = {
    id: 12, title: "Source", private_title: "Private", is_public: 0, is_pro: 0, length_in_minutes: "45", level: "beginner", image_url: null,
    warmup_workout: { id: 2, title: "Warmup", workout_exercises: [{ exercise: { id: 1, description: "large" } }] },
    cooldown_workout: { id: 3, title: "Cooldown", workout_exercises: [{ exercise: { id: 1, description: "large" } }] },
    groups: [{ id: 4, image_url: "large" }], workout_categories: [{ id: 5, description: "large" }],
    workout_exercises: [{ exercise: { id: 9, description: "duplicate" } }],
    supersets: [{ id: 7, rest_between_cycles: 60, order_in_workout: 1, title: "A", workout_exercises: [{ exercise: { id: 42, title: "Push-up", description: "large" }, set_count: 3, repetition_count: 8, repetition_type: "count", order_in_workout: 1, rest_time_before_exercise: 0 }] }]
  };
  const projected = projectWorkout(source, "structure") as Record<string, unknown>;
  assert.equal("workout_exercises" in projected, false);
  assert.deepEqual(projected.warmup_workout, { id: 2, title: "Warmup" });
  const superset = (projected.supersets as Array<Record<string, unknown>>)[0];
  assert.ok(superset);
  const exercise = (superset.workout_exercises as Array<Record<string, unknown>>)[0];
  assert.ok(exercise);
  const input = workoutInputSchema.parse({
    title: "Clone", privateTitle: projected.private_title, isPublic: false, isPro: false, lengthInMinutes: projected.length_in_minutes,
    level: projected.level, warmupWorkoutId: (projected.warmup_workout as { id: number }).id, cooldownWorkoutId: (projected.cooldown_workout as { id: number }).id,
    imageUrl: projected.image_url, groupIds: (projected.groups as Array<{ id: number }>).map((item) => item.id), categoryIds: (projected.workout_categories as Array<{ id: number }>).map((item) => item.id),
    supersets: [{ supersetId: superset.id, restBetweenCycles: superset.rest_between_cycles, orderInWorkout: superset.order_in_workout, title: superset.title, exercises: [{ exerciseId: (exercise.exercise as { id: number }).id, setCount: exercise.set_count, repetitionCount: exercise.repetition_count, repetitionType: exercise.repetition_type, orderInWorkout: exercise.order_in_workout, restTimeBeforeExercise: exercise.rest_time_before_exercise }] }]
  });
  assert.equal(input.lengthInMinutes, 45);
  assert.equal(input.supersets[0]?.exercises[0]?.exerciseId, 42);
});
