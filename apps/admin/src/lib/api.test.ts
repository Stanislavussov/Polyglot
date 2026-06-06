import { afterEach, describe, expect, it, vi } from "vitest";
import { type AIModel, aiModels } from "./api.js";

function stubFetch(
  response: Response,
): ReturnType<typeof vi.fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>> {
  const fetchMock = vi
    .fn<[input: RequestInfo | URL, init?: RequestInit], Promise<Response>>()
    .mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not send JSON content type for bodyless DELETE requests", async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));

    await aiModels.delete("google/gemini-3.5-flash");

    expect(fetchMock).toHaveBeenCalledWith("http://localhost:3001/api/settings/ai-models/google%2Fgemini-3.5-flash", {
      method: "DELETE",
      headers: {},
    });
  });

  it("sends JSON content type when a request has a body", async () => {
    const model: Omit<AIModel, "isDefault"> = {
      id: "google/gemini-3.5-flash",
      name: "Gemini 3.5 Flash",
      provider: "google",
      maxTokens: 8192,
      costPer1kInput: 0,
      costPer1kOutput: 0,
      isEnabled: true,
      allowedPlans: ["free"],
    };
    const fetchMock = stubFetch(new Response(JSON.stringify({ ...model, isDefault: false }), { status: 200 }));

    await aiModels.create(model);

    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({ "Content-Type": "application/json" });
  });
});
