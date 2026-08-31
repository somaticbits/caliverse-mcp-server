export const FIREBASE_API_KEY = "REDACTED_FIREBASE_WEB_API_KEY";
const FIREBASE_SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`;
const FIREBASE_REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`;
const EXPIRY_SKEW_MS = 60_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AuthSession {
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface FirebaseSignInResponse {
  idToken?: unknown;
  refreshToken?: unknown;
  expiresIn?: unknown;
}

interface FirebaseRefreshResponse {
  id_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
}

export class AuthenticationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AuthenticationError(`Authentication service returned invalid JSON (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const message = typeof parsed === "object" && parsed !== null && "error" in parsed
      ? JSON.stringify((parsed as { error: unknown }).error).slice(0, 500)
      : "Unknown authentication error";
    throw new AuthenticationError(`Authentication failed (HTTP ${response.status}): ${message}`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new AuthenticationError("Authentication service returned an unexpected response.");
  }
  return parsed as Record<string, unknown>;
}

function toExpiry(expiresIn: unknown, now: () => number): number {
  const seconds = typeof expiresIn === "string" ? Number(expiresIn) : expiresIn;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    throw new AuthenticationError("Authentication response did not include a valid expiry.");
  }
  return now() + (seconds * 1_000);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new AuthenticationError(`Authentication response did not include ${field}.`);
  }
  return value;
}

export async function signInWithPassword(
  email: string,
  password: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now
): Promise<AuthSession> {
  const response = await fetchImpl(FIREBASE_SIGN_IN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await parseJson(response) as FirebaseSignInResponse;
  return {
    idToken: requireString(body.idToken, "idToken"),
    refreshToken: requireString(body.refreshToken, "refreshToken"),
    expiresAt: toExpiry(body.expiresIn, now)
  };
}

export async function refreshSession(
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now
): Promise<AuthSession> {
  const response = await fetchImpl(FIREBASE_REFRESH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    signal: AbortSignal.timeout(15_000)
  });
  const body = await parseJson(response) as FirebaseRefreshResponse;
  return {
    idToken: requireString(body.id_token, "id_token"),
    refreshToken: requireString(body.refresh_token, "refresh_token"),
    expiresAt: toExpiry(body.expires_in, now)
  };
}

export class TokenManager {
  private session: AuthSession | undefined;
  private refreshInFlight: Promise<AuthSession> | undefined;

  public constructor(
    private refreshToken: string,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly now: () => number = Date.now,
    private readonly onRefreshToken?: (refreshToken: string) => void | Promise<void>
  ) {}

  public async getIdToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.session !== undefined && this.session.expiresAt - EXPIRY_SKEW_MS > this.now()) {
      return this.session.idToken;
    }

    const previousRefreshToken = this.refreshToken;
    this.refreshInFlight ??= refreshSession(previousRefreshToken, this.fetchImpl, this.now)
      .then(async (session) => {
        this.session = session;
        this.refreshToken = session.refreshToken;
        if (this.refreshToken !== previousRefreshToken && this.onRefreshToken !== undefined) {
          try {
            await this.onRefreshToken(this.refreshToken);
          } catch {
            // Token persistence must not interrupt an otherwise valid API request.
          }
        }
        return session;
      })
      .finally(() => {
        this.refreshInFlight = undefined;
      });
    return (await this.refreshInFlight).idToken;
  }

  public getRefreshToken(): string {
    return this.refreshToken;
  }
}
