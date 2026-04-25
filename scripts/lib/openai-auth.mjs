import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const defaultAuthPath = join(homedir(), ".config", "acquiring-minds-kb", "auth.json");
const defaultCodexAuthPath = join(homedir(), ".codex", "auth.json");

function redact(value) {
  if (!value) {
    return "";
  }

  if (value.length <= 12) {
    return "***";
  }

  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

async function readJsonFile(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function decodeJwtPayload(token) {
  const [, payload] = token.split(".");
  if (!payload) {
    return undefined;
  }

  try {
    const normalised = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(normalised, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

function expiryStatus(expiresAt) {
  if (!expiresAt) {
    return "unknown";
  }

  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) {
    return "unknown";
  }

  if (expiryMs <= Date.now()) {
    return "expired";
  }

  return "valid";
}

export async function resolveCodexAuth({ includeCredential = true } = {}) {
  const authPath = process.env.CODEX_AUTH_FILE || defaultCodexAuthPath;
  const authFile = await readJsonFile(authPath);

  if (!authFile) {
    return undefined;
  }

  const accessToken = authFile.tokens?.access_token;
  const refreshToken = authFile.tokens?.refresh_token;

  if (!accessToken || typeof accessToken !== "string") {
    throw new Error(`Codex auth at ${authPath} does not contain tokens.access_token. Run codex --login.`);
  }

  const payload = decodeJwtPayload(accessToken);
  const expiresAt = payload?.exp ? new Date(payload.exp * 1000).toISOString() : undefined;
  const status = expiryStatus(expiresAt);

  if (status === "expired") {
    throw new Error(`Codex auth at ${authPath} is expired. Run codex --login.`);
  }

  return {
    type: "codex",
    source: authPath,
    authorization: includeCredential ? `Bearer ${accessToken}` : undefined,
    display: redact(accessToken),
    status,
    expiresAt,
    lastRefresh: authFile.last_refresh,
    hasRefreshToken: typeof refreshToken === "string" && refreshToken.length > 0,
    accountId: authFile.tokens?.account_id,
  };
}

export async function resolveOpenAIAuth() {
  if (process.env.OPENAI_API_KEY) {
    return {
      type: "api_key",
      source: "OPENAI_API_KEY",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      display: redact(process.env.OPENAI_API_KEY),
      status: "unknown",
    };
  }

  if (process.env.AMKB_OPENAI_BEARER_TOKEN) {
    return {
      type: "bearer_token",
      source: "AMKB_OPENAI_BEARER_TOKEN",
      authorization: `Bearer ${process.env.AMKB_OPENAI_BEARER_TOKEN}`,
      display: redact(process.env.AMKB_OPENAI_BEARER_TOKEN),
      status: "unknown",
    };
  }

  const authPath = process.env.AMKB_OPENAI_AUTH_FILE || defaultAuthPath;
  const authFile = await readJsonFile(authPath);

  if (!authFile) {
    return resolveCodexAuth();
  }

  if (authFile.type === "api_key" && authFile.apiKey) {
    return {
      type: "api_key",
      source: authPath,
      authorization: `Bearer ${authFile.apiKey}`,
      display: redact(authFile.apiKey),
      status: "unknown",
    };
  }

  if (authFile.type === "bearer_token" && authFile.accessToken) {
    return {
      type: "bearer_token",
      source: authPath,
      authorization: `Bearer ${authFile.accessToken}`,
      display: redact(authFile.accessToken),
      status: "unknown",
    };
  }

  if (authFile) {
    throw new Error(
      `Unsupported auth file at ${authPath}. Use {"type":"api_key","apiKey":"..."} or {"type":"bearer_token","accessToken":"..."}.`,
    );
  }

  return resolveCodexAuth();
}

export async function getAuthStatus() {
  const auth = await resolveOpenAIAuth();
  if (!auth) {
    return authHelp();
  }

  return {
    ok: true,
    type: auth.type,
    source: auth.source,
    credential: auth.display,
    status: auth.status,
    expiresAt: auth.expiresAt,
    lastRefresh: auth.lastRefresh,
    hasRefreshToken: auth.hasRefreshToken,
  };
}

export function authHelp() {
  return {
    ok: false,
    disabled: true,
    reason:
      "No OpenAI auth was found. Use OPENAI_API_KEY, AMKB_OPENAI_BEARER_TOKEN, a local auth file outside the repo, or run codex --login.",
    authFile: defaultAuthPath,
    codexAuthFile: defaultCodexAuthPath,
    authFileFormats: [
      { type: "api_key", apiKey: "..." },
      { type: "bearer_token", accessToken: "..." },
    ],
    note: "Do not store ChatGPT usernames or passwords. Use a browser-confirmed OAuth/login flow from a trusted tool, then store only the resulting token/key outside the project.",
  };
}
