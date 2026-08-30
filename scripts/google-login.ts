import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { refreshSession } from "../src/auth.js";
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

export function loginPage(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="caliverse-login-nonce" content="${nonce}">
  <title>Caliverse Google Login</title>
</head>
<body>
<p id="status">Sign in with the Google account linked to Caliverse.</p>
<button id="sign-in" type="button">Sign in with Google</button>
<script src="https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js" integrity="${FIREBASE_APP_SRI}" crossorigin="anonymous"></script>
<script src="https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js" integrity="${FIREBASE_AUTH_SRI}" crossorigin="anonymous"></script>
<script src="/app.js"></script>
</body></html>`;
}

export function loginScript(): string {
  return `(() => {
  const status = document.getElementById("status");
  const signInButton = document.getElementById("sign-in");
  const nonce = document.querySelector('meta[name="caliverse-login-nonce"]').content;
  const config = {
    apiKey: "REDACTED_FIREBASE_WEB_API_KEY",
    authDomain: "calisthenics-hannibal-firebase.firebaseapp.com",
    projectId: "calisthenics-hannibal-firebase"
  };
  firebase.initializeApp(config);
  const auth = firebase.auth();
  const fail = (error) => {
    signInButton.disabled = false;
    status.textContent = "Google login failed: " + error.message;
  };
  signInButton.addEventListener("click", async () => {
    signInButton.disabled = true;
    status.textContent = "Opening Google sign-in...";
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.addScope("email");
    const result = await auth.signInWithPopup(provider);
    const response = await fetch("/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, refreshToken: result.user.refreshToken })
    });
    if (!response.ok) throw new Error(await response.text());
    status.textContent = "Caliverse login complete. You may close this tab.";
  }).catch(fail);
})();`;
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'none'; script-src 'self' https://www.gstatic.com https://apis.google.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://calisthenics-hannibal-firebase.firebaseapp.com; frame-src https://calisthenics-hannibal-firebase.firebaseapp.com https://accounts.google.com; style-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
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
      if (request.method === "POST" && path === "/token") {
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
    server.listen(0, "localhost", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        finish(new Error("Could not determine the local Google login URL."));
        return;
      }
      const url = `http://localhost:${address.port}/`;
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
