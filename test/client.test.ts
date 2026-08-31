import assert from "node:assert/strict";
import test from "node:test";
import { CaliverseApi, CaliverseApiError, type TokenProvider } from "../src/client.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("CaliverseApi retries once with a refreshed token after a 401", async () => {
  const refreshCalls: boolean[] = [];
  const tokenProvider: TokenProvider = {
    async getIdToken(forceRefresh = false) {
      refreshCalls.push(forceRefresh);
      return forceRefresh ? "new-token" : "old-token";
    }
  };
  const requests: RequestInit[] = [];
  const responses = [jsonResponse({ message: "Unauthorized" }, 401), jsonResponse([{ id: 1, title: "Push-up" }])];
  const api = new CaliverseApi({
    tokenManager: tokenProvider,
    fetchImpl: async (_url, init) => {
      requests.push(init ?? {});
      const response = responses.shift();
      assert.ok(response, "unexpected request");
      return response;
    }
  });

  assert.deepEqual(await api.listExercises(), [{ id: 1, title: "Push-up" }]);
  assert.deepEqual(refreshCalls, [false, true]);
  assert.equal(new Headers(requests[0]?.headers).get("X-USER-ID-TOKEN"), "old-token");
  assert.equal(new Headers(requests[1]?.headers).get("X-USER-ID-TOKEN"), "new-token");
});

test("CaliverseApi caches exercises but clears the cache after a failed request", async () => {
  let calls = 0;
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async () => {
      calls += 1;
      return calls === 1 ? jsonResponse({ message: "temporary failure" }, 500) : jsonResponse([{ id: 1 }]);
    }
  });

  await assert.rejects(api.listExercises(), CaliverseApiError);
  assert.deepEqual(await api.listExercises(), [{ id: 1 }]);
  assert.deepEqual(await api.listExercises(), [{ id: 1 }]);
  assert.equal(calls, 2);
});

test("createWorkout assigns an empty category list to clear categories", async () => {
  const requests: RequestInit[] = [];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (_url, init) => {
      requests.push(init ?? {});
      return requests.length === 1 ? jsonResponse({ id: 30 }) : jsonResponse({}, 201);
    }
  });

  await api.createWorkout({
    title: "Category test",
    isPublic: false,
    isPro: false,
    lengthInMinutes: 5,
    level: "beginner",
    groupIds: [],
    categoryIds: [],
    supersets: [{
      restBetweenCycles: 0,
      orderInWorkout: 1,
      title: "",
      exercises: [{
        exerciseId: 1,
        setCount: 1,
        repetitionCount: 1,
        repetitionType: "count",
        orderInWorkout: 1,
        restTimeBeforeExercise: 0
      }]
    }]
  });

  assert.equal(requests.length, 2);
  assert.equal(new URLSearchParams(String(requests[1]?.body)).get("workout_id"), "30");
});

test("plan reads use the extended timeout", async () => {
  let signal: AbortSignal | undefined;
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (_url, init) => {
      signal = init?.signal as AbortSignal;
      return jsonResponse([]);
    }
  });

  await api.listPlans();
  assert.ok(signal);
  assert.equal(signal.aborted, false);
});

test("CaliverseApi bounds API error content and preserves status", async () => {
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async () => new Response("x".repeat(2_000), { status: 500 })
  });

  await assert.rejects(api.listMyWorkouts(), (error: unknown) => {
    assert.ok(error instanceof CaliverseApiError);
    assert.equal(error.status, 500);
    assert.ok(error.message.length < 1_200);
    return true;
  });
});

test("read-only progress and coaching methods call the expected endpoints", async () => {
  const requests: string[] = [];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (url) => { requests.push(url); return jsonResponse({}); }
  });

  await api.listMuscleGroups();
  await api.getProgressSignals();
  await api.getMyDay("2026-08-31");
  await api.getScheduleCalendar("2026-08-01", "2026-08-31");
  await api.getCoachProfile();
  await api.getCoachToday();
  await api.getCoachHistory("2026-08-30", "2026-08-30");
  await api.getActivePlan();
  await api.getProgressionTree(250);
  await api.getMyWorkoutRating(131);
  await api.listFavoriteWorkouts();
  await api.getLogFeedbackOptions();

  assert.deepEqual(requests, [
    "https://www.caliverse.app/api/v1/muscle-groups",
    "https://www.caliverse.app/api/v1/ai-coach/today/progress-signals",
    "https://www.caliverse.app/api/v1/users/me/my-day?date=2026-08-31",
    "https://www.caliverse.app/api/v1/workouts/schedules/calendar?date_from=2026-08-01&date_to=2026-08-31",
    "https://www.caliverse.app/api/v1/ai-coach/profile",
    "https://www.caliverse.app/api/v1/ai-coach/today",
    "https://www.caliverse.app/api/v1/ai-coach/history?from=2026-08-30&to=2026-08-30",
    "https://www.caliverse.app/api/v1/workouts/plans/mine/active",
    "https://www.caliverse.app/api/v1/exercises/250/progression-tree",
    "https://www.caliverse.app/api/v1/workouts/131/rating",
    "https://www.caliverse.app/api/v1/workouts/favorite",
    "https://www.caliverse.app/api/v1/workouts/log/feedback/options"
  ]);
});

