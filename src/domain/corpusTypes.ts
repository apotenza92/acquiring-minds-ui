import type { TranscriptAvailability } from "./types";

export type TranscriptSourceKind = "official" | "rss-transcript" | "youtube-auto" | "local-whisper" | "summary-only" | "missing";

export interface TranscriptSource {
  kind: TranscriptSourceKind;
  provider?: string;
  url?: string;
  fetchedAt?: string;
  status?: number;
  reason?: string;
  model?: string;
  cachePath?: string;
  candidates?: string[];
}

export interface TranscriptSegment {
  id: string;
  start: string;
  end?: string;
  text: string;
  speaker?: string;
  source: TranscriptSourceKind;
}

export interface CorpusEpisode {
  id: string;
  podcastId: "acquiring-minds";
  title: string;
  guest: string;
  date: string;
  officialUrl: string;
  youtubeUrl?: string;
  audioUrl?: string;
  rssGuid?: string;
  rssPublishedAt?: string;
  transcriptAvailability: TranscriptAvailability;
}

export interface TranscriptDocument {
  episode: CorpusEpisode;
  sources: TranscriptSource[];
  showNotes: string[];
  highlights: string[];
  segments: TranscriptSegment[];
  generatedAt: string;
}

export interface CoverageReport {
  generatedAt: string;
  totalEpisodes: number;
  officialTranscripts: number;
  rssTranscripts: number;
  youtubeAutoCaptions: number;
  localWhisperTranscripts: number;
  summaryOnly: number;
  missing: number;
  parseFailures: number;
  unresolvedYouTube: number;
  failed?: number;
  remaining?: number;
  episodes: Array<{
    episodeId: string;
    title: string;
    status: TranscriptSourceKind | "parse-failed";
    segmentCount: number;
    officialUrl: string;
    youtubeUrl?: string;
    audioUrl?: string;
    reason?: string;
  }>;
}
