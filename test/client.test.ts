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
