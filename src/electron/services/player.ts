import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import { shell } from "electron";
import type { AppSettings, MovieFile } from "../../shared/types.js";

export class PlayerService {
  async play(file: MovieFile, settings: AppSettings): Promise<void> {
    if (settings.playerMode === "custom" && settings.playerPath.trim()) {
      await this.playWithCustomPlayer(file.path, settings.playerPath, settings.playerArgs);
      return;
    }

    const error = await shell.openPath(file.path);
    if (error) {
      throw new Error(error);
    }
  }

  private async playWithCustomPlayer(filePath: string, playerPath: string, rawArgs: string): Promise<void> {
    try {
      await fsp.access(playerPath);
    } catch {
      throw new Error(`无法读取自定义播放器：${playerPath}。请在设置中重新选择播放器。`);
    }

    const args = this.parseArgs(rawArgs, filePath);

    await new Promise<void>((resolve, reject) => {
      const child = spawn(playerPath, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false
      });

      child.once("error", (error) => {
        reject(new Error(`播放器启动失败：${error.message}`));
      });

      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
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
