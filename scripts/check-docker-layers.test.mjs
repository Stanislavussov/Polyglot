import { describe, expect, it } from "vitest";
import { checkDockerfile } from "./check-docker-layers.mjs";

const PACKAGES = [
  { dir: "packages/core", name: "@p/core", deps: [], buildsDist: true },
  { dir: "packages/adapters/auth", name: "@p/auth", deps: ["@p/core"], buildsDist: true },
  { dir: "apps/web-api", name: "@p/web-api", deps: ["@p/core", "@p/auth"], buildsDist: true },
];

function dockerfile({ authManifest = true, authDist = true } = {}) {
  return [
    "FROM node:26-alpine AS deps",
    "COPY packages/core/package.json packages/core/",
    ...(authManifest ? ["COPY packages/adapters/auth/package.json packages/adapters/auth/"] : []),
    "COPY apps/web-api/package.json apps/web-api/",
    "RUN pnpm install --frozen-lockfile",
    "FROM node:26-alpine AS production",
    "COPY --from=build /app/apps/web-api/dist apps/web-api/dist",
    "COPY --from=build /app/packages/core/dist packages/core/dist",
    ...(authDist ? ["COPY --from=build /app/packages/adapters/auth/dist packages/adapters/auth/dist"] : []),
  ].join("\n");
}

describe("checkDockerfile", () => {
  it("passes an image that carries every package its app needs", () => {
    expect(checkDockerfile("Dockerfile", dockerfile(), PACKAGES)).toEqual([]);
  });

  it("catches a new adapter whose package.json the install stage forgot (its deps never install)", () => {
    const problems = checkDockerfile("Dockerfile", dockerfile({ authManifest: false }), PACKAGES);
    expect(problems).toEqual([expect.stringContaining("COPY packages/adapters/auth/package.json")]);
  });

  it("catches a runtime image that copies the app but not an adapter it imports", () => {
    const problems = checkDockerfile("Dockerfile", dockerfile({ authDist: false }), PACKAGES);
    expect(problems).toEqual([expect.stringContaining("/app/packages/adapters/auth/dist")]);
  });
});
