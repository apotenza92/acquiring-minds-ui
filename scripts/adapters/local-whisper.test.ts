import { describe, expect, it } from "vitest";
import {
  buildFfmpegClipArgs,
  buildMlxWhisperArgs,
  buildWhisperArgs,
  normaliseWhisperJson,
  parseWhisperJson,
} from "./local-whisper.mjs";

describe("local Whisper adapter", () => {
  it("normalises Whisper JSON into transcript segments", () => {
    const segments = normaliseWhisperJson({
      segments: [
        {
          start: 1.2,
          end: 4,
          text: " Hello from audio ",
        },
      ],
    });

    expect(segments).toEqual([
      {
        id: "local-whisper-1",
        start: "00:00:01",
        end: "00:00:04",
        text: "Hello from audio",
        source: "local-whisper",
      },
    ]);
  });

  it("parses MLX Whisper JSON containing non-standard NaN values", () => {
    expect(parseWhisperJson('{"segments":[{"start":0,"end":1,"text":" Hi ","avg_logprob": NaN}]}')).toMatchObject({
      segments: [
        {
          text: " Hi ",
          avg_logprob: null,
        },
      ],
    });
  });

  it("builds clipped ffmpeg and json Whisper commands", () => {
    expect(buildFfmpegClipArgs("https://example.test/audio.mp3", "/tmp/clip.wav", {
      clipStartSeconds: 30,
      clipSeconds: 45,
    })).toEqual([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "30",
      "-i",
      "https://example.test/audio.mp3",
      "-t",
      "45",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "/tmp/clip.wav",
    ]);

    expect(buildWhisperArgs("/tmp/clip.wav", "/tmp/out", { model: "tiny" })).toContain("--output_format");
    expect(buildMlxWhisperArgs("/tmp/clip.wav", "/tmp/out/clip.json", {
      model: "mlx-community/whisper-large-v3-turbo",
    })).toEqual(expect.arrayContaining([
      "--from",
      "mlx-whisper",
      "mlx-community/whisper-large-v3-turbo",
      "/tmp/out/clip.json",
    ]));
  });
});
