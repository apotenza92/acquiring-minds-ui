import { afterEach, describe, expect, it, vi } from "vitest";
import { assertModelTransmissionAllowed, createOpenAIResponse, resolveReasoningEffort } from "./openai-client.mjs";

const originalFetch = globalThis.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = originalFetch;
  delete process.env.AMKB_ALLOW_TRANSMIT;
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_REASONING_EFFORT;
  delete process.env.AMKB_OPENAI_AUTH_FILE;
  delete process.env.CODEX_AUTH_FILE;
});

describe("OpenAI client safety gate", () => {
  it("blocks transcript transmission unless explicitly enabled", () => {
    const oldValue = process.env.AMKB_ALLOW_TRANSMIT;
    delete process.env.AMKB_ALLOW_TRANSMIT;

    expect(() => assertModelTransmissionAllowed()).toThrow("--allow-transmit");

    process.env.AMKB_ALLOW_TRANSMIT = oldValue;
  });

  it("allows transcript transmission when the env gate is set", () => {
    const oldValue = process.env.AMKB_ALLOW_TRANSMIT;
    process.env.AMKB_ALLOW_TRANSMIT = "1";

    expect(() => assertModelTransmissionAllowed()).not.toThrow();

    if (oldValue === undefined) {
      delete process.env.AMKB_ALLOW_TRANSMIT;
    } else {
      process.env.AMKB_ALLOW_TRANSMIT = oldValue;
    }
  });

  it("validates supported reasoning efforts", () => {
    expect(resolveReasoningEffort("low")).toBe("low");
    expect(resolveReasoningEffort("xhigh")).toBe("xhigh");
    expect(() => resolveReasoningEffort("lots")).toThrow("Unsupported reasoning effort");
  });

  it("sends reasoning effort with Responses API requests", async () => {
    process.env.AMKB_ALLOW_TRANSMIT = "1";
    process.env.OPENAI_API_KEY = "sk-test-1234567890";
    process.env.AMKB_OPENAI_AUTH_FILE = "/tmp/no-local-auth.json";
    process.env.CODEX_AUTH_FILE = "/tmp/no-codex-auth.json";

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ output_text: "{\"ok\":true}" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const result = await createOpenAIResponse({
      model: "gpt-5.5",
      reasoningEffort: "high",
      instructions: "Return JSON.",
      input: "{}",
    });

    expect(result.ok).toBe(true);
    const [, request] = vi.mocked(fetchMock).mock.calls[0];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      model: "gpt-5.5",
      reasoning: {
        effort: "high",
      },
    });
  });
});
