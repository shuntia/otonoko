# otonoko – Agent Notes

## Runtime basics
- Node 18+, pnpm. Discord bot with slash commands only (no message intent).
- One voice connection per guild (Discord limitation). Sessions tracked per guild.
- LOG_LEVEL=debug to see detailed streaming/session logs.

## Key flows
- Streaming order: ytdlp-nodejs -> youtubei.js -> yt-dlp CLI. Short prebuffer (~128KB or 2s) and ~3s capture for cache/DB. Playback starts immediately; capture is parallel.
- Track resolver: youtubei first, play-dl as metadata/search fallback (not for streaming).
- Loop re-enqueue skipped if track ended in <2s to avoid thrash.

## Sessions/status
- GuildMusicState holds sessionToken, lastTextChannelId, voice connection, queue, etc.
- Sessions (per guild) store guildId, voiceChannelId, textChannelId, statusMessageId, interval, token.
- Status loop updates every second: now playing, progress, queue length, loop, volume, token, voice/text IDs.
- Status anchoring: edits the newest bot message in the attached text channel; if none, sends new. If users chat in that channel while connected, status is cleared and recreated on next tick to stay at bottom.
- Auto-disconnect on empty VC calls stopSession (clears status/interval).

## Commands
- `/play` sets lastTextChannelId, updates session (voice/text/token), starts status loop on track start.
- `/queue` pagination uses interaction-specific IDs and omits buttons if single page (avoids duplicate ID errors).
- Follow behavior removed. Join/leave are simple. Loop modes exist; short plays don’t re-loop.

## Known constraints/issues
- Only one voice connection per guild. Multiple VCs simultaneously not supported by Discord.
- yt-dlp/yt-dlp-nodejs require network; in sandbox they fail.
- Status uses guild text or announcement channels; threads/DMs not handled.
