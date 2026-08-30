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
