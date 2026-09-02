import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "../src/client.js";
import { registerTools, SERVER_INSTRUCTIONS } from "../src/tools.js";

interface FakeState {
  planReads: string[];
  createWorkoutCalls: number;
}

async function withClient(action: (client: Client, state: FakeState) => Promise<void>): Promise<void> {
  const state: FakeState = { planReads: [], createWorkoutCalls: 0 };
  const api = {
    async listExercises() {
      return [
        { id: 1, title: "Push-up", slug: "push-up", level: "beginner", description: "Chest", video_url: "large" },
        { id: 2, title: "Pull-up", slug: "pull-up", level: "intermediate", description: "Back", video_url: "large" },
        { id: 3, title: "Squat", slug: "squat", level: "beginner", description: "Legs", video_url: "large" }
      ];
    },
    async listPlansShort() {
      state.planReads.push("short");
      return [{ id: 10, title: "Short plan", levels: [{ large: true }] }];
    },
    async listPlans() {
      state.planReads.push("full");
      return [{ id: 11, title: "Full plan", levels: [] }];
    },
    async listWorkoutGoals() {
      return [{ id: 7, title: "Strength", goal_group: "BUILD", extra: "omit", workout_plan: { id: 10, title: "Plan", levels: [] } }];
    },
    async createWorkout() {
      state.createWorkoutCalls += 1;
      return { id: 100 };
    },
    async getWorkout() {
      return { id: 42, title: "Session", level: "beginner", length_in_minutes: 30, supersets: [{ order_in_workout: 1, workout_exercises: [{ order_in_workout: 1, set_count: 3, repetition_count: 8, exercise: { id: 1, title: "Push-up", image_url: "https://assets.caliverse.app/image", video_url: "https://video.example/watch" } }] }] };
    }
  } as unknown as CaliverseApi;
  const server = new McpServer({ name: "caliverse-test", version: "1.0.0" }, { instructions: SERVER_INSTRUCTIONS });
  registerTools(server, api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "caliverse-test-client", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    await action(client, state);
  } finally {
    await client.close();
    await server.close();
  }
}

function text(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  assert.equal(content[0]?.type, "text");
  const value = content[0]?.text;
  if (typeof value !== "string") throw new Error("Expected text tool content.");
  return value;
}

test("tool schemas apply defaults, filter exercises, and return page metadata", async () => {
  await withClient(async (client) => {
    const defaultResult = await client.callTool({ name: "caliverse_list_exercises", arguments: {} });
    const defaultBody = JSON.parse(text(defaultResult));
    assert.equal(defaultBody.offset, 0);
    assert.equal(defaultBody.limit, 50);
    assert.equal(defaultBody.detail, "summary");
    assert.equal(defaultBody.returned, 3);
    assert.deepEqual(defaultBody.omitted, ["description", "video_url"]);

    const filteredResult = await client.callTool({
      name: "caliverse_list_exercises",
      arguments: { query: "up", offset: 1, limit: 1 }
    });
    const filteredBody = JSON.parse(text(filteredResult));
    assert.equal(filteredBody.total, 2);
    assert.equal(filteredBody.returned, 1);
    assert.equal(filteredBody.nextOffset, null);
    assert.equal(filteredBody.items[0].title, "Pull-up");

    const unrelatedResult = await client.callTool({
      name: "caliverse_list_exercises",
      arguments: { query: "large" }
    });
    assert.equal(JSON.parse(text(unrelatedResult)).total, 0);
  });
});

test("mutation tools reject missing confirmation before invoking the API", async () => {
  await withClient(async (client, state) => {
    const result = await client.callTool({
      name: "caliverse_create_workout",
      arguments: {
        title: "Test",
        lengthInMinutes: 5,
        level: "beginner",
        supersets: [{
          orderInWorkout: 1,
          exercises: [{ exerciseId: 1, setCount: 1, repetitionCount: 1, orderInWorkout: 1 }]
        }]
      }
    });
    assert.equal(result.isError, true);
    assert.match(text(result), /confirm/);
    assert.equal(state.createWorkoutCalls, 0);
  });
});

