/**
 * Remote MCP tools (HTTP / SSE transports only) with per-call user approval.
 * Every tool's `execute` is wrapped: the call waits for `approve(...)` and is
 * refused (the model sees an error) when the user declines.
 */
import { createMCPClient } from "@ai-sdk/mcp";
import type { ToolSet } from "ai";
import type { McpServerConfig } from "./types.js";

export interface ApprovalRequest {
  serverName: string;
  toolName: string;
  input: unknown;
}

export type Approver = (request: ApprovalRequest) => Promise<boolean>;

export interface McpSession {
  tools: ToolSet;
  /** Servers that failed to connect, with the reason. */
  failures: Array<{ name: string; error: string }>;
  close: () => Promise<void>;
}

/** Tool names must be unique across servers: prefix on collision. */
export function uniqueToolName(name: string, server: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const base = `${server.replace(/[^\w-]+/g, "_").slice(0, 24)}__${name}`;
  let candidate = base;
  let n = 2;
  while (taken.has(candidate)) candidate = `${base}_${n++}`;
  return candidate;
}

type Executable = { execute?: (input: unknown, options: unknown) => unknown };

export async function connectMcp(
  servers: readonly McpServerConfig[],
  fetchFn: typeof fetch,
  approve: Approver,
): Promise<McpSession> {
  const tools: Record<string, unknown> = {};
  const failures: McpSession["failures"] = [];
  const clients: Array<{ close: () => Promise<void> }> = [];

  for (const server of servers.filter((s) => s.enabled && /^https?:\/\//i.test(s.url))) {
    try {
      const client = await createMCPClient({
        transport: { type: server.transport, url: server.url, headers: server.headers, fetch: fetchFn },
        name: "mynx",
      });
      clients.push(client);
      const serverTools = (await client.tools()) as unknown as Record<string, Executable>;
      for (const [name, definition] of Object.entries(serverTools)) {
        const key = uniqueToolName(name, server.name, new Set(Object.keys(tools)));
        const original = definition.execute;
        tools[key] = {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            const allowed = await approve({ serverName: server.name, toolName: name, input });
            if (!allowed) throw new Error("Tool call denied by the user.");
            if (!original) throw new Error("Tool has no executor.");
            return original(input, options);
          },
        };
      }
    } catch (error) {
      failures.push({ name: server.name, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return {
    tools: tools as ToolSet,
    failures,
    close: async () => {
      await Promise.allSettled(clients.map((client) => client.close()));
    },
  };
}

/** Connection test for the settings page: returns the tool names. */
export async function probeMcp(server: McpServerConfig, fetchFn: typeof fetch): Promise<string[]> {
  const client = await createMCPClient({
    transport: { type: server.transport, url: server.url, headers: server.headers, fetch: fetchFn },
    name: "mynx",
  });
  try {
    const listed = await client.listTools();
    return listed.tools.map((t) => t.name);
  } finally {
    await client.close();
  }
}
