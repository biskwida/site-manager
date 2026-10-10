// Fill one key in .env.local without the value ever reaching the terminal, a log, or git.
//   npm run env:set -- TELEGRAM_BOT_TOKEN
//   npm run env:set                      (lists the keys from .env.example and asks which one)
// The value is read with echo off; it is written only into .env.local (git-ignored).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const EXAMPLE = ".env.example";
const TARGET = ".env.local";

const keysInExample = readFileSync(EXAMPLE, "utf8")
  .split("\n")
  .map((l) => /^([A-Z0-9_]+)=/.exec(l)?.[1])
  .filter((k): k is string => !!k);

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const original = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    if (hidden) {
      // Print the prompt once, then swallow every echoed character.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = function (s: string) {
        if (s.startsWith(question)) original.call(this, question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

const argKey = process.argv[2]?.trim();
let key = argKey;
if (!key) {
  console.log("Keys from .env.example:");
  keysInExample.forEach((k, i) => console.log(`  ${i + 1}. ${k}`));
  const pick = await ask("Which key (number or name)? ", false);
  key = /^\d+$/.test(pick) ? keysInExample[Number(pick) - 1] : pick;
}
if (!key || !keysInExample.includes(key)) {
  console.error(`Unknown key "${key ?? ""}". Allowed: ${keysInExample.join(", ")}`);
  process.exit(1);
}

const value = await ask(`${key} (input hidden): `, true);
if (!value) {
  console.error("Empty value; nothing written.");
  process.exit(1);
}
if (/\s/.test(value)) {
  console.error("The value contains whitespace; paste the token alone and try again.");
  process.exit(1);
}

const current = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : readFileSync(EXAMPLE, "utf8");
const lines = current.split("\n");
const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
const line = `${key}=${value}`;
if (idx === -1) lines.push(line);
else lines[idx] = line;
writeFileSync(TARGET, lines.join("\n"));
console.log(`Saved ${key} to ${TARGET} (${value.length} characters). The value was not displayed.`);
