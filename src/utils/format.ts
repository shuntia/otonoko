export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formatted = [
    hours,
    minutes.toString().padStart(hours > 0 ? 2 : 1, "0"),
    seconds.toString().padStart(2, "0"),
  ];
  return formatted.filter((_, idx) => idx === 0 ? hours > 0 : true).join(":");
}
