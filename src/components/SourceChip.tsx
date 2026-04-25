import { ExternalLink } from "lucide-react";
import type { EpisodeSource, EvidenceSource } from "../domain/types";

interface SourceChipProps {
  episode: EpisodeSource;
  source: EvidenceSource;
}

export function SourceChip({ episode, source }: SourceChipProps) {
  return (
    <a className="source-chip" href={source.officialUrl} target="_blank" rel="noreferrer">
      <span>
        {episode.guest} / {source.timestamp}
      </span>
      <strong>{episode.title}</strong>
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}
