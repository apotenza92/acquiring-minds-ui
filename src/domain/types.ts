export type LessonCategoryId =
  | "buyer-fit"
  | "sourcing"
  | "deal-evaluation"
  | "financing-terms"
  | "due-diligence"
  | "closing-transition"
  | "operating"
  | "growth"
  | "risk-failure"
  | "exit-long-term-hold";

export type TranscriptAvailability = "official" | "youtube-auto" | "local-whisper" | "summary-only" | "unknown";

export interface PodcastSource {
  id: string;
  title: string;
  host: string;
  officialUrl: string;
  episodeIndexUrl: string;
  adapters: string[];
}

export interface EpisodeSource {
  id: string;
  podcastId: string;
  title: string;
  guest: string;
  date: string;
  officialUrl: string;
  youtubeUrl?: string;
  audioUrl?: string;
  transcriptAvailability: TranscriptAvailability;
}

export interface EvidenceSource {
  episodeId: string;
  timestamp: string;
  officialUrl: string;
  youtubeUrl?: string;
  audioUrl?: string;
}

export interface Lesson {
  id: string;
  title: string;
  category: LessonCategoryId;
  summary: string;
  playbook: string[];
  tags: string[];
  evidence: EvidenceSource[];
}

export interface KnowledgeBase {
  podcast: PodcastSource;
  episodes: EpisodeSource[];
  lessons: Lesson[];
}

export interface LessonCategory {
  id: LessonCategoryId;
  label: string;
}
