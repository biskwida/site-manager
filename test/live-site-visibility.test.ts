// test/live-site-visibility.test.ts
import { describe, expect, it, vi } from "vitest";
import { whileVisible, type VisibilityEnv } from "@/src/templates/shared/useLiveSite";

function fakeEnv(initial: DocumentVisibilityState) {
  let listener: (() => void) | null = null;
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const doc = {
    visibilityState: initial,
    addEventListener: vi.fn((_type: string, fn: () => void) => (listener = fn)),
    removeEventListener: vi.fn(() => (listener = null)),
  };
  const win = {
    setInterval: vi.fn((fn: () => void) => {
      const id = nextId++;
      timers.set(id, fn);
      return id;
    }),
    clearInterval: vi.fn((id: number) => timers.delete(id)),
  };
  return {
    env: { doc, win } as unknown as VisibilityEnv,
    timers,
    win,
    hasListener: () => listener !== null,
    setVisibility(state: DocumentVisibilityState) {
      doc.visibilityState = state;
      listener?.();
    },
    fire: () => [...timers.values()].forEach((fn) => fn()),
  };
}

describe("whileVisible", () => {
  it("polls while the tab is visible", () => {
    const f = fakeEnv("visible");
    const tick = vi.fn();
    whileVisible(tick, 5000, f.env);
    expect(f.timers.size).toBe(1);
    f.fire();
    expect(tick).toHaveBeenCalledTimes(1);
  });

  it("stops polling while hidden and loads at once when the tab comes back", () => {
    const f = fakeEnv("visible");
    const tick = vi.fn();
    whileVisible(tick, 5000, f.env);
    f.setVisibility("hidden");
    expect(f.timers.size).toBe(0);
    expect(tick).not.toHaveBeenCalled();
    f.setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    expect(f.timers.size).toBe(1);
  });

  it("does not start in a tab opened in the background", () => {
    const f = fakeEnv("hidden");
    const tick = vi.fn();
    whileVisible(tick, 5000, f.env);
    expect(f.timers.size).toBe(0);
    f.setVisibility("visible");
    expect(tick).toHaveBeenCalledTimes(1);
    expect(f.timers.size).toBe(1);
  });

  it("never runs two intervals when visible is reported twice", () => {
    const f = fakeEnv("visible");
    const tick = vi.fn();
    whileVisible(tick, 5000, f.env);
    f.setVisibility("visible");
    expect(f.timers.size).toBe(1);
    expect(tick).not.toHaveBeenCalled();
  });

  it("cancel clears the interval and the listener", () => {
    const f = fakeEnv("visible");
    const cancel = whileVisible(vi.fn(), 5000, f.env);
    cancel();
    expect(f.timers.size).toBe(0);
    expect(f.hasListener()).toBe(false);
  });
});
