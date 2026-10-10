// src/wizard/tool-schema.ts
// Shared plumbing for the wizard's single-tool Claude calls: the strict tool input schema and a log-safe error summary.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

/**
 * JSON Schema for a strict tool input, from a zod object: nested inline (no $defs/$ref — the SDK's betaZodTool uses
 * `reused: "ref"`, which hoists every described array item into $defs), without the "$schema" key. The zod schema itself
 * must carry no numeric or length constraints (the Messages API rejects minimum/maximum/minLength/minItems/pattern… in a
 * tool's input_schema); the tests allow-list the keywords of the result.
 */
export function wireSchema(schema: z.ZodType): Anthropic.Beta.BetaTool["input_schema"] {
  const json = z.toJSONSchema(schema, { reused: "inline" });
  return Object.fromEntries(Object.entries(json).filter(([k]) => k !== "$schema")) as Anthropic.Beta.BetaTool["input_schema"];
}

/**
 * What may be logged about a failed call: HTTP status and error type for an API error, the error's name otherwise.
 * Never the message: an APIError's message is the whole response body, which can echo request content.
 */
export function errorSummary(e: unknown): string {
  if (e instanceof Anthropic.APIError) return `${e.status ?? "?"} ${e.type ?? ""}`.trim();
  if (e instanceof Error) return e.name;
  return "unknown error";
}
