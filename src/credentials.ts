import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CREDENTIALS_FILE = join(homedir(), ".config", "caliverse-mcp", "credentials.json");

interface StoredCredentials {
  refreshToken: string;
}

export function credentialsPath(): string {
  return CREDENTIALS_FILE;
}

export async function saveRefreshToken(refreshToken: string): Promise<void> {
  if (refreshToken.length === 0) {
    throw new Error("Refusing to save an empty refresh token.");
  }

  const directory = dirname(CREDENTIALS_FILE);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(CREDENTIALS_FILE, `${JSON.stringify({ refreshToken })}\n`, { mode: 0o600 });
  // writeFile's mode only applies to newly created files; repair pre-existing files too.
  await chmod(CREDENTIALS_FILE, 0o600);
}

export async function loadRefreshToken(): Promise<string> {
  const environmentToken = process.env.CALIVERSE_REFRESH_TOKEN;
  if (environmentToken !== undefined && environmentToken.length > 0) {
    return environmentToken;
  }

  let metadata;
  try {
    metadata = await stat(CREDENTIALS_FILE);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new Error("No Caliverse credentials found. Run `pnpm login` first.");
    }
    throw error;
  }

  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Credentials file ${CREDENTIALS_FILE} is accessible to other users. Set its mode to 0600.`);
  }

  let credentials: unknown;
  try {
    credentials = JSON.parse(await readFile(CREDENTIALS_FILE, "utf8"));
  } catch {
    throw new Error(`Credentials file ${CREDENTIALS_FILE} is invalid JSON.`);
  }

  if (
    typeof credentials !== "object" ||
    credentials === null ||
    !("refreshToken" in credentials) ||
    typeof (credentials as StoredCredentials).refreshToken !== "string" ||
    (credentials as StoredCredentials).refreshToken.length === 0
  ) {
    throw new Error(`Credentials file ${CREDENTIALS_FILE} does not contain a refresh token.`);
  }
  return (credentials as StoredCredentials).refreshToken;
}
