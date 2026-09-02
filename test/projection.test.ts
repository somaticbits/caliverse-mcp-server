import assert from "node:assert/strict";
import test from "node:test";
import { projectExercise, projectPlan, projectWorkout, workoutSlots } from "../src/projection.js";
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

test("workout structure projects missing and invalid workout references as null", () => {
  const projected = projectWorkout({ id: 12, warmup_workout: undefined, cooldown_workout: "invalid" }, "structure") as Record<string, unknown>;
  assert.equal(projected.warmup_workout, null);
  assert.equal(projected.cooldown_workout, null);
});

test("workoutSlots preserves real per-superset exercise ordering", () => {
  const workout = {
    supersets: [
      { id: 4625074, order_in_workout: 4, workout_exercises: [{ id: 9343653, order_in_workout: 2, set_count: 3, repetition_count: 12, repetition_type: "count", rest_time_before_exercise: 60, exercise: { id: 554, title: "Hollow Body Tucks", image_url: "eight" } }, { id: 9343652, order_in_workout: 1, set_count: 3, repetition_count: 15, repetition_type: "time", rest_time_before_exercise: 0, exercise: { id: 1275, title: "Front Lever Advanced Tuck Hold", image_url: "seven" } }] },
      { id: 4625072, order_in_workout: 2, workout_exercises: [{ id: 9343649, order_in_workout: 2, set_count: 4, repetition_count: 8, repetition_type: "count", rest_time_before_exercise: 60, exercise: { id: 1609, title: "Push-up", image_url: "four" } }, { id: 9343648, order_in_workout: 1, set_count: 4, repetition_count: 5, repetition_type: "count", rest_time_before_exercise: 0, exercise: { id: 1276, title: "Front Lever Tuck Pulse", image_url: "three" } }] },
      { id: 4625071, order_in_workout: 1, workout_exercises: [{ id: 9343647, order_in_workout: 2, set_count: 4, repetition_count: 8, repetition_type: "count", rest_time_before_exercise: 60, exercise: { id: 17, title: "Bodyweight Row", image_url: "two" } }, { id: 9343646, order_in_workout: 1, set_count: 4, repetition_count: 5, repetition_type: "count", rest_time_before_exercise: 0, exercise: { id: 1279, title: "Front Lever Tuck Hold", image_url: "one" } }] },
      { id: 4625073, order_in_workout: 3, workout_exercises: [{ id: 9343651, order_in_workout: 2, set_count: 4, repetition_count: 8, repetition_type: "count", rest_time_before_exercise: 60, exercise: { id: 15, title: "Dive Bomber Push Up", image_url: "six" } }, { id: 9343650, order_in_workout: 1, set_count: 4, repetition_count: 5, repetition_type: "count", rest_time_before_exercise: 0, exercise: { id: 1274, title: "Front Lever Advanced Tuck Pulse", image_url: "five" } }] }
    ]
  };
  assert.deepEqual(workoutSlots(workout).map((slot) => [slot.position, slot.superset, slot.order_in_superset, slot.exercise_id]), [
    [1, 1, 1, 1279], [2, 1, 2, 17], [3, 2, 1, 1276], [4, 2, 2, 1609], [5, 3, 1, 1274], [6, 3, 2, 15], [7, 4, 1, 1275], [8, 4, 2, 554]
  ]);
});

test("workoutSlots handles globally numbered exercises and orders out-of-order supersets", () => {
  const workout = { supersets: [
    { order_in_workout: 2, workout_exercises: [{ order_in_workout: 3, exercise: { id: 3 } }, { order_in_workout: 4, exercise: { id: 4 } }] },
    { order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, exercise: { id: 1 } }, { order_in_workout: 2, exercise: { id: 2 } }] }
  ] };
  assert.deepEqual(workoutSlots(workout).map((slot) => slot.exercise_id), [1, 2, 3, 4]);
});
