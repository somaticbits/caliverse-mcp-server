import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadRefreshToken, saveRefreshToken } from "../src/credentials.js";

test("credentials are atomically stored with owner-only permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "caliverse-mcp-test-"));
  const file = join(directory, "credentials.json");
  try {
    await saveRefreshToken("refresh-token", file);
    assert.equal(await loadRefreshToken(file), "refresh-token");
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(directory)).mode & 0o777, 0o700);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
