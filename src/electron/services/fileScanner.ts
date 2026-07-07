import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FSWatcher } from "node:fs";
import type { MovieSourceReadProgress, UnclassifiedFile } from "../../shared/types.js";
import { detectMovieCode, isSupportedVideo } from "../utils/video.js";
import type { DatabaseService } from "./database.js";
import type { MediaProbeService } from "./mediaProbe.js";

type ScanProgressCallback = (progress: MovieSourceReadProgress) => void;

interface CandidateVideo {
  path: string;
  rootPath: string;
}

export class FileScannerService {
  private watchers: FSWatcher[] = [];
  private scanTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly database: DatabaseService,
    private readonly mediaProbe: MediaProbeService
  ) {}

  async scanAll(onProgress?: ScanProgressCallback): Promise<UnclassifiedFile[]> {
    const dirs = this.database.listLibraryDirs();
    const candidates: CandidateVideo[] = [];

    onProgress?.({
      phase: "discovering",
      rootPath: null,
      currentPath: null,
      processed: 0,
      total: 0,
      message: "正在读取目录列表"
    });

    for (const dir of dirs) {
      onProgress?.({
        phase: "discovering",
        rootPath: dir.path,
        currentPath: null,
        processed: candidates.length,
        total: 0,
        message: "正在查找支持的视频文件"
      });
      candidates.push(...(await this.collectCandidates(dir.path)));
    }

    await this.processCandidates(candidates, onProgress);
    await this.database.flush();
    return this.database.listUnclassified();
  }

  async watchAll(onChange: (files: UnclassifiedFile[]) => void): Promise<void> {
    this.closeWatchers();

    for (const dir of this.database.listLibraryDirs()) {
      try {
        const watcher = fs.watch(dir.path, { recursive: true }, () => {
          this.scheduleScan(dir.path, onChange);
        });
        this.watchers.push(watcher);
      } catch {
        // A missing or inaccessible library directory should not prevent the app from opening.
      }
    }
  }

  closeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }

    this.watchers = [];

    for (const timer of this.scanTimers.values()) {
      clearTimeout(timer);
    }

    this.scanTimers.clear();
  }

  private scheduleScan(root: string, onChange: (files: UnclassifiedFile[]) => void): void {
    const existing = this.scanTimers.get(root);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.scanTimers.delete(root);
      void this.scanDirectory(root)
        .then(() => this.database.flush())
        .then(() => onChange(this.database.listUnclassified()))
        .catch(() => undefined);
    }, 1200);

    this.scanTimers.set(root, timer);
  }

  private async scanDirectory(root: string): Promise<void> {
    await this.processCandidates(await this.collectCandidates(root));
  }

  private async collectCandidates(root: string): Promise<CandidateVideo[]> {
    const entries = await this.walk(root);
    const candidates: CandidateVideo[] = [];

    for (const filePath of entries) {
      const normalized = path.resolve(filePath);
      if (!isSupportedVideo(normalized) || this.database.pathIsKnown(normalized)) {
        continue;
      }

      candidates.push({ path: normalized, rootPath: root });
    }

    return candidates;
  }

  private async processCandidates(candidates: CandidateVideo[], onProgress?: ScanProgressCallback): Promise<void> {
    const total = candidates.length;
    let processed = 0;

    if (total === 0) {
      onProgress?.({
        phase: "complete",
        rootPath: null,
        currentPath: null,
        processed: 0,
        total: 0,
        message: "没有发现新的支持视频"
      });
      return;
    }

    for (const candidate of candidates) {
      onProgress?.({
        phase: "probing",
        rootPath: candidate.rootPath,
        currentPath: candidate.path,
        processed,
        total,
        message: "正在读取视频时长和清晰度"
      });

      try {
        const stat = await fsp.stat(candidate.path);
        const detectedCode = detectMovieCode(candidate.path);
        const probeResult = await this.mediaProbe.probe(candidate.path);
        const status = probeResult.error
          ? "parse_error"
          : this.database.movieCodeExists(detectedCode)
            ? "conflict"
            : "pending";

        await this.database.upsertUnclassified({
          path: candidate.path,
          filename: path.basename(candidate.path),
          sizeBytes: stat.size,
          detectedCode,
          durationSeconds: probeResult.metadata.durationSeconds,
          resolution: probeResult.metadata.resolution,
          status,
          probeError: probeResult.error
        });
      } catch {
        // Files can disappear while a watched directory is being scanned.
      }

      processed += 1;
      onProgress?.({
        phase: "probing",
        rootPath: candidate.rootPath,
        currentPath: candidate.path,
        processed,
        total,
        message: "正在读取视频时长和清晰度"
      });
    }

    onProgress?.({
      phase: "complete",
      rootPath: null,
      currentPath: null,
      processed,
      total,
      message: "读取完成"
    });
  }

  private async walk(root: string): Promise<string[]> {
    const found: string[] = [];

    async function visit(dir: string): Promise<void> {
      let entries: fs.Dirent[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const current = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await visit(current);
          continue;
        }

        if (entry.isFile()) {
          found.push(current);
        }
      }
    }

    await visit(root);
    return found;
  }
}
