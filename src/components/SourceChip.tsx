import { ExternalLink } from "lucide-react";
import type { EpisodeSource, EvidenceSource } from "../domain/types";

interface SourceChipProps {
  episode: EpisodeSource;
  source: EvidenceSource;
}

function formatDiscussionTime(timestamp: string) {
  const match = timestamp.match(/^(\d{2}):(\d{2}):(\d{2})$/);

  if (!match) {
    return `Discussed around ${timestamp}`;
  }

  const [, hoursRaw, minutesRaw, secondsRaw] = match;
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  const seconds = Number(secondsRaw);

  if (seconds !== 0) {
    return `Discussed around ${timestamp}`;
  }

  const parts = [
    hours > 0 ? `${hours} ${hours === 1 ? "hour" : "hours"}` : undefined,
    minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"}` : undefined,
  ].filter(Boolean);

  return parts.length > 0 ? `Discussed at around ${parts.join(" ")}` : "Discussed at the start";
}

export function SourceChip({ episode, source }: SourceChipProps) {
  const href = source.youtubeUrl ?? source.officialUrl ?? source.audioUrl;
  const discussionTime = formatDiscussionTime(source.timestamp);

  return (
    <a
      className="source-chip"
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={`${episode.title}, ${episode.guest}, ${discussionTime.toLowerCase()}`}
    >
      <span>{episode.guest}</span>
      <strong>{episode.title}</strong>
      <small>{discussionTime}</small>
      <ExternalLink aria-hidden="true" size={14} />
    </a>
  );
}
