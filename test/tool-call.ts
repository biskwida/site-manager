// test/tool-call.ts
import type { makeTools } from "@/src/agent/tools";

type Tools = ReturnType<typeof makeTools>;

/** Finds a tool by name, validates the input with the tool's own schema, runs it, parses the JSON string it returns. */
export async function call(tools: Tools, name: string, input: unknown): Promise<Record<string, unknown>> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  const parsed = tool.parse(input);
  return JSON.parse(await (tool.run as (i: unknown) => Promise<string>)(parsed));
}
