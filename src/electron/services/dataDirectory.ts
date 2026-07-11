import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export interface FrameBoxPaths {
  dataDir: string;
  dbPath: string;
  assetsDir: string;
  coversDir: string;
  stillsDir: string;
  logsDir: string;
}

interface BootstrapConfig {
  dataDir?: string;
}

export class DataDirectoryService {
  private bootstrapPath = "";
  private paths: FrameBoxPaths | null = null;
  private startupWarning: string | null = null;

  async init(): Promise<FrameBoxPaths> {
    app.setName("FrameBox");
    const userDataDir = app.getPath("userData");
    await fs.mkdir(userDataDir, { recursive: true });
    this.bootstrapPath = path.join(userDataDir, "bootstrap.json");

    const bootstrap = await this.readBootstrap();
    const defaultDataDir = path.join(app.getPath("appData"), "FrameBox");
    const dataDir = bootstrap.dataDir || defaultDataDir;

    try {
      this.paths = await this.ensurePaths(dataDir);
    } catch (error) {
      if (path.resolve(dataDir).toLowerCase() === path.resolve(defaultDataDir).toLowerCase()) {
        throw error;
      }

      this.paths = await this.ensurePaths(defaultDataDir);
      const message = error instanceof Error ? error.message : String(error);
      this.startupWarning =
        `上次设置的数据目录暂时不可访问，FrameBox 已使用默认数据目录启动。不可访问目录：${dataDir}。原因：${message}`;
    }

    return this.paths;
  }

  getPaths(): FrameBoxPaths {
    if (!this.paths) {
      throw new Error("Data directory service has not been initialized.");
    }

    return this.paths;
  }

  getStartupWarning(): string | null {
    return this.startupWarning;
  }

  async changeDataDir(nextDataDir: string, exportDb: () => Uint8Array): Promise<FrameBoxPaths> {
    const current = this.getPaths();
    const resolvedNext = path.resolve(nextDataDir);

    if (path.resolve(current.dataDir).toLowerCase() === resolvedNext.toLowerCase()) {
      return current;
    }

    const nextPaths = await this.ensurePaths(resolvedNext);
    await fs.writeFile(nextPaths.dbPath, exportDb());
    await this.copyAssets(current.assetsDir, nextPaths.assetsDir);
    await this.writeBootstrap({ dataDir: resolvedNext });
    this.paths = nextPaths;

    return nextPaths;
  }

  private async ensurePaths(dataDir: string): Promise<FrameBoxPaths> {
    const assetsDir = path.join(dataDir, "assets");
    const coversDir = path.join(assetsDir, "covers");
    const stillsDir = path.join(assetsDir, "stills");
    const logsDir = path.join(dataDir, "logs");

    await fs.mkdir(coversDir, { recursive: true });
    await fs.mkdir(stillsDir, { recursive: true });
    await fs.mkdir(logsDir, { recursive: true });

    return {
      dataDir,
      dbPath: path.join(dataDir, "library.db"),
      assetsDir,
      coversDir,
      stillsDir,
      logsDir
    };
  }

  private async readBootstrap(): Promise<BootstrapConfig> {
    try {
      const raw = await fs.readFile(this.bootstrapPath, "utf8");
      return JSON.parse(raw) as BootstrapConfig;
    } catch {
      return {};
    }
  }

  private async writeBootstrap(config: BootstrapConfig): Promise<void> {
    await fs.writeFile(this.bootstrapPath, JSON.stringify(config, null, 2), "utf8");
  }

  private async copyAssets(from: string, to: string): Promise<void> {
    try {
      await fs.cp(from, to, { recursive: true, force: false, errorOnExist: false });
    } catch {
      await fs.mkdir(to, { recursive: true });
    }
  }
}
