import { POST } from "@/app/api/stt/route";
import { NextRequest } from "next/server";

// Mock @/lib/gemini
jest.mock("@/lib/gemini", () => ({
  generateWithModelFallback: jest.fn(),
}));

import { generateWithModelFallback } from "@/lib/gemini";

describe("Speech-to-Text API (/api/stt)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 when no audio file is provided", async () => {
    const formData = new FormData();
    const req = new NextRequest("http://localhost:3000/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("No audio file provided");
  });

  it("returns noSpeech: true when audio is too small (<500 bytes)", async () => {
    const formData = new FormData();
    const tinyBlob = new Blob([new Uint8Array(100)], { type: "audio/webm" });
    formData.append("file", tinyBlob, "tiny.webm");

    const req = new NextRequest("http://localhost:3000/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.text).toBe("");
    expect(json.noSpeech).toBe(true);
  });

  it("successfully transcribes valid audio and cleans quotes", async () => {
    (generateWithModelFallback as jest.Mock).mockResolvedValueOnce({
      text: () => '"This is a test pitch for an AI venture"',
    });

    const formData = new FormData();
    const fakeAudio = new Blob([new Uint8Array(1024)], { type: "audio/webm" });
    formData.append("file", fakeAudio, "voice.webm");

    const req = new NextRequest("http://localhost:3000/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.text).toBe("This is a test pitch for an AI venture");
    expect(json.noSpeech).toBe(false);
  });

  it("handles [NO_SPEECH] response from Gemini cleanly", async () => {
    (generateWithModelFallback as jest.Mock).mockResolvedValueOnce({
      text: () => "[NO_SPEECH]",
    });

    const formData = new FormData();
    const fakeAudio = new Blob([new Uint8Array(1024)], { type: "audio/webm" });
    formData.append("file", fakeAudio, "voice.webm");

    const req = new NextRequest("http://localhost:3000/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.text).toBe("");
    expect(json.noSpeech).toBe(true);
  });

  it("returns user-friendly error when Gemini throws invalid argument", async () => {
    (generateWithModelFallback as jest.Mock).mockRejectedValueOnce(
      new Error("INVALID_ARGUMENT: Bad audio framing")
    );

    const formData = new FormData();
    const fakeAudio = new Blob([new Uint8Array(1024)], { type: "audio/webm" });
    formData.append("file", fakeAudio, "voice.webm");

    const req = new NextRequest("http://localhost:3000/api/stt", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.ok).toBe(false);
    expect(json.error).toContain("Audio recording was empty or could not be decoded");
  });
});
