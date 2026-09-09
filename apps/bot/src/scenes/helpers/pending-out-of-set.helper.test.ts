import { describe, expect, it } from "vitest";
import type { SessionData } from "../../types.js";
import { MAX_PENDING_OUT_OF_SET, setPendingOutOfSet } from "./pending-out-of-set.helper.js";

function makeSession(): SessionData {
  return { activeMode: "translate" } as SessionData;
}

describe("pending out-of-set store", () => {
  it("stores the prompt's word keyed by its message id", () => {
    const session = makeSession();

    setPendingOutOfSet(session, 42, { lang: "kk", word: "рахмет" });

    expect(session.pendingOutOfSet?.["42"]).toMatchObject({ lang: "kk", word: "рахмет" });
  });

  it("keeps two concurrent prompts from cross-wiring language and word", () => {
    const session = makeSession();

    setPendingOutOfSet(session, 10, { lang: "kk", word: "рахмет" });
    setPendingOutOfSet(session, 11, { lang: "sk", word: "ďakujem", contextHint: "thanks" });

    expect(session.pendingOutOfSet?.["10"]).toMatchObject({ lang: "kk", word: "рахмет" });
    expect(session.pendingOutOfSet?.["11"]).toMatchObject({ lang: "sk", word: "ďakujem", contextHint: "thanks" });
  });

  it("evicts the oldest prompts past the cap so ignored prompts cannot inflate the session row", () => {
    const session = makeSession();

    for (let i = 0; i < MAX_PENDING_OUT_OF_SET + 3; i++) {
      setPendingOutOfSet(session, 100 + i, { lang: "kk", word: `word-${i}` });
    }

    expect(Object.keys(session.pendingOutOfSet ?? {})).toHaveLength(MAX_PENDING_OUT_OF_SET);
    // Oldest three are gone; the most recent survives.
    expect(session.pendingOutOfSet?.["100"]).toBeUndefined();
    expect(session.pendingOutOfSet?.[String(100 + MAX_PENDING_OUT_OF_SET + 2)]).toMatchObject({
      word: `word-${MAX_PENDING_OUT_OF_SET + 2}`,
    });
  });

  it("never evicts the prompt just added when message ids restart low", () => {
    // A recreated chat (or another bot sharing the session key) restarts ids at
    // 1 while stale high-id entries are still in the map.
    const session = makeSession();
    for (let i = 0; i < MAX_PENDING_OUT_OF_SET; i++) {
      setPendingOutOfSet(session, 9000 + i, { lang: "kk", word: `stale-${i}` });
    }

    setPendingOutOfSet(session, 1, { lang: "sk", word: "fresh" });

    expect(session.pendingOutOfSet?.["1"]).toMatchObject({ word: "fresh" });
  });

  it("purges legacy unstamped entries first so a polluted map self-heals", () => {
    const session = makeSession();
    session.pendingOutOfSet = {};
    for (let i = 0; i < MAX_PENDING_OUT_OF_SET; i++) {
      session.pendingOutOfSet[String(500 + i)] = { lang: "kk", word: `legacy-${i}` };
    }

    setPendingOutOfSet(session, 1000, { lang: "sk", word: "stamped" });

    expect(session.pendingOutOfSet?.["500"]).toBeUndefined();
    expect(session.pendingOutOfSet?.["1000"]).toMatchObject({ word: "stamped" });
  });
});
