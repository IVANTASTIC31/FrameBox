import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import type {
  AppSettings,
  BindUnclassifiedPayload,
  CreateMovieFromUnclassifiedPayload,
  LibraryDirectory,
  MovieDetails,
  MovieFile,
  MovieImage,
  MovieInput,
  MovieSummary,
  PlayerMode,
  SaveMoviePayload,
  UnclassifiedFile,
  UnclassifiedStatus
} from "../../shared/types.js";
import type { FrameBoxPaths } from "./dataDirectory.js";
import { createId } from "../utils/id.js";
import { nowIso } from "../utils/time.js";
import { toFileUrl } from "../utils/assets.js";
import { SUPPORTED_VIDEO_EXTENSIONS } from "../utils/video.js";

interface UnclassifiedInput {
  path: string;
  filename: string;
  sizeBytes: number;
  detectedCode: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  status: UnclassifiedStatus;
  probeError: string | null;
}

type QueryParams = SqlValue[] | Record<string, SqlValue>;

interface MovieRow {
  id: string;
  code: string | null;
  title: string | null;
  year: string | null;
  duration_seconds: number | null;
  resolution: string | null;
  cover_path: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  file_count: number;
}

interface UnclassifiedRow {
  id: string;
  path: string;
  filename: string;
  size_bytes: number;
  detected_code: string | null;
  duration_seconds: number | null;
  resolution: string | null;
  status: UnclassifiedStatus;
  probe_error: string | null;
  discovered_at: string;
  updated_at: string;
}

interface MovieFileRow {
  id: string;
  movie_id: string;
  path: string;
  filename: string;
  size_bytes: number;
  duration_seconds: number | null;
  resolution: string | null;
  is_primary: number;
  status: string;
  created_at: string;
  updated_at: string;
}

interface MovieImageRow {
  id: string;
  movie_id: string;
  kind: "cover" | "still";
  path: string;
  sort_order: number;
  created_at: string;
}

export class DatabaseService {
  private SQL: SqlJsStatic | null = null;
  private db: Database | null = null;
  private paths: FrameBoxPaths | null = null;
  private saveTimer: NodeJS.Timeout | null = null;

