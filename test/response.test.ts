import assert from "node:assert/strict";
import test from "node:test";
import { pagedResult, resultByteLimitForTest, textResult } from "../src/response.js";

test("result byte limit uses a safe default and clamps configured values", () => {
  assert.equal(resultByteLimitForTest(undefined), 65_536);
  assert.equal(resultByteLimitForTest("bad"), 65_536);
  assert.equal(resultByteLimitForTest("1"), 4_096);
  assert.equal(resultByteLimitForTest("99999999"), 4_194_304);
});

test("textResult replaces oversized content with valid recovery JSON", () => {
  const result = textResult({ data: "x".repeat(100_000) });
  const body = JSON.parse(result.content[0]?.text ?? "") as Record<string, unknown>;
  assert.equal(body.error, "result_too_large");
  assert.equal(body.limit, 65_536);
  assert.equal(typeof body.preview, "string");
});

test("pagedResult supplies a next offset only when more items remain", () => {
  assert.deepEqual(pagedResult([1, 2, 3], 0, 2, "summary"), {
    total: 3, offset: 0, limit: 2, returned: 2, nextOffset: 2, detail: "summary", items: [1, 2]
  });
  assert.equal(pagedResult([1, 2, 3], 2, 2, "summary").nextOffset, null);
  assert.deepEqual(pagedResult([1], 10, 2, "summary").items, []);
});
