import assert from "node:assert/strict";
import test from "node:test";
import { AuthenticationError, TokenManager, refreshSession, signInWithPassword } from "../src/auth.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("signInWithPassword sends Firebase's expected body and maps its response", async () => {
  let request: { url: string; init: RequestInit | undefined } | undefined;
  const session = await signInWithPassword("user@example.com", "do-not-log", async (url, init) => {
    request = { url, init };
    return jsonResponse({ idToken: "id-token", refreshToken: "refresh-token", expiresIn: "3600" });
  }, () => 1_000);

  assert.match(request?.url ?? "", /accounts:signInWithPassword/);
  assert.equal(request?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), {
    email: "user@example.com",
    password: "do-not-log",
    returnSecureToken: true
  });
  assert.deepEqual(session, { idToken: "id-token", refreshToken: "refresh-token", expiresAt: 3_601_000 });
});

test("refreshSession rejects malformed and failed Firebase responses", async () => {
  await assert.rejects(
    refreshSession("refresh", async () => jsonResponse({ error: { message: "INVALID" } }, 400)),
    AuthenticationError
  );
  await assert.rejects(
    refreshSession("refresh", async () => jsonResponse({ id_token: "id" })),
    /refresh_token/
  );
});

test("TokenManager caches a valid token and refreshes before expiry", async () => {
  let calls = 0;
  let time = 0;
  const manager = new TokenManager("initial", async () => {
    calls += 1;
    return jsonResponse({ id_token: `token-${calls}`, refresh_token: `refresh-${calls}`, expires_in: "120" });
  }, () => time);

  assert.equal(await manager.getIdToken(), "token-1");
  assert.equal(await manager.getIdToken(), "token-1");
  time = 61_000;
  assert.equal(await manager.getIdToken(), "token-2");
  assert.equal(manager.getRefreshToken(), "refresh-2");
  assert.equal(calls, 2);
});

test("TokenManager persists a rotated refresh token without disrupting requests", async () => {
  const persisted: string[] = [];
  const manager = new TokenManager(
    "initial",
    async () => jsonResponse({ id_token: "token", refresh_token: "rotated", expires_in: "120" }),
    () => 0,
    async (refreshToken) => {
      persisted.push(refreshToken);
      throw new Error("disk unavailable");
    }
  );

  assert.equal(await manager.getIdToken(), "token");
  assert.deepEqual(persisted, ["rotated"]);
});

test("TokenManager does not persist an unchanged refresh token", async () => {
  let persisted = false;
  const manager = new TokenManager(
    "unchanged",
    async () => jsonResponse({ id_token: "token", refresh_token: "unchanged", expires_in: "120" }),
    () => 0,
    () => {
      persisted = true;
    }
  );

  await manager.getIdToken();
  assert.equal(persisted, false);
});
