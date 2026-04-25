import { hasFlag } from "./io.mjs";
import { resolveOpenAIAuth } from "./openai-auth.mjs";

export const reasoningEfforts = new Set(["none", "minimal", "low", "medium", "high"]);

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

export function isFatalOpenAIAuthError(result) {
  return result?.status === 401 || result?.status === 403;
}

export async function createOpenAIResponse({
  instructions,
  input,
  model = process.env.OPENAI_MODEL || "gpt-5.5",
  reasoningEffort = process.env.OPENAI_REASONING_EFFORT || "medium",
}) {
  assertModelTransmissionAllowed();
  const auth = await resolveOpenAIAuth();
  const effort = resolveReasoningEffort(reasoningEffort);

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
    body,
    outputText,
  };
}
