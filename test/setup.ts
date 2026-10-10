// test/setup.ts
// next/font/google is an empty module outside the Next build. Any name imported from it becomes a loader that returns
// stable class/variable names, so template registries (index.ts → fonts.ts) can be imported by tests.
import { vi } from "vitest";

vi.mock("next/font/google", () => {
  const skip = new Set(["then", "default", "__esModule", "__vi_mock__"]);
  return new Proxy({}, {
    get(_target, name) {
      if (typeof name !== "string" || skip.has(name)) return undefined;
      return () => ({ className: `font-${name}`, variable: `font-var-${name}`, style: { fontFamily: name } });
    },
    has(_target, name) {
      return typeof name === "string" && !skip.has(name);
    },
  });
});
