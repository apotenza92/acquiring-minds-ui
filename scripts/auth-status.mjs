#!/usr/bin/env node
import { getAuthStatus } from "./lib/openai-auth.mjs";
import { writeJson } from "./lib/io.mjs";

writeJson(await getAuthStatus());
