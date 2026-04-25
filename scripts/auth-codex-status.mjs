#!/usr/bin/env node
import { resolveCodexAuth } from "./lib/openai-auth.mjs";
import { writeJson } from "./lib/io.mjs";

const auth = await resolveCodexAuth({ includeCredential: false });

if (!auth) {
  writeJson({
    ok: false,
    reason: "Codex auth was not found. Run codex --login.",
  });
} else {
  writeJson({
    ok: true,
    type: auth.type,
    source: auth.source,
    credential: auth.display,
    status: auth.status,
    expiresAt: auth.expiresAt,
    lastRefresh: auth.lastRefresh,
    hasRefreshToken: auth.hasRefreshToken,
  });
}
