export type UnclassifiedStatus = "pending" | "conflict" | "parse_error";

export type MovieFileStatus = "available" | "missing";

export type ImageKind = "cover" | "still";

export type PlayerMode = "system" | "custom";

export type MovieSourceReadPhase = "discovering" | "probing" | "complete";

export interface MovieSourceReadProgress {
  phase: MovieSourceReadPhase;
  rootPath: string | null;
  currentPath: string | null;
  processed: number;
  total: number;
  message: string;
}

export interface LibraryDirectory {
  id: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface VideoMetadata {
  durationSeconds: number | null;
  resolution: string | null;
  width: number | null;
  height: number | null;
}

export interface UnclassifiedFile {
  id: string;
  path: string;
  filename: string;
  sizeBytes: number;
  detectedCode: string | null;
  durationSeconds: number | null;
  resolution: string | null;
  status: UnclassifiedStatus;
  probeError: string | null;
  discoveredAt: string;
  updatedAt: string;
}

export interface MovieFile {
  id: string;
  movieId: string;
  path: string;
  filename: string;
  sizeBytes: number;
  durationSeconds: number | null;
  resolution: string | null;
  isPrimary: boolean;
  status: MovieFileStatus;
  createdAt: string;
  updatedAt: string;
}

export interface MovieImage {
  id: string;
  movieId: string;
  kind: ImageKind;
  path: string;
  url: string;
  sortOrder: number;
  createdAt: string;
}

export interface MovieSummary {
  id: string;
  code: string;
  title: string;
  year: string;
  durationSeconds: number | null;
  resolution: string | null;
  coverPath: string | null;
  coverUrl: string | null;
  previewUrls: string[];
  actors: string[];
  genres: string[];
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface MovieDetails extends MovieSummary {
  notes: string;
  files: MovieFile[];
  stills: MovieImage[];
}

export interface MovieInput {
  id?: string;
  code: string;
  title: string;
  year: string;
  actors: string[];
  genres: string[];
  durationSeconds: number | null;
  resolution: string | null;
  coverPath: string | null;
  notes: string;
}

export interface AppSettings {
  dataDir: string;
  playerMode: PlayerMode;
  playerPath: string;
  playerArgs: string;
  supportedExtensions: string[];
}

export interface CreateMovieFromUnclassifiedPayload {
  unclassifiedId: string;
  movie: MovieInput;
}

export interface BindUnclassifiedPayload {
  unclassifiedId: string;
  movieId: string;
  makePrimary: boolean;
}

export interface SearchMoviesPayload {
  query?: string;
}

export interface SaveMoviePayload {
  movie: MovieInput;
}

export interface AddImagePayload {
  movieId: string;
  kind: ImageKind;
}

export interface FrameBoxApi {
  getStartupWarning(): Promise<string | null>;
  getSettings(): Promise<AppSettings>;
  selectDirectory(): Promise<string | null>;
  selectPlayer(): Promise<string | null>;
  selectImage(): Promise<string | null>;
  setDataDir(path: string): Promise<AppSettings>;
  updatePlayerSettings(settings: Pick<AppSettings, "playerMode" | "playerPath" | "playerArgs">): Promise<AppSettings>;
  listLibraryDirs(): Promise<LibraryDirectory[]>;
  addLibraryDir(path: string): Promise<LibraryDirectory[]>;
  removeLibraryDir(id: string): Promise<LibraryDirectory[]>;
  rescanLibrary(): Promise<UnclassifiedFile[]>;
  listUnclassified(): Promise<UnclassifiedFile[]>;
  ignoreUnclassified(id: string): Promise<UnclassifiedFile[]>;
  createMovieFromUnclassified(payload: CreateMovieFromUnclassifiedPayload): Promise<MovieDetails>;
  bindUnclassifiedToMovie(payload: BindUnclassifiedPayload): Promise<MovieDetails>;
  listMovies(payload?: SearchMoviesPayload): Promise<MovieSummary[]>;
  getMovie(id: string): Promise<MovieDetails | null>;
  saveMovie(payload: SaveMoviePayload): Promise<MovieDetails>;
  deleteMovie(id: string): Promise<MovieSummary[]>;
  addMovieImage(payload: AddImagePayload): Promise<MovieDetails | null>;
  removeMovieImage(id: string): Promise<MovieDetails | null>;
  playMovieFile(fileId: string): Promise<void>;
  revealPath(path: string): Promise<void>;
  onChooseMovieSource(callback: () => void): () => void;
  onMovieSourceReading(callback: (payload: { path: string }) => void): () => void;
  onMovieSourceReadProgress(callback: (payload: MovieSourceReadProgress) => void): () => void;
  onMovieSourceSelected(callback: (payload: { path: string; unclassifiedCount: number }) => void): () => void;
  onMovieSourceReadFailed(callback: (payload: { path: string; message: string }) => void): () => void;
}

declare global {
  interface Window {
    frameBox: FrameBoxApi;
  }
}
