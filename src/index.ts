import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenManager } from "./auth.js";
import { CaliverseApi } from "./client.js";
import { loadRefreshToken } from "./credentials.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const refreshToken = await loadRefreshToken();
  const api = new CaliverseApi({ tokenManager: new TokenManager(refreshToken) });
  const server = new McpServer({ name: "caliverse-mcp", version: "0.1.0" });
  registerTools(server, api);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  process.stderr.write(`caliverse-mcp failed to start: ${message}\n`);
  process.exitCode = 1;
});
