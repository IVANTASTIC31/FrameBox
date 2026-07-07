import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import ffprobeStatic from "ffprobe-static";
import type { VideoMetadata } from "../../shared/types.js";
import { resolutionFromSize } from "../utils/video.js";

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
  };
}

export class MediaProbeService {
  async probe(filePath: string): Promise<{ metadata: VideoMetadata; error: string | null }> {
    try {
      const raw = await this.runFfprobe(filePath);
      const parsed = JSON.parse(raw) as FfprobeOutput;
      const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video") ?? null;
      const width = videoStream?.width ?? null;
      const height = videoStream?.height ?? null;
      const duration = this.parseDuration(parsed.format?.duration || videoStream?.duration);

      return {
        metadata: {
          durationSeconds: duration,
          resolution: resolutionFromSize(width, height),
          width,
          height
        },
        error: null
      };
    } catch (error) {
      return {
        metadata: {
          durationSeconds: null,
          resolution: null,
          width: null,
          height: null
        },
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private runFfprobe(filePath: string): Promise<string> {
    const binary = this.resolveBinary();

    return new Promise((resolve, reject) => {
      execFile(
        binary,
        ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
        { windowsHide: true, maxBuffer: 1024 * 1024 * 8 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr.trim() || error.message));
            return;
          }

          resolve(stdout);
        }
      );
    });
  }

  private resolveBinary(): string {
    if (app.isPackaged) {
      const packagedDir = path.join(process.resourcesPath, "ffprobe");
      const candidates = [
        path.join(packagedDir, "win32", "x64", "ffprobe.exe"),
        path.join(packagedDir, "win32", "ia32", "ffprobe.exe"),
        path.join(packagedDir, "ffprobe.exe")
      ];

      const packaged = candidates.find((candidate) => existsSync(candidate));
      if (packaged) {
        return packaged;
      }
    }

    if (ffprobeStatic?.path && existsSync(ffprobeStatic.path)) {
      return ffprobeStatic.path;
    }

    return "ffprobe";
  }

  private parseDuration(value: string | undefined): number | null {
    if (!value) {
      return null;
    }

    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return Math.round(parsed);
  }
}
