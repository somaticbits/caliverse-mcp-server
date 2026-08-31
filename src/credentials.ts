import { chmod, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CREDENTIALS_FILE = join(homedir(), ".config", "caliverse-mcp", "credentials.json");

interface StoredCredentials {
  refreshToken: string;
}

export interface LoadedRefreshToken {
  refreshToken: string;
  source: "environment" | "file";
}

export function credentialsPath(): string {
  return CREDENTIALS_FILE;
}

export async function saveRefreshToken(refreshToken: string, file = CREDENTIALS_FILE): Promise<void> {
  if (refreshToken.length === 0) {
    throw new Error("Refusing to save an empty refresh token.");
  }

  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const temporaryFile = `${file}.${randomBytes(16).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryFile, `${JSON.stringify({ refreshToken })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(temporaryFile, 0o600);
    await rename(temporaryFile, file);
    // rename retains the temporary file mode, but enforce it after replacement too.
    await chmod(file, 0o600);
  } finally {
    await unlink(temporaryFile).catch(() => undefined);
  }
}

export async function loadRefreshTokenWithSource(file = CREDENTIALS_FILE): Promise<LoadedRefreshToken> {
  const environmentToken = process.env.CALIVERSE_REFRESH_TOKEN;
  if (environmentToken !== undefined && environmentToken.length > 0) {
    return { refreshToken: environmentToken, source: "environment" };
  }

  let metadata;
  try {
    metadata = await stat(file);
  } catch (error: unknown) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
    throw new Error("No Caliverse credentials found. Run `pnpm login` first.");
    }
    throw error;
  }

  if ((metadata.mode & 0o077) !== 0) {
    throw new Error(`Credentials file ${file} is accessible to other users. Set its mode to 0600.`);
  }

  let credentials: unknown;
  try {
    credentials = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(`Credentials file ${file} is invalid JSON.`);
  }

  if (
    typeof credentials !== "object" ||
    credentials === null ||
    !("refreshToken" in credentials) ||
    typeof (credentials as StoredCredentials).refreshToken !== "string" ||
    (credentials as StoredCredentials).refreshToken.length === 0
  ) {
    throw new Error(`Credentials file ${file} does not contain a refresh token.`);
  }
  return { refreshToken: (credentials as StoredCredentials).refreshToken, source: "file" };
}

export async function loadRefreshToken(file = CREDENTIALS_FILE): Promise<string> {
  return (await loadRefreshTokenWithSource(file)).refreshToken;
}
