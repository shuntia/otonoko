import { AudioPlayerPlayingState, AudioPlayerStatus } from "@discordjs/voice";
import type { GuildMusicState } from "./manager.js";

function clampToTrackDuration(elapsedMs: number, state: GuildMusicState): number {
  const durationMs = state.current?.durationMs ?? 0;
  if (durationMs <= 0) return Math.max(0, elapsedMs);
  return Math.max(0, Math.min(elapsedMs, durationMs));
}

export function getPlaybackElapsedMs(state: GuildMusicState): number {
  const playerState = state.player.state;
  const hasResourceState =
    playerState.status === AudioPlayerStatus.Playing ||
    playerState.status === AudioPlayerStatus.Buffering ||
    playerState.status === AudioPlayerStatus.Paused ||
    playerState.status === AudioPlayerStatus.AutoPaused;

  if (hasResourceState) {
    const resourceDuration = (playerState as AudioPlayerPlayingState).resource?.playbackDuration;
    if (typeof resourceDuration === "number" && Number.isFinite(resourceDuration)) {
      return clampToTrackDuration(state.playbackBaseOffsetMs + resourceDuration, state);
    }
  }

  if (!state.currentStartedAt) return 0;
  return clampToTrackDuration((state.pausedAt ?? Date.now()) - state.currentStartedAt, state);
}

export function getPlaybackElapsedSeconds(state: GuildMusicState): number {
  return getPlaybackElapsedMs(state) / 1000;
}
