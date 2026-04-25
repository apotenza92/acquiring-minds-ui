import { ExternalLink } from "lucide-react";
import type { EpisodeSource, EvidenceSource } from "../domain/types";

interface SourceChipProps {
  episode: EpisodeSource;
  source: EvidenceSource;
}

export function SourceChip({ episode, source }: SourceChipProps) {
  const href = source.youtubeUrl ?? source.officialUrl ?? source.audioUrl;

  return (
    <a
      className="source-chip"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${episode.title}, ${episode.guest}, transcript time ${source.timestamp}`}
    >
      <span>{episode.guest}</span>
      <strong>{episode.title}</strong>
      <small>Transcript time {source.timestamp}</small>
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}
