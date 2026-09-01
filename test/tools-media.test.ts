import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools.js";
import type { CaliverseApi } from "../src/client.js";

type ToolHandler = (input: Record<string, unknown>) => Promise<{ content: Array<Record<string, unknown>>; isError?: boolean }>;

const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x08, 0x00, 0x00, 0x00]), Buffer.from("WEBP"), Buffer.from([0x00, 0x00, 0x00, 0x00])]);
const imageUrl = "https://assets.caliverse.app/eyJidWNrZXQiOiJjYWxpc3RoZW5pY3MtaGFubmliYWwiLCJrZXkiOiJpbWFnZXNcL2V4ZXJjaXNlc1wvLTYyOTI2MWJjYzc2NjEucG5nIn0=";

function mediaTools(workout: unknown): Map<string, ToolHandler> {
  const tools = new Map<string, ToolHandler>();
  const server = {
    registerTool(name: string, _config: unknown, handler: ToolHandler) { tools.set(name, handler); },
    registerPrompt() { return {}; }
  } as unknown as McpServer;
  const api = {
    async getWorkout() { return workout; },
    async fetchAsset() { return new Response(webp, { status: 200 }); }
  } as unknown as CaliverseApi;
  registerTools(server, api);
  return tools;
}

test("show_workout_images keeps sections separate and labels time repetitions", async () => {
  const tools = mediaTools({ title: "Session", warmup_workout: { supersets: [{ order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, exercise: { id: 1, title: "Warm", image_url: imageUrl } }] }] }, supersets: [{ order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, set_count: 3, repetition_count: 15, repetition_type: "time", rest_time_before_exercise: 30, exercise: { id: 2, title: "Hold", image_url: imageUrl } }] }], cooldown_workout: { supersets: [{ order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, exercise: { id: 3, title: "Cool", image_url: imageUrl } }] }] } });
  const handler = tools.get("caliverse_show_workout_images");
  assert.ok(handler);
  const result = await handler({ workoutId: 1, include: "all", size: 96, format: "webp", quality: 70, limit: 1 });
  const texts = result.content.filter((item) => item.type === "text").map((item) => item.text);
  assert.deepEqual(texts, ["Session: 3 displayed exercises.", "Warm-up", "1. Warm", "Main workout", "1. Hold - 3 x 15s, rest 30s", "Cooldown", "1. Cool"]);
  assert.equal(result.content.filter((item) => item.type === "image").length, 3);
});

test("get_workout_card_data returns render-ready URL cards", async () => {
  const tools = mediaTools({ title: "Session", supersets: [{ order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, set_count: 3, repetition_count: 8, repetition_type: "count", rest_time_before_exercise: 0, exercise: { id: 2, title: "Pull-up", image_url: imageUrl } }] }] });
  const handler = tools.get("caliverse_get_workout_card_data");
  assert.ok(handler);
  const result = await handler({ workoutId: 1, include: "main", thumbnailMode: "url", size: 96, cardImageSize: 320, quality: 70, limit: 12 });
  const body = JSON.parse(String(result.content[0]?.text));
  assert.equal(body.cards[0].position, 1);
  assert.match(body.cards[0].thumbnail_url, /^https:\/\/assets\.caliverse\.app\//);
  assert.match(body.cards[0].card_image_url, /^https:\/\/assets\.caliverse\.app\//);
});
