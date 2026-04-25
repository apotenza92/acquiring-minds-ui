#!/usr/bin/env node
import { readJsonInput } from "./lib/io.mjs";
import { createOpenAIResponse } from "./lib/openai-client.mjs";

const input = await readJsonInput();
const result = await createOpenAIResponse({
  instructions:
    "Extract broad ETA knowledge-base lessons from podcast transcript material. Return JSON only. Do not include transcript excerpts.",
  input: JSON.stringify(input),
});

if (!result.ok) {
  process.stderr.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(1);
}

process.stdout.write(result.outputText.trim() ? `${result.outputText.trim()}\n` : `${JSON.stringify(result.body, null, 2)}\n`);
