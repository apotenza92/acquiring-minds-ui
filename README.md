# Acquiring Minds Knowledge Base

Minimal knowledge-base UI for learning from Acquiring Minds across ETA themes rather than episode order.

## Run

```sh
npm install
npm run dev
```

## Static Deployment

The public knowledge base can be hosted on GitHub Pages as a read-only static Vite site. The deployed artefact is only `dist/`; `.corpus/`, SQLite databases, auth files, browser cookies, transcripts, and LLM extraction scripts are not part of the browser bundle.

The Pages workflow runs on pushes to `main` or `master` and can also be triggered manually:

```sh
npm ci
npm run validate:data
npm test
npm audit --audit-level=moderate
npm run check:public-bundle
npm run build
```

For a project page like `https://USERNAME.github.io/REPO_NAME/`, the workflow automatically sets Vite's base path from `GITHUB_REPOSITORY`. For a custom domain or user page, override it with:

```sh
VITE_BASE_PATH=/ npm run build
```

In the GitHub repository settings, set **Pages > Build and deployment > Source** to **GitHub Actions**.

## Data

The app renders curated lesson JSON from `src/data/acquiring-minds.lessons.json`. Full transcript text is not imported into the UI.

## Pipeline

Each pipeline command reads from stdin or `--input` and writes to stdout.

```sh
npm run pipeline:discover -- --input saved-episodes.html
npm run pipeline:fetch -- --input episodes.json
npm run pipeline:normalise -- --input fetched-pages.json
npm run pipeline:prompt -- --input normalised-transcripts.json
```

## Corpus

Transcript gathering writes to `.corpus/`, which is gitignored and kept out of the UI bundle.

```sh
npm run corpus:gather
npm run corpus:db:init
npm run corpus:db:import-json
npm run corpus:rss-enrich
npm run corpus:youtube-resolve
npm run corpus:youtube-fallback
npm run corpus:transcribe-local
npm run corpus:fill-transcripts
npm run corpus:db:export-json
npm run corpus:coverage
npm run corpus:sample
```

`corpus:gather` discovers the official Acquiring Minds archive, caches raw episode HTML, writes one normalised transcript document per episode, and writes a coverage report.

`corpus:rss-enrich` reads the Transistor RSS feed and attaches audio enclosure URLs to corpus episodes. Acquiring Minds currently has audio enclosures for all discovered episodes, but no RSS transcript tags.

`corpus:db:init` creates `.corpus/acquiring-minds/corpus.sqlite`. `corpus:db:import-json` loads the existing JSON corpus into SQLite, and `corpus:db:export-json` regenerates JSON transcript files from SQLite for compatibility with older commands.

`corpus:youtube-resolve` uses official page links first and then `yt-dlp` search scoped to the Acquiring Minds channel to attach likely YouTube URLs to missing episodes. It records ambiguous or low-confidence results instead of guessing, and skips previously failed searches unless `--retry-failed` or `--force` is passed.

`corpus:youtube-fallback` only processes transcript gaps. It uses resolved YouTube URLs when available, can resolve a URL before fetching captions, and records ambiguous, missing, or timed-out YouTube results instead of guessing.

`corpus:fill-transcripts` is the resumable one-by-one backfill runner. It stores transcript attempts, source metadata, jobs, and segments in SQLite. By default it processes one missing episode and exits:

```sh
npm run corpus:fill-transcripts
npm run corpus:fill-transcripts -- --episode-id will-smith-acquiring-minds
npm run corpus:fill-transcripts -- --all --concurrency 1
```

The YouTube fallback supports two providers:

```sh
npm run corpus:youtube-fallback -- --provider ytdlp,direct
npm run corpus:youtube-fallback -- --episode-id alex-mears-brydon-group --force
npm run corpus:youtube-fallback -- --provider ytdlp --cookies-from-browser brave --sleep-subtitles-ms 125000
npm run corpus:youtube-fallback -- --provider ytdlp --cookies /path/to/cookies.txt --sub-format json3/vtt/srt
npm run corpus:youtube-fallback -- --provider ytdlp --use-open-video-downloader
```

