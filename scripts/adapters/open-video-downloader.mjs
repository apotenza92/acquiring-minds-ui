import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

function appSupportDir(homeDir = process.env.HOME) {
  return join(homeDir, "Library", "Application Support", "com.jelleglebbeek.youtube-dl-gui");
}

function normaliseSubtitleFormats(formats) {
  return (Array.isArray(formats) ? formats : [])
    .map((format) => String(format).trim().toLowerCase())
    .filter(Boolean)
    .map((format) => (format === "json" ? "json3" : format))
    .join("/");
}

function normaliseSubtitleLanguages(languages) {
  return (Array.isArray(languages) ? languages : [])
    .map((language) => String(language).trim())
    .filter(Boolean)
    .map((language) => {
      if (language === "all" || language.includes("*") || language.startsWith("-")) {
        return language;
      }
      return `${language}.*`;
    })
    .join(",");
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readOpenVideoDownloaderDefaults(options = {}) {
  const baseDir = options.baseDir ?? appSupportDir(options.homeDir);
  const binary = join(baseDir, "bin", "yt-dlp");
  const configPath = join(baseDir, "config.store.json");
  const defaults = {};

  if (await fileExists(binary)) {
    defaults.binary = binary;
  }

  if (!(await fileExists(configPath))) {
    return defaults;
  }

  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const config = parsed.config ?? {};
  const auth = config.auth ?? {};
  const subtitles = config.subtitles ?? {};

  if (auth.cookieBrowser && auth.cookieBrowser !== "none") {
    defaults.cookiesFromBrowser = auth.cookieBrowser;
  }
  if (auth.cookieFile) {
    defaults.cookieFile = auth.cookieFile;
  }
  if (subtitles.enabled) {
    const subFormats = normaliseSubtitleFormats(subtitles.formatPreference);
    const subLanguages = normaliseSubtitleLanguages(subtitles.languages);
    if (subFormats) {
      defaults.subFormats = subFormats;
    }
    if (subLanguages) {
      defaults.subLanguages = subLanguages;
    }
  }

  return defaults;
}
