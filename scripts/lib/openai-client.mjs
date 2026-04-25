import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasFlag } from "./io.mjs";
import { resolveOpenAIAuth } from "./openai-auth.mjs";

export const reasoningEfforts = new Set(["none", "minimal", "low", "medium", "high"]);
export const llmProviders = new Set(["openai_api", "codex_cli"]);

export function assertModelTransmissionAllowed() {
  if (hasFlag("--allow-transmit") || process.env.AMKB_ALLOW_TRANSMIT === "1") {
    return;
  }

  throw new Error(
    "Refusing to transmit transcript material to OpenAI without --allow-transmit or AMKB_ALLOW_TRANSMIT=1.",
  );
}

export function resolveReasoningEffort(value = process.env.OPENAI_REASONING_EFFORT || "medium") {
  if (!reasoningEfforts.has(value)) {
    throw new Error(
      `Unsupported reasoning effort "${value}". Use one of: ${[...reasoningEfforts].join(", ")}.`,
    );
  }

  return value;
}

export function resolveLlmProvider(value = process.env.AMKB_LLM_PROVIDER || "openai_api") {
  const aliases = {
    api: "openai_api",
    openai: "openai_api",
    responses: "openai_api",
    codex: "codex_cli",
  };
  const resolved = aliases[value] ?? value;
  if (!llmProviders.has(resolved)) {
    throw new Error(
      `Unsupported LLM provider "${value}". Use one of: ${[...llmProviders].join(", ")}.`,
    );
  }
  return resolved;
}

export function isFatalOpenAIAuthError(result) {
  return result?.status === 401 || result?.status === 403 || result?.fatal === true;
}

export async function createOpenAIResponse({
  instructions,
  input,
  model = process.env.OPENAI_MODEL || "gpt-5.5",
  reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "medium",
  provider = process.env.AMKB_LLM_PROVIDER || "openai_api",
}) {
  assertModelTransmissionAllowed();
  const resolvedProvider = resolveLlmProvider(provider);
  const auth = await resolveOpenAIAuth();
  const effort = resolveReasoningEffort(reasoningEffort);

  if (resolvedProvider === "codex_cli") {
    return createCodexCliResponse({ instructions, input, model, reasoningEffort: effort });
  }

  if (!auth) {
    return {
      ok: false,
      disabled: true,
      reason: "No OpenAI auth was found. Run npm run auth:status.",
    };
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: auth.authorization,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      reasoning: {
        effort,
      },
      instructions,
      input,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      provider: resolvedProvider,
      status: response.status,
      body,
    };
  }

  const outputText =
    body.output_text ??
    body.output
      ?.flatMap((item) => item.content ?? [])
      .map((content) => content.text ?? "")
      .join("") ??
    "";

  return {
    ok: true,
    provider: resolvedProvider,
    body,
    outputText,
  };
}

export function buildCodexCliArgs({ model, reasoningEffort, outputPath }) {
  return [
    "exec",
    "--ephemeral",
    "--json",
    "--color",
    "never",
    "-m",
    model,
    "-c",
    `model_reasoning_effort="${reasoningEffort}"`,
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-last-message",
    outputPath,
    "-",
  ];
}

function buildCodexCliPrompt({ instructions, input }) {
  return [
    instructions,
    "",
    "You are running as a batch extraction worker. Do not inspect the filesystem, run shell commands, or ask follow-up questions.",
    "Return the requested JSON only.",
    "",
    "<input>",
    input,
    "</input>",
  ].join("\n");
}

function tail(value, maxLength = 4000) {
  return value.length > maxLength ? value.slice(-maxLength) : value;
}

async function createCodexCliResponse({ instructions, input, model, reasoningEffort }) {
  const tempDir = await mkdtemp(join(tmpdir(), "amkb-codex-cli-"));
  const outputPath = join(tempDir, "last-message.txt");
  const args = buildCodexCliArgs({ model, reasoningEffort, outputPath });
  const timeoutMs = Number(process.env.AMKB_CODEX_CLI_TIMEOUT_MS || 1_200_000);
  const prompt = buildCodexCliPrompt({ instructions, input });

  try {
    const result = await new Promise((resolve) => {
      const child = spawn("codex", args, {
        cwd: process.cwd(),
        env: { ...process.env, NO_COLOR: "1" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill("SIGTERM");
        resolve({
          ok: false,
          fatal: true,
          status: "codex_cli_timeout",
          body: { stderr: tail(stderr), stdout: tail(stdout), timeoutMs },
        });
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
          ok: false,
          fatal: true,
          status: "codex_cli_spawn_failed",
          body: { error: error.message, stderr: tail(stderr), stdout: tail(stdout) },
        });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });

      child.stdin.end(prompt);
    });

    if (result.ok === false) {
      return { provider: "codex_cli", ...result };
    }

    if (result.code !== 0) {
      return {
        ok: false,
        provider: "codex_cli",
        fatal: true,
        status: `codex_cli_exit_${result.code}`,
        body: { stderr: tail(result.stderr), stdout: tail(result.stdout) },
      };
    }

    const outputText = await readFile(outputPath, "utf8");
    if (!outputText.trim()) {
      return {
        ok: false,
        provider: "codex_cli",
        fatal: true,
        status: "codex_cli_empty_output",
        body: { stderr: tail(result.stderr), stdout: tail(result.stdout) },
      };
    }

    return {
      ok: true,
      provider: "codex_cli",
      body: { stderr: tail(result.stderr), stdout: tail(result.stdout) },
      outputText,
    };
  } finally {
    if (process.env.AMKB_KEEP_CODEX_TMP !== "1") {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}
