import { describe, expect, it } from "vitest";
import { extractVideoId, isVideoUrl, isYouTubeUrl } from "../url-parser.js";

describe("isYouTubeUrl", () => {
  it("detects standard youtube.com/watch URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("detects youtu.be short URLs", () => {
    expect(isYouTubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
    expect(isYouTubeUrl("youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("detects youtube.com/shorts URLs", () => {
    expect(isYouTubeUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(true);
  });

  it("detects m.youtube.com URLs", () => {
    expect(isYouTubeUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("detects embed URLs", () => {
    expect(isYouTubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("detects URLs with extra parameters", () => {
    expect(isYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120")).toBe(true);
    expect(isYouTubeUrl("https://www.youtube.com/watch?list=PLx&v=dQw4w9WgXcQ")).toBe(true);
  });

  it("detects YouTube URL within surrounding text", () => {
    expect(isYouTubeUrl("Check this out: https://youtu.be/dQw4w9WgXcQ cool right?")).toBe(true);
  });

  it("rejects non-YouTube URLs", () => {
    expect(isYouTubeUrl("https://vimeo.com/123456")).toBe(false);
    expect(isYouTubeUrl("hello world")).toBe(false);
    expect(isYouTubeUrl("https://google.com")).toBe(false);
  });
});

describe("isVideoUrl", () => {
  it("detects non-YouTube video platform URLs", () => {
    expect(isVideoUrl("https://vimeo.com/123456")).toBe(true);
    expect(isVideoUrl("https://www.tiktok.com/@user/video/123")).toBe(true);
    expect(isVideoUrl("https://www.dailymotion.com/video/x123")).toBe(true);
    expect(isVideoUrl("https://www.twitch.tv/channel")).toBe(true);
  });

  it("returns false for YouTube URLs", () => {
    expect(isVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(false);
  });

  it("returns false for non-video URLs", () => {
    expect(isVideoUrl("https://google.com")).toBe(false);
    expect(isVideoUrl("hello world")).toBe(false);
  });
});

describe("extractVideoId", () => {
  it("extracts ID from standard URL", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from short URL", () => {
    expect(extractVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from shorts URL", () => {
    expect(extractVideoId("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from embed URL", () => {
    expect(extractVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from URL with extra params", () => {
    expect(extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=120")).toBe("dQw4w9WgXcQ");
  });

  it("extracts ID from URL surrounded by text", () => {
    expect(extractVideoId("Check this: https://youtu.be/dQw4w9WgXcQ nice")).toBe("dQw4w9WgXcQ");
  });

  it("returns null for non-YouTube URL", () => {
    expect(extractVideoId("https://vimeo.com/123456")).toBeNull();
    expect(extractVideoId("hello world")).toBeNull();
  });

  it("handles IDs with hyphens and underscores", () => {
    expect(extractVideoId("https://youtu.be/a-B_c1D2e3f")).toBe("a-B_c1D2e3f");
  });
});
