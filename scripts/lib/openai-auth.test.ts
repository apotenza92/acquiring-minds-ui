import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAuthStatus, resolveCodexAuth, resolveOpenAIAuth } from "./openai-auth.mjs";

const originalEnv = { ...process.env };
const tempDirs: string[] = [];

afterEach(async () => {
  process.env = { ...originalEnv };
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("resolveOpenAIAuth", () => {
  it("uses OPENAI_API_KEY without exposing the full value", async () => {
    process.env.OPENAI_API_KEY = "sk-test-1234567890";
    delete process.env.AMKB_OPENAI_AUTH_FILE;

    const auth = await resolveOpenAIAuth();

    expect(auth).toMatchObject({
      type: "api_key",
      source: "OPENAI_API_KEY",
      authorization: "Bearer sk-test-1234567890",
      display: "sk-tes...7890",
    });
  });

  it("reads Codex auth after explicit local auth sources", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amkb-codex-auth-"));
    tempDirs.push(dir);
    const authPath = join(dir, "auth.json");
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const accessToken = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ exp: futureExp })).toString("base64url"),
      "signature",
    ].join(".");
    await writeFile(
      authPath,
      JSON.stringify({
        tokens: {
          access_token: accessToken,
          refresh_token: "refresh-token",
          account_id: "acct_123",
        },
        last_refresh: "2026-04-23T00:00:00.000Z",
      }),
      "utf8",
    );

    delete process.env.OPENAI_API_KEY;
    delete process.env.AMKB_OPENAI_BEARER_TOKEN;
    process.env.AMKB_OPENAI_AUTH_FILE = join(dir, "missing-local-auth.json");
    process.env.CODEX_AUTH_FILE = authPath;

    const auth = await resolveOpenAIAuth();

    expect(auth).toMatchObject({
      type: "codex",
      source: authPath,
      authorization: `Bearer ${accessToken}`,
      status: "valid",
      hasRefreshToken: true,
    });
  });

  it("reports expired Codex auth as actionable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amkb-codex-expired-"));
    tempDirs.push(dir);
    const authPath = join(dir, "auth.json");
    const accessToken = [
      Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
      Buffer.from(JSON.stringify({ exp: 1 })).toString("base64url"),
      "signature",
    ].join(".");
    await writeFile(authPath, JSON.stringify({ tokens: { access_token: accessToken } }), "utf8");

    process.env.CODEX_AUTH_FILE = authPath;

    await expect(resolveCodexAuth()).rejects.toThrow("codex --login");
  });

  it("status output omits raw authorisation credentials", async () => {
    process.env.OPENAI_API_KEY = "sk-test-1234567890";

    const status = await getAuthStatus();

    expect(status).not.toHaveProperty("authorization");
    expect(JSON.stringify(status)).not.toContain("sk-test-1234567890");
  });

  it("reads a local bearer token auth file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amkb-auth-"));
    tempDirs.push(dir);
    const authPath = join(dir, "auth.json");
    await writeFile(
      authPath,
      JSON.stringify({ type: "bearer_token", accessToken: "oauth-token-abcdef1234" }),
      "utf8",
    );

    delete process.env.OPENAI_API_KEY;
    process.env.AMKB_OPENAI_AUTH_FILE = authPath;

    const auth = await resolveOpenAIAuth();

    expect(auth).toMatchObject({
      type: "bearer_token",
      source: authPath,
      authorization: "Bearer oauth-token-abcdef1234",
      display: "oauth-...1234",
    });
  });

  it("returns undefined when no auth is configured", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.AMKB_OPENAI_BEARER_TOKEN;
    process.env.AMKB_OPENAI_AUTH_FILE = join(tmpdir(), "does-not-exist-auth.json");
    process.env.CODEX_AUTH_FILE = join(tmpdir(), "does-not-exist-codex-auth.json");

    await expect(resolveOpenAIAuth()).resolves.toBeUndefined();
  });
});