- `ytdlp` shells out to `yt-dlp`, caches supported caption files under `.corpus/acquiring-minds/youtube-captions/`, and normalises `json3`, `vtt`, and `srt` captions into the shared transcript schema.
- `direct` fetches caption tracks from the YouTube watch HTML and timedtext endpoints.
- `--episode-id` is useful for targeted retries.
- `--cookies-from-browser` and `--cookies` mirror Open Video Downloader's logged-in browser/cookies workflow.
- `--use-open-video-downloader` reuses Open Video Downloader's local `yt-dlp` binary and configured subtitle/cookie settings when that app is installed.
- YouTube may still block auto-caption downloads with HTTP 429, even when metadata shows captions exist. Those failures are recorded in coverage instead of being treated as successful transcripts.

For future podcasts, prefer official pages and RSS-hosted Podcasting 2.0 transcript tags before YouTube. The Acquiring Minds Transistor RSS feed currently exposes show notes and media enclosures, but not `podcast:transcript` entries.

When official transcripts and YouTube captions are unavailable, local Whisper transcription can fill the remaining corpus from RSS audio. Use `--sample-only` with `--clip-seconds` to test without marking a partial clip as a complete transcript:

```sh
npm run corpus:transcribe-local -- --episode-id alex-mears-brydon-group --clip-start-seconds 120 --clip-seconds 45 --model tiny --sample-only --force
```

Run the full local transcription pass only without clipping:

```sh
npm run corpus:transcribe-local -- --model tiny
```

`npm run pipeline:openai` is intentionally disabled unless OpenAI auth is available.

Supported auth sources:

- `OPENAI_API_KEY`
- `AMKB_OPENAI_BEARER_TOKEN`
- `AMKB_OPENAI_AUTH_FILE`, or `~/.config/acquiring-minds-kb/auth.json`
- existing Codex auth from `~/.codex/auth.json`

Auth files must live outside the repo and use one of these shapes:

```json
{ "type": "api_key", "apiKey": "..." }
```

```json
{ "type": "bearer_token", "accessToken": "..." }
```

Check detected auth without printing secrets:

```sh
npm run auth:status
npm run auth:codex:status
```

Do not store ChatGPT usernames or passwords. Tools that support subscription-style login typically use browser-confirmed OAuth and store the resulting local token/key, not the account password.

Model-backed extraction requires an explicit transmission flag because it sends transcript material to OpenAI. Lesson generation is staged so raw transcripts are used only in `.corpus/` processing, while the UI receives reviewed lesson summaries and source chips only.

```sh
npm run lessons:extract-episodes -- --sample 20 --allow-transmit
npm run lessons:cluster -- --sample 20 --allow-transmit
npm run lessons:promote -- --input .corpus/acquiring-minds/extractions/reviewed-lessons.json
```

`lessons:extract-episodes` reads transcript segments from SQLite, chunks each episode, and writes one structured extraction JSON per episode under `.corpus/acquiring-minds/extractions/episodes/`. It supports `--episode-id`, `--sample`, `--limit`, `--all`, `--force`, `--retry-failed`, `--dry-run`, and `--episode-model`. The default episode model is `AMKB_EPISODE_MODEL` or `gpt-5.5`.

`lessons:cluster` reads episode extraction JSON only, groups lesson candidates by ETA category, and writes cluster drafts under `.corpus/acquiring-minds/extractions/clusters/`. It supports `--sample`, `--limit`, `--all`, `--force`, `--retry-failed`, `--dry-run`, `--cluster-model`, and `--max-candidates-per-category`. The default cluster model is `AMKB_CLUSTER_MODEL` or `gpt-5.5`.

`lessons:promote` validates a reviewed cluster file and replaces the curated UI lesson dataset only after that review step. Generated clusters are not promoted automatically.
