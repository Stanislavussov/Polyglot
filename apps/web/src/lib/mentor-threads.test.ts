import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadThreads, newThread, saveThread } from "./mentor-threads";

function memoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => void store.set(key, value),
    removeItem: (key) => void store.delete(key),
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };
}

describe("mentor threads (browser-held)", () => {
  beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
  afterEach(() => vi.unstubAllGlobals());

  it("titles a thread by its first question, cut to one line's worth", () => {
    expect(newThread("Is it formal?").title).toBe("Is it formal?");
    expect(newThread("x".repeat(80)).title).toBe(`${"x".repeat(60)}…`);
  });

  it("keeps the latest thread first, replaces one it already holds, and survives a reload", () => {
    const first = { ...newThread("one"), turns: [{ role: "user" as const, content: "one" }] };
    const second = newThread("two");
    let threads = saveThread([], first);
    threads = saveThread(threads, second);
    threads = saveThread(threads, { ...first, turns: [...first.turns, { role: "assistant", content: "yes" }] });

    expect(threads.map((thread) => thread.title)).toEqual(["one", "two"]);
    expect(loadThreads()).toEqual(threads);
  });

  it("reads broken storage as no history", () => {
    localStorage.setItem("polyglot.mentor.threads", "{not json");
    expect(loadThreads()).toEqual([]);
  });
});
