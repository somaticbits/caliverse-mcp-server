import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { loadRefreshToken, loadRefreshTokenWithSource, saveRefreshToken } from "../src/credentials.js";

const originalEnvironmentToken = process.env.CALIVERSE_REFRESH_TOKEN;

test.before(() => {
  delete process.env.CALIVERSE_REFRESH_TOKEN;
});

test.after(() => {
  if (originalEnvironmentToken === undefined) {
    delete process.env.CALIVERSE_REFRESH_TOKEN;
  } else {
    process.env.CALIVERSE_REFRESH_TOKEN = originalEnvironmentToken;
  }
});

async function withCredentialsFile(action: (file: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "caliverse-mcp-test-"));
  const file = join(directory, "credentials.json");
  try {
    await action(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("credentials are atomically stored with owner-only permissions", async () => {
  await withCredentialsFile(async (file) => {
    await saveRefreshToken("refresh-token", file);
    assert.equal(await loadRefreshToken(file), "refresh-token");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(dirname(file))).mode & 0o777, 0o700);
  });
});

test("credentials reject files accessible to other users", async () => {
  await withCredentialsFile(async (file) => {
    await saveRefreshToken("refresh-token", file);
    await chmod(file, 0o644);
    await assert.rejects(loadRefreshToken(file), /accessible to other users/);
  });
});

test("credentials reject missing and malformed files", async () => {
  await withCredentialsFile(async (file) => {
    await assert.rejects(loadRefreshToken(file), /No Caliverse credentials found/);
    await writeFile(file, "not json\n", { mode: 0o600 });
    await assert.rejects(loadRefreshToken(file), /invalid JSON/);
  });
});

test("credentials require a non-empty string refresh token", async () => {
  for (const credentials of [{}, { refreshToken: "" }, { refreshToken: 123 }]) {
    await withCredentialsFile(async (file) => {
      await writeFile(file, `${JSON.stringify(credentials)}\n`, { mode: 0o600 });
      await assert.rejects(loadRefreshToken(file), /does not contain a refresh token/);
    });
  }
});

test("environment credentials override the file and are marked as environment-sourced", async () => {
  await withCredentialsFile(async (file) => {
    await saveRefreshToken("file-token", file);
    process.env.CALIVERSE_REFRESH_TOKEN = "environment-token";
    try {
      assert.deepEqual(await loadRefreshTokenWithSource(file), {
        refreshToken: "environment-token",
        source: "environment"
      });
    } finally {
      delete process.env.CALIVERSE_REFRESH_TOKEN;
    }
    assert.deepEqual(await loadRefreshTokenWithSource(file), {
      refreshToken: "file-token",
      source: "file"
    });
  });
});
