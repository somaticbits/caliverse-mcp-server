import assert from "node:assert/strict";
import test from "node:test";
import { mapWorkoutLogToApiPayload, toCaliverseDateTime, todayDateString, workoutLogInputSchema } from "../src/types.js";

function sampleWorkout(): unknown {
  return {
    id: 131,
    supersets: [
      {
        id: 557,
        workout_exercises: [
          { id: 10957, order_in_workout: 1, exercise: { id: 59, title: "Glute Bridge" } },
          { id: 10958, order_in_workout: 2, exercise: { id: 250, title: "Bird Dog" } },
          { id: 10959, order_in_workout: 3, exercise: { id: 104, title: "Squat" } }
        ]
      },
      {
        id: 558,
        workout_exercises: [
          { id: 10960, order_in_workout: 4, exercise: { id: 210, title: "Bulgarian Split Squat" } }
        ]
      }
    ]
  };
}

test("toCaliverseDateTime passes plain wall-clock strings through unchanged", () => {
  assert.equal(toCaliverseDateTime("2026-08-31 10:32:33"), "2026-08-31 10:32:33");
});

test("toCaliverseDateTime formats other parseable dates using local time components", () => {
  const iso = "2026-08-31T10:32:33.000Z";
  const expected = (() => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  })();
  assert.equal(toCaliverseDateTime(iso), expected);
});

test("toCaliverseDateTime rejects unparseable input", () => {
  assert.throws(() => toCaliverseDateTime("not-a-date"), /is not a valid date/);
});

test("todayDateString formats an injected clock as YYYY-MM-DD", () => {
  assert.equal(todayDateString(() => new Date(2026, 0, 5)), "2026-01-05");
});

test("todayDateString defaults to the current date", () => {
  assert.match(todayDateString(), /^\d{4}-\d{2}-\d{2}$/);
});

test("mapWorkoutLogToApiPayload resolves exercise IDs to workout_exercise_id slots in order", () => {
  const input = workoutLogInputSchema.parse({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [
      { exerciseId: 59, sets: [{ repetitionCount: 15 }, { repetitionCount: 15 }] },
      { exerciseId: 210, sets: [{ repetitionCount: 8, addedWeightKg: 10, restSecondsBefore: 60 }] }
    ]
  });

  const payload = mapWorkoutLogToApiPayload(sampleWorkout(), input);

  assert.equal(payload.workout_id, 131);
  assert.equal(payload.started_at, "2026-08-31 10:32:33");
  assert.equal(payload.finished_at, "2026-08-31 10:33:06");
  assert.equal(payload.workout_exercise_logs.length, 3);

  const [set1, set2, set3] = payload.workout_exercise_logs;
  assert.deepEqual(set1, {
    order_in_workout: 1,
    started_at: "2026-08-31 10:32:33",
    finished_at: "2026-08-31 10:33:06",
    rest_seconds_before: 0,
    repetition_count: 15,
    added_weight: 0,
    added_weight_unit: 1,
    set_in_exercise: 1,
    workout_exercise_id: 10957
  });
  assert.equal(set2?.set_in_exercise, 2);
  assert.equal(set2?.workout_exercise_id, 10957);
  assert.deepEqual(set3, {
    order_in_workout: 4,
    started_at: "2026-08-31 10:32:33",
    finished_at: "2026-08-31 10:33:06",
    rest_seconds_before: 60,
    repetition_count: 8,
    added_weight: 10,
    added_weight_unit: 1,
    set_in_exercise: 1,
    workout_exercise_id: 10960
  });
});

test("mapWorkoutLogToApiPayload consumes repeated exercise IDs in workout order", () => {
  const workout = {
    id: 1,
    supersets: [{
      id: 1,
      workout_exercises: [
        { id: 100, order_in_workout: 1, exercise: { id: 5 } },
        { id: 101, order_in_workout: 2, exercise: { id: 5 } }
      ]
    }]
  };
  const input = workoutLogInputSchema.parse({
    workoutId: 1,
    startedAt: "2026-01-01 00:00:00",
    finishedAt: "2026-01-01 00:10:00",
    exercises: [
      { exerciseId: 5, sets: [{ repetitionCount: 10 }] },
      { exerciseId: 5, sets: [{ repetitionCount: 12 }] }
    ]
  });

  const payload = mapWorkoutLogToApiPayload(workout, input);
  assert.equal(payload.workout_exercise_logs[0]?.workout_exercise_id, 100);
  assert.equal(payload.workout_exercise_logs[1]?.workout_exercise_id, 101);
});

test("mapWorkoutLogToApiPayload rejects an exercise not present in the workout", () => {
  const input = workoutLogInputSchema.parse({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{ exerciseId: 999, sets: [{ repetitionCount: 10 }] }]
  });

  assert.throws(() => mapWorkoutLogToApiPayload(sampleWorkout(), input), /Exercise 999 was not found in workout 131/);
});

test("mapWorkoutLogToApiPayload rejects a workout ID mismatch", () => {
  const input = workoutLogInputSchema.parse({
    workoutId: 999,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{ exerciseId: 59, sets: [{ repetitionCount: 10 }] }]
  });

  assert.throws(() => mapWorkoutLogToApiPayload(sampleWorkout(), input), /does not match the requested workout/);
});

test("mapWorkoutLogToApiPayload rejects a non-object workout", () => {
  const input = workoutLogInputSchema.parse({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{ exerciseId: 59, sets: [{ repetitionCount: 10 }] }]
  });

  assert.throws(() => mapWorkoutLogToApiPayload(null, input), /invalid workout/);
});

test("mapWorkoutLogToApiPayload rejects a workout exercise missing its exercise reference", () => {
  const workout = {
    id: 131,
    supersets: [{ id: 1, workout_exercises: [{ id: 10957, order_in_workout: 1, exercise: null }] }]
  };
  const input = workoutLogInputSchema.parse({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{ exerciseId: 59, sets: [{ repetitionCount: 10 }] }]
  });

  assert.throws(() => mapWorkoutLogToApiPayload(workout, input), /exercise reference/);
});

test("mapWorkoutLogToApiPayload allows overriding per-set timestamps", () => {
  const input = workoutLogInputSchema.parse({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{
      exerciseId: 59,
      sets: [{ repetitionCount: 15, startedAt: "2026-08-31 10:32:33", finishedAt: "2026-08-31 10:32:40" }]
    }]
  });

  const payload = mapWorkoutLogToApiPayload(sampleWorkout(), input);
  assert.equal(payload.workout_exercise_logs[0]?.started_at, "2026-08-31 10:32:33");
  assert.equal(payload.workout_exercise_logs[0]?.finished_at, "2026-08-31 10:32:40");
});