  async init(paths: FrameBoxPaths): Promise<void> {
    this.paths = paths;
    this.SQL = await initSqlJs({
      locateFile: (file) => this.resolveWasmPath(file)
    });

    this.db = await this.openDatabase(paths.dbPath);
    this.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS library_dirs (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS movies (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        title TEXT NOT NULL,
        year TEXT NOT NULL DEFAULT '',
        duration_seconds INTEGER,
        resolution TEXT,
        cover_path TEXT,
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_movies_code_upper ON movies (UPPER(code));

      CREATE TABLE IF NOT EXISTS movie_files (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        duration_seconds INTEGER,
        resolution TEXT,
        is_primary INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS movie_actors (
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(movie_id, name)
      );

      CREATE TABLE IF NOT EXISTS movie_genres (
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        PRIMARY KEY(movie_id, name)
      );

      CREATE TABLE IF NOT EXISTS movie_images (
        id TEXT PRIMARY KEY,
        movie_id TEXT NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS unclassified_files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        detected_code TEXT,
        duration_seconds INTEGER,
        resolution TEXT,
        status TEXT NOT NULL,
        probe_error TEXT,
        discovered_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ignored_files (
        path TEXT PRIMARY KEY,
        ignored_at TEXT NOT NULL
      );
    `);

    this.setSettingIfMissing("playerMode", "system");
    this.setSettingIfMissing("playerPath", "");
    this.setSettingIfMissing("playerArgs", "");
    this.setSettingIfMissing("supportedExtensions", JSON.stringify(SUPPORTED_VIDEO_EXTENSIONS));
    await this.flush();
  }

  async rehome(paths: FrameBoxPaths): Promise<void> {
    this.paths = paths;
    this.db = await this.openDatabase(paths.dbPath);
  }

  exportBytes(): Uint8Array {
    return this.requireDb().export();
  }

  getSettings(): AppSettings {
    const settings = this.all<{ key: string; value: string }>("SELECT key, value FROM settings");
    const map = new Map(settings.map((setting) => [setting.key, setting.value]));

    return {
      dataDir: this.requirePaths().dataDir,
      playerMode: this.asPlayerMode(map.get("playerMode")),
      playerPath: map.get("playerPath") || "",
      playerArgs: map.get("playerArgs") || "",
      supportedExtensions: this.parseExtensions(map.get("supportedExtensions"))
    };
  }

  async updatePlayerSettings(settings: Pick<AppSettings, "playerMode" | "playerPath" | "playerArgs">): Promise<AppSettings> {
    this.setSetting("playerMode", settings.playerMode);
    this.setSetting("playerPath", settings.playerPath);
    this.setSetting("playerArgs", settings.playerArgs);
    await this.flush();
    return this.getSettings();
  }

  listLibraryDirs(): LibraryDirectory[] {
    const rows = this.all<{ id: string; path: string; created_at: string; updated_at: string }>(
      "SELECT id, path, created_at, updated_at FROM library_dirs ORDER BY path COLLATE NOCASE"
    );

    return rows.map((row) => ({
      id: row.id,
      path: row.path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async addLibraryDir(dirPath: string): Promise<LibraryDirectory[]> {
    const now = nowIso();
    this.run(
      `INSERT OR IGNORE INTO library_dirs (id, path, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      [createId("dir"), path.resolve(dirPath), now, now]
    );
    await this.flush();
    return this.listLibraryDirs();
  }

  async removeLibraryDir(id: string): Promise<LibraryDirectory[]> {
    this.run("DELETE FROM library_dirs WHERE id = ?", [id]);
    await this.flush();
    return this.listLibraryDirs();
  }

  pathIsKnown(filePath: string): boolean {
    const normalized = path.resolve(filePath);
    const ignored = this.get<{ path: string }>("SELECT path FROM ignored_files WHERE path = ?", [normalized]);
    if (ignored) {
      return true;
    }

    const movieFile = this.get<{ path: string }>("SELECT path FROM movie_files WHERE path = ?", [normalized]);
    if (movieFile) {
      return true;
    }

    const unclassified = this.get<{ path: string }>("SELECT path FROM unclassified_files WHERE path = ?", [normalized]);
    return Boolean(unclassified);
  }

  movieCodeExists(code: string | null): boolean {
    if (!code) {
      return false;
    }

    const existing = this.get<{ id: string }>("SELECT id FROM movies WHERE UPPER(code) = UPPER(?)", [code]);
    return Boolean(existing);
  }

  async upsertUnclassified(input: UnclassifiedInput): Promise<void> {
    const now = nowIso();
    const existing = this.get<{ id: string }>("SELECT id FROM unclassified_files WHERE path = ?", [input.path]);

    if (existing) {
      this.run(
        `UPDATE unclassified_files
         SET filename = ?, size_bytes = ?, detected_code = ?, duration_seconds = ?, resolution = ?,
             status = ?, probe_error = ?, updated_at = ?
         WHERE id = ?`,
        [
          input.filename,
          input.sizeBytes,
          input.detectedCode,
          input.durationSeconds,
          input.resolution,
          input.status,
          input.probeError,
          now,
          existing.id
        ]
      );
      return;
    }

    this.run(
      `INSERT INTO unclassified_files (
        id, path, filename, size_bytes, detected_code, duration_seconds, resolution,
        status, probe_error, discovered_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createId("unclassified"),
        input.path,
        input.filename,
        input.sizeBytes,
        input.detectedCode,
        input.durationSeconds,
        input.resolution,
        input.status,
        input.probeError,
        now,
        now
      ]
    );
  }

  listUnclassified(): UnclassifiedFile[] {
    return this.all<UnclassifiedRow>(
      `SELECT id, path, filename, size_bytes, detected_code, duration_seconds, resolution,
              status, probe_error, discovered_at, updated_at
       FROM unclassified_files
       ORDER BY
         CASE status WHEN 'conflict' THEN 0 WHEN 'parse_error' THEN 1 ELSE 2 END,
         discovered_at DESC`
    ).map((row) => this.toUnclassified(row));
  }

  getUnclassified(id: string): UnclassifiedFile | null {
    const row = this.get<UnclassifiedRow>(
      `SELECT id, path, filename, size_bytes, detected_code, duration_seconds, resolution,
              status, probe_error, discovered_at, updated_at
       FROM unclassified_files WHERE id = ?`,
      [id]
    );
    return row ? this.toUnclassified(row) : null;
  }

  async ignoreUnclassified(id: string): Promise<UnclassifiedFile[]> {
    const file = this.getUnclassified(id);
    if (!file) {
      return this.listUnclassified();
    }

    this.run("INSERT OR REPLACE INTO ignored_files (path, ignored_at) VALUES (?, ?)", [file.path, nowIso()]);
    this.run("DELETE FROM unclassified_files WHERE id = ?", [id]);
    await this.flush();
    return this.listUnclassified();
  }

  async createMovieFromUnclassified(payload: CreateMovieFromUnclassifiedPayload): Promise<MovieDetails> {
    const file = this.getUnclassified(payload.unclassifiedId);
    if (!file) {
      throw new Error("未找到这个未分类文件。");
    }

    const movie = {
      ...payload.movie,
      durationSeconds: payload.movie.durationSeconds ?? file.durationSeconds,
      resolution: payload.movie.resolution || file.resolution
    };
    const saved = this.saveMovieInternal(movie);
    const now = nowIso();

    this.run(
      `INSERT OR REPLACE INTO movie_files (
        id, movie_id, path, filename, size_bytes, duration_seconds, resolution,
        is_primary, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'available', ?, ?)`,
      [
        createId("file"),
        saved.id,
        file.path,
        file.filename,
        file.sizeBytes,
        file.durationSeconds,
        file.resolution,
        now,
        now
      ]
    );
    this.run("DELETE FROM unclassified_files WHERE id = ?", [file.id]);
    await this.flush();

    const details = this.getMovie(saved.id);
    if (!details) {
      throw new Error("电影已保存，但读取详情失败。");
    }

    return details;
  }

  async bindUnclassifiedToMovie(payload: BindUnclassifiedPayload): Promise<MovieDetails> {
    const file = this.getUnclassified(payload.unclassifiedId);
    if (!file) {
      throw new Error("未找到这个未分类文件。");
    }

    const movie = this.getMovie(payload.movieId);
    if (!movie) {
      throw new Error("未找到要绑定的电影。");
    }

    const now = nowIso();
    if (payload.makePrimary) {
      this.run("UPDATE movie_files SET is_primary = 0 WHERE movie_id = ?", [payload.movieId]);
    }

    const hasPrimary = this.get<{ id: string }>(
      "SELECT id FROM movie_files WHERE movie_id = ? AND is_primary = 1",
      [payload.movieId]
    );

    this.run(
      `INSERT OR REPLACE INTO movie_files (
        id, movie_id, path, filename, size_bytes, duration_seconds, resolution,
        is_primary, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?)`,
      [
        createId("file"),
        payload.movieId,
        file.path,
        file.filename,
        file.sizeBytes,
        file.durationSeconds,
        file.resolution,
        payload.makePrimary || !hasPrimary ? 1 : 0,
        now,
        now
      ]
    );
    this.run("DELETE FROM unclassified_files WHERE id = ?", [file.id]);
    await this.flush();

    const updated = this.getMovie(payload.movieId);
    if (!updated) {
      throw new Error("文件已绑定，但读取电影详情失败。");
    }

    return updated;
  }

  listMovies(query = ""): MovieSummary[] {
    const trimmed = query.trim();
    const rows = trimmed
      ? this.all<MovieRow>(
          `SELECT m.*, (SELECT COUNT(*) FROM movie_files mf WHERE mf.movie_id = m.id) AS file_count
           FROM movies m
           WHERE UPPER(m.title) LIKE UPPER(?)
              OR UPPER(m.code) LIKE UPPER(?)
              OR EXISTS (
                SELECT 1 FROM movie_actors a
                WHERE a.movie_id = m.id AND UPPER(a.name) LIKE UPPER(?)
              )
           ORDER BY m.updated_at DESC`,
          [`%${trimmed}%`, `%${trimmed}%`, `%${trimmed}%`]
        )
      : this.all<MovieRow>(
          `SELECT m.*, (SELECT COUNT(*) FROM movie_files mf WHERE mf.movie_id = m.id) AS file_count
           FROM movies m
           ORDER BY m.updated_at DESC`
        );

    return rows.map((row) => this.toMovieSummary(row));
  }

  getMovie(id: string): MovieDetails | null {
    const row = this.get<MovieRow>(
      `SELECT m.*, (SELECT COUNT(*) FROM movie_files mf WHERE mf.movie_id = m.id) AS file_count
       FROM movies m WHERE m.id = ?`,
      [id]
    );

    if (!row) {
      return null;
    }

    const summary = this.toMovieSummary(row);
    const files: MovieFile[] = this.all<MovieFileRow>(
      `SELECT id, movie_id, path, filename, size_bytes, duration_seconds, resolution,
              is_primary, status, created_at, updated_at
       FROM movie_files
       WHERE movie_id = ?
       ORDER BY is_primary DESC, filename COLLATE NOCASE`,
      [id]
    ).map((file) => ({
      id: file.id,
      movieId: file.movie_id,
      path: file.path,
      filename: file.filename,
      sizeBytes: file.size_bytes,
      durationSeconds: file.duration_seconds,
      resolution: file.resolution,
      isPrimary: file.is_primary === 1,
      status: file.status === "missing" ? ("missing" as const) : ("available" as const),
      createdAt: file.created_at,
      updatedAt: file.updated_at
    }));

    const stills = this.all<MovieImageRow>(
      `SELECT id, movie_id, kind, path, sort_order, created_at
       FROM movie_images
       WHERE movie_id = ? AND kind = 'still'
       ORDER BY sort_order ASC, created_at ASC`,
      [id]
    ).map((image) => this.toMovieImage(image));

    return {
      ...summary,
      notes: row.notes || "",
      files,
      stills
    };
  }

  getMovieFile(id: string): MovieFile | null {
    const file = this.get<MovieFileRow>(
      `SELECT id, movie_id, path, filename, size_bytes, duration_seconds, resolution,
              is_primary, status, created_at, updated_at
       FROM movie_files
       WHERE id = ?`,
      [id]
    );

    if (!file) {
      return null;
    }

    return {
      id: file.id,
      movieId: file.movie_id,
      path: file.path,
      filename: file.filename,
      sizeBytes: file.size_bytes,
      durationSeconds: file.duration_seconds,
      resolution: file.resolution,
      isPrimary: file.is_primary === 1,
      status: file.status === "missing" ? "missing" : "available",
      createdAt: file.created_at,
      updatedAt: file.updated_at
    };
  }

  async saveMovie(payload: SaveMoviePayload): Promise<MovieDetails> {
    const movie = this.saveMovieInternal(payload.movie);
    await this.flush();

    const details = this.getMovie(movie.id);
    if (!details) {
      throw new Error("电影已保存，但读取详情失败。");
    }

    return details;
  }

  async deleteMovie(id: string): Promise<MovieSummary[]> {
    this.run("DELETE FROM movies WHERE id = ?", [id]);
    await this.flush();
    return this.listMovies();
  }

  async addMovieImage(movieId: string, kind: "cover" | "still", imagePath: string): Promise<MovieDetails> {
    const movie = this.getMovie(movieId);
    if (!movie) {
      throw new Error("未找到电影。");
    }

    const now = nowIso();
    if (kind === "cover") {
      this.run("DELETE FROM movie_images WHERE movie_id = ? AND kind = 'cover'", [movieId]);
      this.run("UPDATE movies SET cover_path = ?, updated_at = ? WHERE id = ?", [imagePath, now, movieId]);
    }

    const sortOrder = this.get<{ next_order: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM movie_images WHERE movie_id = ? AND kind = ?",
      [movieId, kind]
    )?.next_order ?? 0;

    this.run(
      `INSERT INTO movie_images (id, movie_id, kind, path, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [createId("image"), movieId, kind, imagePath, sortOrder, now]
    );
    await this.flush();

    const updated = this.getMovie(movieId);
    if (!updated) {
      throw new Error("图片已保存，但读取电影详情失败。");
    }

    return updated;
  }

  async removeMovieImage(id: string): Promise<MovieDetails | null> {
    const image = this.get<MovieImageRow>(
      "SELECT id, movie_id, kind, path, sort_order, created_at FROM movie_images WHERE id = ?",
      [id]
    );
    if (!image) {
      return null;
    }

    if (image.kind === "cover") {
      this.run("UPDATE movies SET cover_path = NULL, updated_at = ? WHERE id = ?", [nowIso(), image.movie_id]);
    }

    this.run("DELETE FROM movie_images WHERE id = ?", [id]);
    await this.flush();
    return this.getMovie(image.movie_id);
  }

  async markMovieFileStatus(filePath: string, exists: boolean): Promise<void> {
    this.run(
      "UPDATE movie_files SET status = ?, updated_at = ? WHERE path = ?",
      [exists ? "available" : "missing", nowIso(), path.resolve(filePath)]
    );
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }

    await this.writeDatabase();
  }

  private saveMovieInternal(input: MovieInput): { id: string } {
    const now = nowIso();
    const id = input.id || createId("movie");
    const normalizedCode = input.code.trim().toUpperCase();
    const normalizedTitle = input.title.trim();

    if (!normalizedCode) {
      throw new Error("影片番号不能为空。");
    }

    if (!normalizedTitle) {
      throw new Error("标题不能为空。");
    }

    const existing = this.get<{ id: string }>("SELECT id FROM movies WHERE UPPER(code) = UPPER(?)", [normalizedCode]);
    if (existing && existing.id !== id) {
      throw new Error(`影片番号 ${normalizedCode} 已存在。`);
    }

    const hasMovie = this.get<{ id: string }>("SELECT id FROM movies WHERE id = ?", [id]);
    if (hasMovie) {
      this.run(
        `UPDATE movies
         SET code = ?, title = ?, year = ?, duration_seconds = ?, resolution = ?,
             cover_path = ?, notes = ?, updated_at = ?
         WHERE id = ?`,
        [
          normalizedCode,
          normalizedTitle,
          input.year.trim(),
          input.durationSeconds,
          input.resolution?.trim() || null,
          input.coverPath || null,
          input.notes,
          now,
          id
        ]
      );
    } else {
      this.run(
        `INSERT INTO movies (
          id, code, title, year, duration_seconds, resolution, cover_path, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          normalizedCode,
          normalizedTitle,
          input.year.trim(),
          input.durationSeconds,
          input.resolution?.trim() || null,
          input.coverPath || null,
          input.notes,
          now,
          now
        ]
      );
    }

    this.replaceTags("movie_actors", id, input.actors);
    this.replaceTags("movie_genres", id, input.genres);
    return { id };
  }

  private replaceTags(table: "movie_actors" | "movie_genres", movieId: string, tags: string[]): void {
    const normalized = Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)));
    this.run(`DELETE FROM ${table} WHERE movie_id = ?`, [movieId]);

    for (const tag of normalized) {
      this.run(`INSERT OR IGNORE INTO ${table} (movie_id, name) VALUES (?, ?)`, [movieId, tag]);
    }
  }

  private toMovieSummary(row: MovieRow): MovieSummary {
    return {
      id: row.id,
      code: row.code || "",
      title: row.title || "",
      year: row.year || "",
      durationSeconds: row.duration_seconds,
      resolution: row.resolution,
      coverPath: row.cover_path,
      coverUrl: toFileUrl(row.cover_path),
      actors: this.getTags("movie_actors", row.id),
      genres: this.getTags("movie_genres", row.id),
      fileCount: row.file_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private toUnclassified(row: UnclassifiedRow): UnclassifiedFile {
    return {
      id: row.id,
      path: row.path,
      filename: row.filename,
      sizeBytes: row.size_bytes,
      detectedCode: row.detected_code,
      durationSeconds: row.duration_seconds,
      resolution: row.resolution,
      status: row.status,
      probeError: row.probe_error,
      discoveredAt: row.discovered_at,
      updatedAt: row.updated_at
    };
  }

  private toMovieImage(row: MovieImageRow): MovieImage {
    return {
      id: row.id,
      movieId: row.movie_id,
      kind: row.kind,
      path: row.path,
      url: toFileUrl(row.path) || "",
      sortOrder: row.sort_order,
      createdAt: row.created_at
    };
  }

  private getTags(table: "movie_actors" | "movie_genres", movieId: string): string[] {
    return this.all<{ name: string }>(`SELECT name FROM ${table} WHERE movie_id = ? ORDER BY name COLLATE NOCASE`, [
      movieId
    ]).map((row) => row.name);
  }

  private asPlayerMode(value: string | undefined): PlayerMode {
    return value === "custom" ? "custom" : "system";
  }

  private parseExtensions(value: string | undefined): string[] {
    if (!value) {
      return SUPPORTED_VIDEO_EXTENSIONS;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : SUPPORTED_VIDEO_EXTENSIONS;
    } catch {
      return SUPPORTED_VIDEO_EXTENSIONS;
    }
  }

  private setSettingIfMissing(key: string, value: string): void {
    const existing = this.get<{ key: string }>("SELECT key FROM settings WHERE key = ?", [key]);
    if (!existing) {
      this.run("INSERT INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  }

  private setSetting(key: string, value: string): void {
    this.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value]);
  }

  private async openDatabase(dbPath: string): Promise<Database> {
    const SQL = this.requireSql();
    try {
      const bytes = await fs.readFile(dbPath);
      return new SQL.Database(bytes);
    } catch {
      return new SQL.Database();
    }
  }

  private async writeDatabase(): Promise<void> {
    const db = this.requireDb();
    const paths = this.requirePaths();
    await fs.mkdir(path.dirname(paths.dbPath), { recursive: true });
    await fs.writeFile(paths.dbPath, db.export());
  }

  private all<T>(sql: string, params?: QueryParams): T[] {
    const stmt = this.requireDb().prepare(sql);
    const rows: T[] = [];

    try {
      if (params) {
        stmt.bind(params);
      }

      while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
      }

      return rows;
    } finally {
      stmt.free();
    }
  }

  private get<T>(sql: string, params?: QueryParams): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }

  private run(sql: string, params?: QueryParams): void {
    this.requireDb().run(sql, params);
  }

  private exec(sql: string): void {
    this.requireDb().exec(sql);
  }

  private requireDb(): Database {
    if (!this.db) {
      throw new Error("Database has not been initialized.");
    }

    return this.db;
  }

  private requireSql(): SqlJsStatic {
    if (!this.SQL) {
      throw new Error("SQL runtime has not been initialized.");
    }

    return this.SQL;
  }

  private requirePaths(): FrameBoxPaths {
    if (!this.paths) {
      throw new Error("FrameBox paths have not been initialized.");
    }

    return this.paths;
  }

  private resolveWasmPath(file: string): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, file);
    }

    return path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file);
  }
}
