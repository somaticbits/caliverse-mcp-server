import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackAddress, loginPage, startGoogleLogin } from "../scripts/google-login.js";

test("Google login page pins Firebase browser scripts with SRI", () => {
  const page = loginPage("nonce-value");
  assert.match(page, /content="nonce-value"/);
  assert.match(page, /firebase-app-compat\.js" integrity="sha384-/);
  assert.match(page, /firebase-auth-compat\.js" integrity="sha384-/);
  assert.doesNotMatch(page, /<script[^>]*>(?!<\/script>)/);
});

test("loopback filter accepts only local addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.2"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test("Google callback accepts a nonce-bound refresh token over loopback", async () => {
  let localUrl = "";
  let savedToken = "";
  let provideUrl: ((url: string) => void) | undefined;
  const urlReady = new Promise<string>((resolve) => { provideUrl = resolve; });
  const loginComplete = startGoogleLogin({
    openBrowser: () => {},
    onUrl: (url) => provideUrl?.(url),
    persistRefreshToken: async (token) => { savedToken = token; },
    timeoutMs: 5_000
  });

  localUrl = await urlReady;
  const pageResponse = await fetch(localUrl);
  const page = await pageResponse.text();
  const nonce = /name="caliverse-login-nonce" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(nonce);
  assert.match(pageResponse.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.equal(pageResponse.headers.get("cache-control"), "no-store");

  const response = await fetch(`${localUrl}token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, refreshToken: "test-refresh-token" })
  });
  assert.equal(response.status, 204);
  await loginComplete;
  assert.equal(savedToken, "test-refresh-token");
});
