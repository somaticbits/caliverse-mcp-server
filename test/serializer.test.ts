import assert from "node:assert/strict";
import test from "node:test";
import { toFormBody } from "../src/serializer.js";
import { toApiWorkoutPayload, workoutInputSchema } from "../src/types.js";

test("toFormBody serializes nested arrays with PHP bracket notation", () => {
  const body = toFormBody({
    title: "Upper Body & Core",
    workout_group_ids: [4, 8],
    workout_supersets: [{
      title: "Pull",
      workout_exercises: [{ exercise_id: 42, set_count: 3 }]
    }],
    ignored: undefined,
    null_value: null
  });
  const params = new URLSearchParams(body);

  assert.equal(params.get("title"), "Upper Body & Core");
  assert.equal(params.get("workout_group_ids[0]"), "4");
  assert.equal(params.get("workout_group_ids[1]"), "8");
  assert.equal(params.get("workout_supersets[0][title]"), "Pull");
  assert.equal(params.get("workout_supersets[0][workout_exercises][0][exercise_id]"), "42");
  assert.equal(params.get("ignored"), null);
  assert.equal(params.get("null_value"), "");
});

test("workout payload maps friendly names to Caliverse API names", () => {
  const workout = workoutInputSchema.parse({
    title: "Test workout",
    privateTitle: "Private",
    isPublic: false,
    isPro: false,
    lengthInMinutes: 30,
    level: "beginner",
    groupIds: [3],
    categoryIds: [],
    supersets: [{
      restBetweenCycles: 60,
      orderInWorkout: 1,
      title: "A",
      exercises: [{
        exerciseId: 99,
        setCount: 3,
        repetitionCount: 8,
        repetitionType: "count",
        orderInWorkout: 1,
        restTimeBeforeExercise: 0
      }]
    }]
  });

  assert.deepEqual(toApiWorkoutPayload(workout, null), {
    workout_id: null,
    title: "Test workout",
    private_title: "Private",
    is_public: 0,
    is_pro: 0,
    length_in_minutes: 30,
    level: "beginner",
    warmup_workout_id: null,
    cooldown_workout_id: null,
    image_url: null,
    image_file: null,
    workout_group_ids: [3],
    workout_supersets: [{
      superset_id: null,
      rest_between_cycles: 60,
      order_in_workout: 1,
      title: "A",
      workout_exercises: [{
        exercise_id: 99,
        set_count: 3,
        repetition_count: 8,
        repetition_type: "count",
        order_in_workout: 1,
        rest_time_before_exercise: 0
      }]
    }]
  });
});
