import assert from "node:assert/strict";
import test from "node:test";
import { buildThumbnailUrl, clearThumbnailCacheForTest, fetchThumbnail, fetchThumbnails, imageByteLimitsForTest, sniffImageMime } from "../src/media.js";

const sourceUrl = "https://assets.caliverse.app/eyJidWNrZXQiOiJjYWxpc3RoZW5pY3MtaGFubmliYWwiLCJrZXkiOiJpbWFnZXNcL2V4ZXJjaXNlc1wvLTYyOTI2MWJjYzc2NjEucG5nIiwiZWRpdHMiOnsicmVzaXplIjp7IndpZHRoIjozNTAsImhlaWdodCI6MzUwLCJmaXQiOiJjb3ZlciJ9fX0=";

function webpResponse(): Response {
  return new Response(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x08, 0x00, 0x00, 0x00]), Buffer.from("WEBP"), Buffer.from([0x00, 0x00, 0x00, 0x00])]), { status: 200 });
}

test("image byte limits use distinct defaults and keep the total at least as large as one image", () => {
  assert.deepEqual(imageByteLimitsForTest(), { image: 65_536, total: 524_288 });
  assert.deepEqual(imageByteLimitsForTest("bad", "bad"), { image: 65_536, total: 524_288 });
  assert.deepEqual(imageByteLimitsForTest("900000", "100000"), { image: 900_000, total: 900_000 });
  assert.deepEqual(imageByteLimitsForTest("99999999", "99999999"), { image: 1_048_576, total: 4_194_304 });
});

test("buildThumbnailUrl preserves the image source and replaces only supported edits", () => {
  const url = buildThumbnailUrl(sourceUrl, { size: 96, format: "webp", quality: 70 });
  const payload = JSON.parse(Buffer.from(new URL(url).pathname.slice(1), "base64").toString("utf8"));
  assert.deepEqual(payload, {
    bucket: "calisthenics-hannibal",
    key: "images/exercises/-629261bcc7661.png",
    edits: { resize: { width: 96, height: 96, fit: "cover" }, webp: { quality: 70 } }
  });
  assert.equal(buildThumbnailUrl("https://example.test/image.png", { size: 96, format: "webp", quality: 70 }), "https://example.test/image.png");
});

test("sniffImageMime recognizes supported image formats", () => {
  assert.equal(sniffImageMime(Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary")), "image/webp");
  assert.equal(sniffImageMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff])), "image/jpeg");
  assert.equal(sniffImageMime(Buffer.from("GIF89a")), "image/gif");
  assert.equal(sniffImageMime(Buffer.from("{}")), undefined);
});

test("fetchThumbnail sniffs content rather than trusting the response content type and caches it", async () => {
  clearThumbnailCacheForTest();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return webpResponse();
  };
  const first = await fetchThumbnail(sourceUrl, fetchImpl);
  const second = await fetchThumbnail(sourceUrl, fetchImpl);
  assert.equal(first.mimeType, "image/webp");
  assert.equal(first.data, second.data);
  assert.equal(calls, 1);
});

test("fetchThumbnail rejects successful non-image responses and untrusted hosts", async () => {
  clearThumbnailCacheForTest();
  await assert.rejects(fetchThumbnail(sourceUrl, async () => new Response("{}", { status: 200 })), /not a supported image/);
  await assert.rejects(fetchThumbnail("https://example.test/image.png", async () => webpResponse()), /not an allowed HTTPS/);
});

test("fetchThumbnails deduplicates URLs and limits concurrent requests", async () => {
  clearThumbnailCacheForTest();
  let active = 0;
  let peak = 0;
  let calls = 0;
  const urls = Array.from({ length: 7 }, (_, index) => `https://assets.caliverse.app/image-${index}`);
  const results = await fetchThumbnails([...urls, urls[0] as string], async () => {
    calls += 1;
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return webpResponse();
  });
  assert.equal(calls, 7);
  assert.ok(peak <= 5);
  assert.equal(results.size, 7);
});
