import { Track } from "./manager.js";
import { extractPlaylistId, extractVideoId, getYoutubeClient } from "./youtube.js";
import play from "play-dl";

import { log } from "../logger.js";

export interface ResolveResult {
  track: Track | null;
  needsConfirmation: boolean;
  candidates?: Track[];
  message?: string;
}

export interface ResolvePlaylistResult {
  tracks: Track[];
  title?: string;
  totalItems?: number;
  skipped: number;
  message?: string;
}

const YT_REGEX = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\//i;
const SPOTIFY_REGEX = /^(https?:\/\/)?(open\.spotify\.com|spotify:)(:[a-zA-Z0-9]+)?/i;

interface YouTubeThumbnail {
  url: string;
  width: number;
  height: number;
}

interface YouTubeVideoInfo {
  title?: string;
  length_seconds?: string | number;
  thumbnail?: YouTubeThumbnail[];
  thumbnails?: YouTubeThumbnail[];
  is_live?: boolean;
  is_live_content?: boolean;
  is_low_latency_live_stream?: boolean;
  is_upcoming?: boolean;
}

interface YouTubeSearchResult {
  id?: string;
  video_id?: string;
  videoId?: string;
  title?: string;
  name?: string;
  duration?: { seconds?: number; seconds_text?: string } | null;
  duration_seconds?: number;
  thumbnails?: YouTubeThumbnail[];
  thumbnail?: { url: string };
}

interface PlaylistInfo {
  title?: { toString?: () => string } | string;
  total_items?: string;
}

interface PlaylistItem {
  id?: string;
  video_id?: string;
  videoId?: string;
  is_playable?: boolean;
  is_live?: boolean;
  is_upcoming?: boolean;
  title?: { toString?: () => string } | string;
  duration?: { seconds?: number };
  thumbnails?: { url?: string }[];
  thumbnail?: { url?: string };
}