test("plan list routing uses the compact endpoint only for the default summary", async () => {
  await withClient(async (client, state) => {
    await client.callTool({ name: "caliverse_list_workout_plans", arguments: {} });
    await client.callTool({ name: "caliverse_list_workout_plans", arguments: { detail: "full" } });
    await client.callTool({ name: "caliverse_list_workout_plans", arguments: { fields: ["id"] } });
    assert.deepEqual(state.planReads, ["short", "full", "full"]);
  });
});

test("workout goals are projected", async () => {
  await withClient(async (client) => {
    const goalsResult = await client.callTool({ name: "caliverse_list_workout_goals", arguments: {} });
    assert.deepEqual(JSON.parse(text(goalsResult)), [{
      id: 7,
      title: "Strength",
      goal_group: "BUILD",
      workout_plan: { id: 10, title: "Plan" }
    }]);
  });
});

test("workout card resource and tool expose the MCP App contract", async () => {
  await withClient(async (client) => {
    const resources = await client.listResources();
    const resource = resources.resources.find((item) => item.uri === "ui://caliverse/workout-cards");
    assert.equal(resource?.mimeType, "text/html;profile=mcp-app");
    assert.deepEqual(resource?._meta, { ui: { prefersBorder: true } });
    const view = await client.readResource({ uri: "ui://caliverse/workout-cards" });
    const html = view.contents[0];
    assert.equal(html?.mimeType, "text/html;profile=mcp-app");
    const htmlText = html !== undefined && "text" in html ? html.text : "";
    assert.deepEqual(html?._meta, { ui: { csp: { resourceDomains: ["https://assets.caliverse.app"] }, prefersBorder: true } });
    assert.match(htmlText, /ui\/notifications\/tool-result/);
    assert.doesNotMatch(htmlText, /<script[^>]+src=/);

    const result = await client.callTool({ name: "caliverse_show_workout_cards", arguments: { workoutId: 42 } });
    assert.match(text(result), /Session: 1 exercise/);
    const structured = result.structuredContent as { workout: { title: string }; cards: Array<{ card_image_url: string }> } | undefined;
    assert.equal(structured?.workout.title, "Session");
    assert.match(String(structured?.cards[0]?.card_image_url), /^https:\/\/assets\.caliverse\.app\//);

    const tools = (await client.listTools()).tools;
    assert.equal(tools.find((tool) => tool.name === "caliverse_show_workout_cards")?._meta?.["ui/resourceUri"], "ui://caliverse/workout-cards");
    assert.equal(tools.some((tool) => tool.name === "caliverse_get_workout_card_data"), false);
  });
});

test("tool listings advertise read and destructive mutation annotations", async () => {
  await withClient(async (client) => {
    const tools = (await client.listTools()).tools;
    const read = tools.find((tool) => tool.name === "caliverse_list_exercises");
    const destructive = tools.find((tool) => tool.name === "caliverse_delete_workout");
    assert.equal(read?.annotations?.readOnlyHint, true);
    assert.equal(destructive?.annotations?.readOnlyHint, false);
    assert.equal(destructive?.annotations?.destructiveHint, true);
  });
});

test("server instructions expose the safe workout workflow", async () => {
  await withClient(async (client) => {
    assert.match(client.getInstructions() ?? "", /caliverse_get_workout_filters/);
    assert.match(client.getInstructions() ?? "", /confirm: true/);
    assert.match(client.getInstructions() ?? "", /detail structure/);
  });
});

test("date tools reject impossible and reversed ranges before invoking the API", async () => {
  await withClient(async (client) => {
    const invalidDate = await client.callTool({ name: "caliverse_get_my_day", arguments: { date: "2026-02-30" } });
    assert.equal(invalidDate.isError, true);
    assert.match(text(invalidDate), /valid date/);

    const reversedCalendar = await client.callTool({
      name: "caliverse_get_schedule_calendar",
      arguments: { dateFrom: "2026-09-02", dateTo: "2026-09-01" }
    });
    assert.equal(reversedCalendar.isError, true);
    assert.match(text(reversedCalendar), /dateFrom must be on or before dateTo/);

    const reversedHistory = await client.callTool({
      name: "caliverse_get_coach_history",
      arguments: { from: "2026-09-02", to: "2026-09-01" }
    });
    assert.equal(reversedHistory.isError, true);
    assert.match(text(reversedHistory), /from must be on or before to/);
  });
});
