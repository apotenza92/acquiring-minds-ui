import { execFile } from "node:child_process";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { nowIso } from "../lib/io.mjs";

const execFileAsync = promisify(execFile);

function secondsToTimestamp(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return [hours, minutes, secs].map((part) => String(part).padStart(2, "0")).join(":");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normaliseWhisperJson(whisperJson) {
  return (whisperJson?.segments ?? [])
    .map((segment, index) => ({
      id: `local-whisper-${index + 1}`,
      start: secondsToTimestamp(segment.start),
      end: secondsToTimestamp(segment.end),
      text: cleanText(segment.text),
      source: "local-whisper",
    }))
    .filter((segment) => segment.text);
}

function fileExists(path) {
  return access(path).then(() => true, () => false);
}

export function parseWhisperJson(content) {
  try {
    return JSON.parse(content);
  } catch (error) {
    const jsonCompatible = content
      .replace(/:\s*NaN(?=\s*[,}])/g, ": null")
      .replace(/:\s*Infinity(?=\s*[,}])/g, ": null")
      .replace(/:\s*-Infinity(?=\s*[,}])/g, ": null");
    return JSON.parse(jsonCompatible);
  }
}

async function readWhisperJson(path) {
  return parseWhisperJson(await readFile(path, "utf8"));
}

export function buildFfmpegClipArgs(audioUrl, outputPath, options = {}) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (Number(options.clipStartSeconds) > 0) {
    args.push("-ss", String(options.clipStartSeconds));
  }
  args.push("-i", audioUrl);
  if (Number(options.clipSeconds) > 0) {
    args.push("-t", String(options.clipSeconds));
  }
  args.push("-vn", "-ac", "1", "-ar", "16000", outputPath);
  return args;
}

export function buildWhisperArgs(audioPath, outputDir, options = {}) {
  const args = [
    audioPath,
    "--model",
    options.model ?? "tiny",
    "--language",
    options.language ?? "en",
    "--task",
    "transcribe",
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    "--verbose",
    "False",
  ];

  if (options.device) {
    args.push("--device", options.device);
  }

  return args;
}

export function buildMlxWhisperArgs(audioPath, jsonPath, options = {}) {
  const code = [
    "import json, sys",
    "import mlx_whisper",
    "audio_path, model, output_path = sys.argv[1], sys.argv[2], sys.argv[3]",
    "result = mlx_whisper.transcribe(audio_path, path_or_hf_repo=model, language='en')",
    "open(output_path, 'w', encoding='utf8').write(json.dumps(result))",
  ].join("; ");

  return [
    "--from",
    "mlx-whisper",
    "python",
    "-c",
    code,
    audioPath,
    options.model ?? "mlx-community/whisper-large-v3-turbo",
    jsonPath,
  ];
}

function summariseFailure(error) {
  const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`.trim();
  return (output || error?.message || "Local transcription failed").split("\n").find(Boolean)?.slice(0, 240);
}

async function runOpenAIWhisper(runCommand, audioPath, outputDir, options) {
  await runCommand(options.whisperBinary ?? "whisper", buildWhisperArgs(audioPath, outputDir, {
    ...options,
    model: options.model ?? "small.en",
  }), {
    timeout: options.whisperTimeoutMs ?? 7200000,
  });
}

async function runMlxWhisper(runCommand, audioPath, jsonPath, options) {
  await runCommand(options.mlxBinary ?? "uvx", buildMlxWhisperArgs(audioPath, jsonPath, options), {
    timeout: options.whisperTimeoutMs ?? 7200000,
  });
}

export async function transcribeAudioWithLocalWhisper(audioUrl, options = {}) {
  const outputDir = options.outputDir ? resolve(options.outputDir) : undefined;
  if (!outputDir) {
    throw new Error("transcribeAudioWithLocalWhisper requires outputDir");
  }

  const runCommand =
    options.runCommand ??
    ((command, args, execOptions) =>
      execFileAsync(command, args, {
        ...execOptions,
        maxBuffer: 1024 * 1024 * 16,
      }));

  if (options.force) {
    await rm(outputDir, { recursive: true, force: true });
  }
  await mkdir(outputDir, { recursive: true });

  const audioPath = resolve(join(outputDir, options.clipSeconds ? "clip.wav" : "audio.wav"));
  const jsonPath = resolve(join(outputDir, `${audioPath.split("/").pop().replace(/\.wav$/, "")}.json`));
  const provider = options.provider ?? "whisper";
  let resolvedProvider = provider;
  let resolvedModel = options.model ?? (provider === "mlx" ? "mlx-community/whisper-large-v3-turbo" : "small.en");
  let providerFailure;

  try {
    const cachedJson = await fileExists(jsonPath);
    if (cachedJson && !options.force) {
      const whisperJson = await readWhisperJson(jsonPath);
      const segments = normaliseWhisperJson(whisperJson);
      return {
        ok: segments.length > 0,
        provider: "local-whisper",
        source: {
          kind: "local-whisper",
          provider: resolvedProvider === "mlx" ? "mlx-whisper" : "whisper",
          url: audioUrl,
          fetchedAt: nowIso(),
          model: resolvedModel,
          cachePath: jsonPath,
          clipSeconds: options.clipSeconds,
        },
        segments,
        reason: segments.length > 0 ? undefined : "Cached Whisper file had no usable transcript segments",
      };
    }

    await runCommand(options.ffmpegBinary ?? "ffmpeg", buildFfmpegClipArgs(audioUrl, audioPath, options), {
      timeout: options.ffmpegTimeoutMs ?? 600000,
    });

    if (provider === "mlx") {
      try {
        await runMlxWhisper(runCommand, audioPath, jsonPath, {
          ...options,
          model: resolvedModel,
        });
      } catch (error) {
        providerFailure = summariseFailure(error);
        if (options.fallbackToWhisper === false) {
          throw error;
        }
        resolvedProvider = "whisper";
        resolvedModel = options.fallbackModel ?? "small.en";
        await runOpenAIWhisper(runCommand, audioPath, outputDir, {
          ...options,
          model: resolvedModel,
        });
      }
    } else {
      await runOpenAIWhisper(runCommand, audioPath, outputDir, {
        ...options,
        model: resolvedModel,
      });
    }
  } catch (error) {
    return {
      ok: false,
      provider: "local-whisper",
      reason: summariseFailure(error),
      segments: [],
    };
  }

  const whisperJson = await readWhisperJson(jsonPath);
  if (!options.keepAudio) {
    await rm(audioPath, { force: true });
  }
  const segments = normaliseWhisperJson(whisperJson);
  return {
    ok: segments.length > 0,
    provider: "local-whisper",
    source: {
      kind: "local-whisper",
      provider: resolvedProvider === "mlx" ? "mlx-whisper" : "whisper",
      url: audioUrl,
      fetchedAt: nowIso(),
      model: resolvedModel,
      cachePath: jsonPath,
      clipSeconds: options.clipSeconds,
      fallbackReason: providerFailure,
    },
    segments,
    reason: segments.length > 0 ? undefined : "Whisper produced no usable transcript segments",
  };
}
