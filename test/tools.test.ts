import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CaliverseApi } from "../src/client.js";
import { registerTools } from "../src/tools.js";

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
    }
  } as unknown as CaliverseApi;
  const server = new McpServer({ name: "caliverse-test", version: "1.0.0" });
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

test("workout goals are projected and the workout-card prompt is exposed", async () => {
  await withClient(async (client) => {
    const goalsResult = await client.callTool({ name: "caliverse_list_workout_goals", arguments: {} });
    assert.deepEqual(JSON.parse(text(goalsResult)), [{
      id: 7,
      title: "Strength",
      goal_group: "BUILD",
      workout_plan: { id: 10, title: "Plan" }
    }]);

    const prompt = await client.getPrompt({ name: "caliverse_render_workout_cards", arguments: { workoutId: "42" } });
    const promptContent = prompt.messages[0]?.content;
    assert.equal(promptContent?.type, "text");
    assert.match("text" in (promptContent ?? {}) ? String(promptContent.text) : "", /workoutId 42/);
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
