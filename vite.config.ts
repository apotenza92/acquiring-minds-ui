/// <reference types="vitest" />

import react from "@vitejs/plugin-react";
import { defineConfig, type UserConfig } from "vite";

interface VitestUserConfig extends UserConfig {
  test: {
    environment: string;
    globals: boolean;
    setupFiles: string;
    exclude: string[];
  };
}

function pagesBase() {
  if (process.env.VITE_BASE_PATH) {
    return process.env.VITE_BASE_PATH;
  }

  const repository = process.env.GITHUB_REPOSITORY;
  if (!repository) {
    return "/";
  }

  const [, repoName] = repository.split("/");
  return repoName ? `/${repoName}/` : "/";
}

export default defineConfig({
  base: pagesBase(),
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./vitest.setup.ts",
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**"],
  },
} as VitestUserConfig);
