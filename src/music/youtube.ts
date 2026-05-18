import { Innertube, UniversalCache, ClientType } from "youtubei.js";

let ytInstance: Promise<Awaited<ReturnType<typeof Innertube.create>>> | null = null;

export function getYoutubeClient() {
  if (!ytInstance) {
    ytInstance = (async () => {
      try {
        const mod: any = await import("youtubei.js");
        if (mod && typeof mod.setLevel === "function" && mod.Level) {
          try { mod.setLevel(mod.Level.ERROR); } catch (e) {}
        }
        return mod.Innertube.create({ cache: new mod.UniversalCache(false), client_type: ClientType.IOS });
      } catch (e) {
        // Fallback to static imports if dynamic import fails
        return Innertube.create({ cache: new UniversalCache(false), client_type: ClientType.IOS });
      }
    })();
  }
  return ytInstance;
}

export function extractVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.slice(1);
    }
    if (parsed.searchParams.has("v")) return parsed.searchParams.get("v");
    return null;
  } catch {
    return null;
  }
}

export function extractPlaylistId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const list = parsed.searchParams.get("list");
    return list && list.trim().length > 0 ? list : null;
  } catch {
    return null;
  }
}
