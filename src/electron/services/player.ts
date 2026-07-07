import { spawn } from "node:child_process";
import { shell } from "electron";
import type { AppSettings, MovieFile } from "../../shared/types.js";

export class PlayerService {
  async play(file: MovieFile, settings: AppSettings): Promise<void> {
    if (settings.playerMode === "custom" && settings.playerPath.trim()) {
      this.playWithCustomPlayer(file.path, settings.playerPath, settings.playerArgs);
      return;
    }

    const error = await shell.openPath(file.path);
    if (error) {
      throw new Error(error);
    }
  }

  private playWithCustomPlayer(filePath: string, playerPath: string, rawArgs: string): void {
    const args = this.parseArgs(rawArgs, filePath);
    const child = spawn(playerPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false
    });

    child.unref();
  }

  private parseArgs(rawArgs: string, filePath: string): string[] {
    const trimmed = rawArgs.trim();
    if (!trimmed) {
      return [filePath];
    }

    const parsed = trimmed.match(/"([^"]+)"|'([^']+)'|[^\s]+/g)?.map((arg) => arg.replace(/^["']|["']$/g, "")) ?? [];
    const hasPlaceholder = parsed.some((arg) => arg.includes("{file}"));
    const args = parsed.map((arg) => arg.replaceAll("{file}", filePath));

    if (!hasPlaceholder) {
      args.push(filePath);
    }

    return args;
  }
}
