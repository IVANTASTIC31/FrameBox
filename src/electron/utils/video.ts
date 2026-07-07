import path from "node:path";

export const SUPPORTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".webm",
  ".m4v",
  ".ts"
];

const CODE_PATTERNS = [
  /\b(FC2)[\s._-]*(?:PPV[\s._-]*)?(\d{5,8})\b/i,
  /\b(HEYZO)[\s._-]*(\d{3,6})\b/i,
  /\b([A-Z]{2,10})[\s._-]*(\d{2,6})\b/i
];

export function isSupportedVideo(filePath: string): boolean {
  return SUPPORTED_VIDEO_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function detectMovieCode(filePath: string): string | null {
  const name = path.basename(filePath, path.extname(filePath));
  const normalized = name
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[【】]/g, " ")
    .toUpperCase();

  for (const pattern of CODE_PATTERNS) {
    const match = normalized.match(pattern);
    if (!match) {
      continue;
    }

    return `${match[1].toUpperCase()}-${match[2]}`;
  }

  return null;
}

export function resolutionFromSize(width: number | null, height: number | null): string | null {
  if (!width || !height) {
    return null;
  }

  if (width >= 3840 || height >= 2160) {
    return "4K";
  }

  if (height >= 1440) {
    return "1440p";
  }

  if (height >= 1080) {
    return "1080p";
  }

  if (height >= 720) {
    return "720p";
  }

  if (height >= 480) {
    return "480p";
  }

  return `${height}p`;
}
