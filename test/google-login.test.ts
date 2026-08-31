import assert from "node:assert/strict";
import test from "node:test";
import { isLoopbackAddress, isValidLoopbackHost, loginPage, loginScript, loginStyles, startGoogleLogin } from "../scripts/google-login.js";

test("Google login page pins Firebase browser scripts with SRI", () => {
  const page = loginPage("nonce-value");
  assert.match(page, /content="nonce-value"/);
  assert.match(page, /id="sign-in"/);
  assert.match(page, /id="status"/);
  assert.match(page, /firebase-app-compat\.js" integrity="sha384-/);
  assert.match(page, /firebase-auth-compat\.js" integrity="sha384-/);
  assert.doesNotMatch(page, /<script[^>]*>(?!<\/script>)/);
  assert.doesNotMatch(page, /<style[^>]*>/);
  assert.doesNotMatch(page, / style="/);
  assert.match(page, /<link rel="stylesheet" href="\/app\.css">/);
  assert.match(loginScript(), /signInWithPopup/);
  assert.match(loginStyles(), /#5bc0be/);
});

test("loopback filter accepts only local addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.2"), false);
  assert.equal(isLoopbackAddress(undefined), false);
});

test("loopback Host filter accepts only the bound local port", () => {
  assert.equal(isValidLoopbackHost("127.0.0.1:8080", 8080), true);
  assert.equal(isValidLoopbackHost("localhost:8080", 8080), true);
  assert.equal(isValidLoopbackHost("127.0.0.1:8081", 8080), false);
  assert.equal(isValidLoopbackHost("evil.example:8080", 8080), false);
  assert.equal(isValidLoopbackHost(undefined, 8080), false);
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
  assert.match(localUrl, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const pageResponse = await fetch(localUrl);
  const page = await pageResponse.text();
  const nonce = /name="caliverse-login-nonce" content="([^"]+)"/.exec(page)?.[1];
  assert.ok(nonce);
  const csp = pageResponse.headers.get("content-security-policy") ?? "";
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self' https:\/\/www\.gstatic\.com https:\/\/apis\.google\.com/);
  assert.match(csp, /frame-src https:\/\/calisthenics-hannibal-firebase\.firebaseapp\.com/);
  assert.match(csp, /frame-src [^;]*https:\/\/accounts\.google\.com/);
  assert.match(csp, /connect-src 'self' https:\/\/identitytoolkit\.googleapis\.com/);
  assert.match(csp, /style-src 'self'/);
  assert.equal(pageResponse.headers.get("cache-control"), "no-store");

  const cssResponse = await fetch(`${localUrl}app.css`);
  assert.equal(cssResponse.status, 200);
  assert.match(cssResponse.headers.get("content-type") ?? "", /text\/css/);

  const redirectPageResponse = await fetch(`${localUrl}?firebase-event=example`);
  assert.equal(redirectPageResponse.status, 200);

  const response = await fetch(`${localUrl}token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ nonce, refreshToken: "test-refresh-token" })
  });
  assert.equal(response.status, 204);
  await loginComplete;
  assert.equal(savedToken, "test-refresh-token");
});
