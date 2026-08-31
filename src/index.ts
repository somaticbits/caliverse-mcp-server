import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TokenManager } from "./auth.js";
import { CaliverseApi } from "./client.js";
import { loadRefreshTokenWithSource, saveRefreshToken } from "./credentials.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  const credentials = await loadRefreshTokenWithSource();
  const persistRefreshToken = credentials.source === "file"
    ? async (refreshToken: string): Promise<void> => {
        try {
          await saveRefreshToken(refreshToken);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown credential persistence error.";
          process.stderr.write(`caliverse-mcp could not persist a rotated refresh token: ${message}\n`);
        }
      }
    : undefined;
  const api = new CaliverseApi({ tokenManager: new TokenManager(credentials.refreshToken, fetch, Date.now, persistRefreshToken) });
  const server = new McpServer({ name: "caliverse-mcp", version: "0.1.0" });
  registerTools(server, api);
  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error.";
  process.stderr.write(`caliverse-mcp failed to start: ${message}\n`);
  process.exitCode = 1;
});