test("getExercisePrs scans an inclusive range and returns only the aggregate", async () => {
  const requests: string[] = [];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (url) => {
      requests.push(url);
      const date = new URL(url).searchParams.get("date");
      return jsonResponse({
        finishedWorkoutLogs: [{
          workout_exercise_logs: [{
            repetition_count: date === "2026-08-31" ? 12 : 8,
            added_weight: 0,
            added_weight_unit: 1,
            finished_at: `${date}T10:00:00Z`,
            workout_exercise: { repetition_type: "count", exercise: { id: 50, title: "Jump Squat" } }
          }]
        }]
      });
    }
  });

  const result = await api.getExercisePrs("2026-08-30", "2026-08-31");

  assert.deepEqual(requests.sort(), [
    "https://www.caliverse.app/api/v1/users/me/my-day?date=2026-08-30",
    "https://www.caliverse.app/api/v1/users/me/my-day?date=2026-08-31"
  ]);
  assert.deepEqual(result, {
    from: "2026-08-30",
    to: "2026-08-31",
    daysScanned: 2,
    exercises: [{
      exerciseId: 50,
      title: "Jump Squat",
      repetitionType: "count",
      maxReps: 12,
      maxRepsAt: "2026-08-31T10:00:00Z",
      maxAddedWeightKg: 0,
      maxWeightAt: "2026-08-30T10:00:00Z",
      lastPerformedAt: "2026-08-31T10:00:00Z",
      sessionCount: 2,
      setCount: 2
    }],
    warnings: { skippedMissingExerciseReference: 0, skippedNonKgWeightLogs: 0 }
  });
});

test("getExercisePrs rejects invalid, reversed, and oversized ranges before fetching", async () => {
  let requests = 0;
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async () => { requests += 1; return jsonResponse({}); }
  });

  await assert.rejects(api.getExercisePrs("2026-02-30", "2026-03-01"), /not a valid/);
  await assert.rejects(api.getExercisePrs("2026-09-01", "2026-08-31"), /start date/);
  await assert.rejects(api.getExercisePrs("2026-01-01", "2026-05-01"), /limited to 120 days/);
  assert.equal(requests, 0);
});

test("logWorkoutCompletion fetches the workout, maps it, and POSTs JSON", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (requests.length === 1) {
        return jsonResponse({
          id: 131,
          supersets: [{
            id: 1,
            workout_exercises: [{ id: 10957, order_in_workout: 1, exercise: { id: 59 } }]
          }]
        });
      }
      return jsonResponse({ id: 621939 }, 201);
    }
  });

  const result = await api.logWorkoutCompletion({
    workoutId: 131,
    startedAt: "2026-08-31 10:32:33",
    finishedAt: "2026-08-31 10:33:06",
    exercises: [{ exerciseId: 59, sets: [{ repetitionCount: 15, addedWeightKg: 0, restSecondsBefore: 0 }] }]
  });

  assert.deepEqual(result, { id: 621939 });
  assert.equal(requests.length, 2);
  assert.match(requests[0]?.url ?? "", /\/workouts\/131$/);
  assert.match(requests[1]?.url ?? "", /\/workouts\/log\/finish-with-exercises$/);
  assert.equal(new Headers(requests[1]?.init?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    workout_id: 131,
    started_at: "2026-08-31 10:32:33",
    finished_at: "2026-08-31 10:33:06",
    workout_exercise_logs: [{
      order_in_workout: 1,
      started_at: "2026-08-31 10:32:33",
      finished_at: "2026-08-31 10:33:06",
      rest_seconds_before: 0,
      repetition_count: 15,
      added_weight: 0,
      added_weight_unit: 1,
      set_in_exercise: 1,
      workout_exercise_id: 10957
    }]
  });
});

test("deleteWorkoutLog issues a DELETE to the log endpoint", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (url, init) => { requests.push({ url, init }); return jsonResponse(null); }
  });

  await api.deleteWorkoutLog(621939);
  assert.match(requests[0]?.url ?? "", /\/workouts\/log\/621939$/);
  assert.equal(requests[0]?.init?.method, "DELETE");
});

test("cloneWorkout converts the read shape into the write payload", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const responses = [
    jsonResponse({
      id: 12,
      title: "Source",
      private_title: "Private source",
      is_public: 1,
      is_pro: 1,
      length_in_minutes: 30,
      level: "beginner",
      groups: [{ id: 4 }],
      workout_categories: [{ id: 9 }],
      supersets: [{
        id: 7,
        rest_between_cycles: 60,
        order_in_workout: 1,
        title: "A",
        workout_exercises: [{
          exercise: { id: 42 },
          set_count: 3,
          repetition_count: 8,
          repetition_type: "count",
          order_in_workout: 1,
          rest_time_before_exercise: 0
        }]
      }]
    }),
    jsonResponse({ id: 25 }),
    jsonResponse({ ok: true }, 201)
  ];
  const api = new CaliverseApi({
    tokenManager: { async getIdToken() { return "token"; } },
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      const response = responses.shift();
      assert.ok(response, "unexpected request");
      return response;
    }
  });

  await api.cloneWorkout(12, "Clone");

  assert.match(requests[1]?.url ?? "", /workouts\/with-supersets$/);
  const body = new URLSearchParams(String(requests[1]?.init?.body));
  assert.equal(body.get("title"), "Clone");
  assert.equal(body.get("workout_id"), "");
  assert.equal(body.get("workout_supersets[0][workout_exercises][0][exercise_id]"), "42");
  assert.match(requests[2]?.url ?? "", /workouts\/categories\/assign$/);
});
