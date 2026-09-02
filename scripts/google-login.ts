import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { FIREBASE_API_KEY, refreshSession } from "../src/auth.js";
import { saveRefreshToken } from "../src/credentials.js";

const FIREBASE_APP_SRI = "sha384-HLJUgAQ2oo6rdMC4QW+Oz2qQfPOtu/lzncKG4sZiq8+2W9uOa3K0b3UGpckKqv7H";
const FIREBASE_AUTH_SRI = "sha384-+/4lqMnmLqwbdHXshvGDmBTeWlNoPRdjXi4ZsiBj10EhQXaTBe3RF5JZktdSjug6";
const FIREBASE_SDK_VERSION = "9.22.2";
const MAX_REQUEST_BODY_BYTES = 8_192;
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface GoogleLoginOptions {
  openBrowser?: (url: string) => void;
  persistRefreshToken?: (refreshToken: string) => Promise<void>;
  onUrl?: (url: string) => void;
  timeoutMs?: number;
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function isValidLoopbackHost(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function loginPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="caliverse-login-nonce" content="${nonce}">
  <title>Caliverse Google Login</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
<main class="card">
  <p class="wordmark">Caliverse</p>
  <p class="eyebrow">MCP local login</p>
  <h1>Sign in</h1>
  <p class="lede">Use the Google account linked to your Caliverse account.</p>
  <button id="sign-in" type="button" class="google-btn">
    <svg class="google-icon" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.85 2.09-1.81 2.73v2.26h2.92c1.7-1.57 2.69-3.88 2.69-6.63z"/>
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.71H.95v2.33C2.44 15.98 5.48 18 9 18z"/>
      <path fill="#FBBC05" d="M3.97 10.71c-.18-.54-.28-1.11-.28-1.71s.1-1.17.28-1.71V4.96H.95A8.96 8.96 0 0 0 0 9c0 1.45.35 2.83.95 4.04l3.02-2.33z"/>
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.95 4.96l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>
    </svg>
    <span>Sign in with Google</span>
  </button>
  <p id="status" class="status" role="status" aria-live="polite"></p>
  <p class="fine-print">Runs only on this machine. Closes automatically once you're signed in, or after five minutes.</p>
</main>
<script src="https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js" integrity="${FIREBASE_APP_SRI}" crossorigin="anonymous"></script>
<script src="https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js" integrity="${FIREBASE_AUTH_SRI}" crossorigin="anonymous"></script>
<script src="/app.js"></script>
</body></html>`;
}

export function loginStyles(): string {
  return `:root {
  color-scheme: light;
  --cv-teal: #5bc0be;
  --cv-teal-hover: #80cecd;
  --cv-teal-dark: #40a8a6;
  --cv-navy: #1c2541;
  --cv-navy-slate: #3a506b;
  --cv-ink: #232323;
  --cv-body: #404040;
  --cv-muted: #9a9a9a;
  --cv-border: #e1e1e1;
  --cv-danger: #fd585c;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
}
body {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: linear-gradient(180deg, var(--cv-navy) 0%, var(--cv-navy-slate) 100%);
  font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  color: var(--cv-body);
}
.card {
  width: 100%;
  max-width: 380px;
  background: #fff;
  border-radius: 16px;
  padding: 40px 32px 32px;
  text-align: center;
  box-shadow: 0 24px 60px -20px rgba(11, 19, 43, 0.45);
}
.wordmark {
  margin: 0;
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--cv-teal-dark);
}
.eyebrow {
  margin: 4px 0 24px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--cv-muted);
}
h1 {
  margin: 0 0 8px;
  font-size: 24px;
  font-weight: 900;
  color: var(--cv-ink);
}
.lede {
  margin: 0 0 28px;
  font-size: 15px;
  line-height: 1.5;
  color: var(--cv-body);
}
.google-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  height: 48px;
  padding: 0 20px;
  background: #fff;
  border: 1px solid #0a0a0a;
  border-radius: 6px;
  color: var(--cv-ink);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background-color 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
}
.google-btn:hover:not(:disabled) {
  background-color: #f7f7f7;
}
.google-btn:focus-visible {
  outline: 2px solid var(--cv-teal);
  outline-offset: 2px;
}
.google-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.google-icon {
  width: 18px;
  height: 18px;
  flex: none;
}
.status {
  min-height: 20px;
  margin: 20px 0 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--cv-muted);
}
.status.is-pending {
  color: var(--cv-navy-slate);
}
.status.is-done {
  color: var(--cv-teal-dark);
}
.status.is-error {
  color: var(--cv-danger);
}
.fine-print {
  margin: 24px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--cv-muted);
}
`;
}

export function loginScript(): string {
  return `(() => {
  const status = document.getElementById("status");
  const signInButton = document.getElementById("sign-in");
  const nonce = document.querySelector('meta[name="caliverse-login-nonce"]').content;
  const config = {
    apiKey: "${FIREBASE_API_KEY}",
    authDomain: "calisthenics-hannibal-firebase.firebaseapp.com",
    projectId: "calisthenics-hannibal-firebase"
  };
  firebase.initializeApp(config);
  const auth = firebase.auth();
  const setStatus = (text, state) => {
    status.textContent = text;
    status.classList.remove("is-pending", "is-done", "is-error");
    if (state) status.classList.add(state);
  };
  const fail = (error) => {
    signInButton.disabled = false;
    setStatus("Google login failed: " + error.message, "is-error");
  };
  signInButton.addEventListener("click", async () => {
    signInButton.disabled = true;
    setStatus("Opening Google sign-in...", "is-pending");
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope("email");
    const result = await auth.signInWithPopup(provider);
    const response = await fetch("/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, refreshToken: result.user.refreshToken })
    });
    if (!response.ok) throw new Error(await response.text());
    signInButton.hidden = true;
    setStatus("Caliverse login complete. You may close this tab.", "is-done");
  }).catch(fail);
})();`;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'self' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://calisthenics-hannibal-firebase.firebaseapp.com; frame-src https://calisthenics-hannibal-firebase.firebaseapp.com https://accounts.google.com; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cache-control", "no-store");
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BODY_BYTES) {
        reject(new Error("Request body exceeds the allowed size."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Request body is not valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function defaultOpenBrowser(url: string): void {
  if (process.platform === "darwin") {
    spawn("open", [url], { stdio: "ignore", detached: true }).unref();
    return;
  }
  process.stderr.write(`Open this URL in a browser: ${url}\n`);
}

export async function startGoogleLogin(options: GoogleLoginOptions = {}): Promise<void> {
  const nonce = randomBytes(32).toString("base64url");
  const persistRefreshToken = options.persistRefreshToken ?? (async (token: string) => {
    // Validate before persistence, and persist Firebase's newly rotated refresh token.
    const session = await refreshSession(token);
    await saveRefreshToken(session.refreshToken);
  });
  const openBrowser = options.openBrowser ?? defaultOpenBrowser;
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;

  return new Promise((resolveLogin, rejectLogin) => {
    let completed = false;
    let boundPort: number | undefined;
    const finish = (error?: Error): void => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      server.close(() => error === undefined ? resolveLogin() : rejectLogin(error));
    };
    const server = createServer((request, response) => {
      setSecurityHeaders(response);
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        response.writeHead(403).end("Loopback requests only.");
        return;
      }
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      // Firebase's redirect result can add query parameters to this root URL.
      if (request.method === "GET" && path === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(loginPage(nonce));
        return;
      }
      if (request.method === "GET" && path === "/app.js") {
        response.writeHead(200, { "content-type": "application/javascript; charset=utf-8" }).end(loginScript());
        return;
      }
      if (request.method === "GET" && path === "/app.css") {
        response.writeHead(200, { "content-type": "text/css; charset=utf-8" }).end(loginStyles());
        return;
      }
      if (request.method === "POST" && path === "/token") {
        if (boundPort === undefined || !isValidLoopbackHost(request.headers.host, boundPort)) {
          response.writeHead(400).end("Invalid Host header.");
          return;
        }
        void readJsonBody(request).then(async (body) => {
          if (
            typeof body !== "object" || body === null ||
            (body as { nonce?: unknown }).nonce !== nonce ||
            typeof (body as { refreshToken?: unknown }).refreshToken !== "string" ||
            (body as { refreshToken: string }).refreshToken.length === 0
          ) {
            response.writeHead(400).end("Invalid local login response.");
            return;
          }
          try {
            await persistRefreshToken((body as { refreshToken: string }).refreshToken);
            response.writeHead(204).end();
            finish();
          } catch {
            response.writeHead(502).end("Could not validate the Firebase login response.");
          }
        }).catch(() => response.writeHead(400).end("Invalid local login response."));
        return;
      }
      response.writeHead(404).end("Not found.");
    });
    const timeout = setTimeout(() => finish(new Error("Google login timed out after five minutes.")), timeoutMs);
    server.once("error", (error) => finish(error));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        finish(new Error("Could not determine the local Google login URL."));
        return;
      }
      boundPort = address.port;
      const url = `http://127.0.0.1:${boundPort}/`;
      options.onUrl?.(url);
      process.stderr.write(`Opening secure local Google login at ${url}\n`);
      openBrowser(url);
    });
  });
}

async function main(): Promise<void> {
  await startGoogleLogin();
  process.stderr.write("Caliverse Google login complete.\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown Google login error.";
    process.stderr.write(`Google login failed: ${message}\n`);
    process.exitCode = 1;
  });
}
