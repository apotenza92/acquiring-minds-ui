import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
}

export function getNumberArg(name, defaultValue) {
  const value = getArg(name);
  if (value === undefined) {
    return defaultValue;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number`);
  }
  return number;
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

export async function readTextInput() {
  const inputPath = getArg("--input");
  if (inputPath) {
    return readFile(inputPath, "utf8");
  }

  if (process.stdin.isTTY) {
    return "";
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonInput() {
  const text = await readTextInput();
  if (!text.trim()) {
    throw new Error("Expected JSON from stdin or --input");
  }
  return JSON.parse(text);
}

export async function readJsonFile(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function writeTextFile(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf8");
}

export async function writeJsonFile(path, value) {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nowIso() {
  return new Date().toISOString();
}