interface PlaylistPage {
  info?: PlaylistInfo;
  items?: PlaylistItem[];
  has_continuation?: boolean;
  getContinuation?: () => Promise<PlaylistPage>;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyTrack {
  type: "track";
  name: string;
  artists: SpotifyArtist[];
  durationInSec: number;
  thumbnail?: { url?: string };
}

interface SpotifyCollection {
  type: "playlist" | "album";
  fetched_tracks: Map<string, SpotifyTrack[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getType(value: unknown): string | undefined {
  return isRecord(value) && typeof value.type === "string" ? value.type : undefined;
}

function isSpotifyTrack(value: unknown): value is SpotifyTrack {
  if (!isRecord(value)) return false;
  return value.type === "track" && typeof value.name === "string";
}

function isSpotifyCollection(value: unknown): value is SpotifyCollection {
  if (!isRecord(value)) return false;
  return (value.type === "playlist" || value.type === "album") && value.fetched_tracks instanceof Map;
}

export async function resolveYoutubePlaylist(input: string): Promise<ResolvePlaylistResult | null> {
  const playlistId = extractPlaylistId(input);
  if (!playlistId) return null;
  const yt = await getYoutubeClient();

  try {
    let playlist = (await yt.getPlaylist(playlistId)) as PlaylistPage;
    const titleRaw = playlist.info?.title;
    const title =
      typeof titleRaw === "string"
        ? titleRaw
        : typeof titleRaw?.toString === "function"
          ? titleRaw.toString()
          : undefined;
    const totalRaw = playlist.info?.total_items;
    const totalItems = typeof totalRaw === "string" ? parseInt(totalRaw.replace(/[^\d]/g, ""), 10) : undefined;
    const tracks: Track[] = [];
    let skipped = 0;

    const collect = (page: PlaylistPage) => {
      for (const item of page.items ?? []) {
        const videoId = item?.id ?? item?.video_id ?? item?.videoId;
        if (!videoId) {
          skipped++;
          continue;
        }
        if (item?.is_playable === false || item?.is_live || item?.is_upcoming) {
          skipped++;
          continue;
        }
        const name = typeof item?.title?.toString === "function" ? item.title.toString() : item?.title;
        const durationSec = Number(item?.duration?.seconds ?? 0);
        const thumb = item?.thumbnails?.[0]?.url ?? item?.thumbnail?.url;
        tracks.push({
          title: String(name ?? "Unknown title"),
          url: `https://www.youtube.com/watch?v=${videoId}`,
          durationMs: Number.isFinite(durationSec) ? durationSec * 1000 : 0,
          thumbnail: thumb,
        });
      }
    };

    collect(playlist);
    while (playlist.has_continuation && playlist.getContinuation) {
      playlist = await playlist.getContinuation();
      collect(playlist);
    }

    return { tracks, title, totalItems, skipped };
  } catch (err) {
    log.warn("YouTube playlist resolution failed", err);
    return {
      tracks: [],
      skipped: 0,
      message: "YouTube playlist resolution failed: " + (err as Error).message,
    };
  }
}

export async function resolveTrack(input: string, source: string = "youtube"): Promise<ResolveResult> {
  const isUrl = YT_REGEX.test(input);
  const isSpotify = SPOTIFY_REGEX.test(input);
  const yt = await getYoutubeClient();

  // If explicit source is spotify or input is spotify url
  if (source === "spotify" || isSpotify) {
    if (play.is_expired()) {
      await play.refreshToken();
    }
    try {
      // If input is not a URL but source is spotify, search spotify
      let data: unknown;
      if (!isSpotify && !input.startsWith("http")) {
         const results = await play.search(input, { source: { spotify: "track" }, limit: 1 });
         if (results.length > 0) data = results[0];
      } else {
         data = await play.spotify(input);
      }

      if (isSpotifyTrack(data)) {
        const track = data;
        const artist = track.artists?.[0]?.name ?? "";
        const search = await play.search(`${track.name} ${artist}`, { limit: 1, source: { youtube: "video" } });
        if (search.length > 0) {
           return {
            track: {
              title: `${track.name} - ${track.artists[0]?.name}`,
              url: search[0].url,
              durationMs: track.durationInSec * 1000,
              thumbnail: track.thumbnail?.url,
            },
            needsConfirmation: false,
          };
        }
      } else if (isSpotifyCollection(data)) {
         const tracks = data.fetched_tracks.get("1");
         if (tracks && tracks.length > 0) {
            const first = tracks[0];
            const artist = first.artists?.[0]?.name ?? "";
            const search = await play.search(`${first.name} ${artist}`, { limit: 1, source: { youtube: "video" } });
            if (search.length > 0) {
               return {
                track: {
                  title: `${first.name} - ${first.artists[0]?.name}`,
                  url: search[0].url,
                  durationMs: first.durationInSec * 1000,
                  thumbnail: first.thumbnail?.url,
                },
                needsConfirmation: false,
                message: `Queued first track of ${getType(data)}. Full playlist import not supported in single track mode.`,
              };
            }
         }
      }
    } catch (err) {
      log.warn("Spotify resolution failed", err);
      return { track: null, needsConfirmation: false, message: "Spotify resolution failed: " + (err as Error).message };
    }
  }
  
  // SoundCloud support
  if (source === "soundcloud") {
     try {
       const results = await play.search(input, { source: { soundcloud: "tracks" }, limit: 1 });
       if (results.length > 0) {
         const track = results[0];
         return {
           track: {
             title: track.name,
             url: track.url,
             durationMs: track.durationInSec * 1000,
             thumbnail: track.thumbnail,
           },
           needsConfirmation: false
         };
       }
     } catch (err) {
       log.warn("SoundCloud resolution failed", err);
       return { track: null, needsConfirmation: false, message: "SoundCloud resolution failed: " + (err as Error).message };
     }
  }

  if (isUrl) {
    const videoId = extractVideoId(input);
    if (!videoId) throw new Error("Could not extract video id from URL");
    const info = await yt.getInfo(videoId);
    const basic = (info.basic_info ?? info) as YouTubeVideoInfo;
    const hasHls = Boolean((info as { streaming_data?: { hls_manifest_url?: string } }).streaming_data?.hls_manifest_url);
    if (basic.is_live || basic.is_live_content || basic.is_low_latency_live_stream || basic.is_upcoming || hasHls) {
      return { track: null, needsConfirmation: false, message: "Live or upcoming streams are not supported." };
    }
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const thumb = basic.thumbnail?.[0]?.url ?? basic.thumbnails?.[0]?.url;
    return {
      track: {
        title: String(basic.title ?? "Unknown title"),
        url,
        durationMs: Number(basic.length_seconds ?? (basic as any).duration ?? 0) * 1000,
        thumbnail: thumb,
      },
      needsConfirmation: false,
    };
  }

  let candidates: Track[] = [];
  try {
    const searchResponse = await yt.search(input, { type: "video" });
    const results = Array.isArray(searchResponse)
      ? searchResponse
      : ((searchResponse as { results?: YouTubeSearchResult[] }).results ?? []);
    
    const list = results?.slice?.(0, 5) ?? [];
    candidates = list
      .map((r): Track | null => {
        const vid = r.id ?? r.video_id ?? r.videoId;
        if (!vid) return null;
        const url = `https://www.youtube.com/watch?v=${vid}`;
        const dur = r.duration?.seconds ?? (r.duration?.seconds_text ? parseDuration(r.duration.seconds_text) : (r.duration_seconds ?? 0));
        const thumb = r.thumbnails?.[0]?.url ?? r.thumbnail?.url;
        return {
          title: String(r.title ?? r.name ?? "Unknown title"),
          url,
          durationMs: typeof dur === "number" ? dur * 1000 : 0,
          thumbnail: thumb,
        };
      })
      .filter((c): c is Track => c !== null);
  } catch {
    // ignore youtubei search errors here; fallback to play-dl below
  }

  if (candidates.length === 0) {
    const results = await play.search(input, { limit: 5, source: { youtube: "video" } });
    candidates = results
      .map((r): Track | null => {
        const url = r.url ?? (r.id ? `https://www.youtube.com/watch?v=${r.id}` : null);
        if (!url) return null;
        return {
          title: String(r.title ?? "Unknown title"),
          url,
          durationMs: r.durationInSec ? r.durationInSec * 1000 : 0,
          thumbnail: r.thumbnails?.[0]?.url,
        };
      })
      .filter((c): c is Track => c !== null);
  }

  if (candidates.length === 0) {
    return { track: null, needsConfirmation: false, candidates: [], message: "No results found." };
  }

  return {
    track: candidates[0],
    needsConfirmation: true,
    candidates,
  };
}

function parseDuration(text: string): number {
  const parts = text.split(":").map(Number);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}
