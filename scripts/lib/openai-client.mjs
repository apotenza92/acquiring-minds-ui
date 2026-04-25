import { hasFlag } from "./io.mjs";
import { resolveOpenAIAuth } from "./openai-auth.mjs";

export function assertModelTransmissionAllowed() {
  if (hasFlag("--allow-transmit") || process.env.AMKB_ALLOW_TRANSMIT === "1") {
    return;
  }

  throw new Error(
    "Refusing to transmit transcript material to OpenAI without --allow-transmit or AMKB_ALLOW_TRANSMIT=1.",
  );
}

export async function createOpenAIResponse({ instructions, input, model = process.env.OPENAI_MODEL || "gpt-5.2" }) {
  assertModelTransmissionAllowed();
  const auth = await resolveOpenAIAuth();

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
