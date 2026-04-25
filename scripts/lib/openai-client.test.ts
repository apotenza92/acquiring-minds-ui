import { describe, expect, it } from "vitest";
import { assertModelTransmissionAllowed } from "./openai-client.mjs";

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
});
