import { useEffect, useState } from "react";
import {
  Clapperboard,
  Database,
  FolderOpen,
  FolderPlus,
  ImagePlus,
  Library,
  ListFilter,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Trash2,
  X
} from "lucide-react";
import type {
  AppSettings,
  LibraryDirectory,
  MovieDetails,
  MovieInput,
  MovieSummary,
  PlayerMode,
  UnclassifiedFile
} from "../shared/types.js";

type View = "library" | "unclassified" | "settings";

interface SourceReadOverlay {
  title: string;
  path: string;
  detail: string;
  currentPath: string | null;
  processed: number;
  total: number | null;
}

const emptyMovieInput: MovieInput = {
  code: "",
  title: "",
  year: "",
  actors: [],
  genres: [],
  durationSeconds: null,
  resolution: "",
  coverPath: null,
  notes: ""
};

export function App() {
  const [view, setView] = useState<View>("library");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [libraryDirs, setLibraryDirs] = useState<LibraryDirectory[]>([]);
  const [movies, setMovies] = useState<MovieSummary[]>([]);
  const [unclassified, setUnclassified] = useState<UnclassifiedFile[]>([]);
  const [selectedMovie, setSelectedMovie] = useState<MovieDetails | null>(null);
  const [selectedUnclassified, setSelectedUnclassified] = useState<UnclassifiedFile | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [sourceReadOverlay, setSourceReadOverlay] = useState<SourceReadOverlay | null>(null);

  const refresh = async (nextQuery = query) => {
    const [nextSettings, nextDirs, nextMovies, nextUnclassified] = await Promise.all([
      window.frameBox.getSettings(),
      window.frameBox.listLibraryDirs(),
      window.frameBox.listMovies({ query: nextQuery }),
      window.frameBox.listUnclassified()
    ]);

    setSettings(nextSettings);
    setLibraryDirs(nextDirs);
    setMovies(nextMovies);
    setUnclassified(nextUnclassified);
  };

  useEffect(() => {
    void runTask(() => refresh("")).then(() => {
      void window.frameBox.getStartupWarning().then((warning) => {
        if (warning) {
          setMessage(warning);
        }
      });
    });
  }, []);

  useEffect(() => {
    return window.frameBox.onChooseMovieSource(() => {
      void chooseMovieSourceDirectory();
    });
  }, [query]);

  useEffect(() => {
    return window.frameBox.onMovieSourceSelected((payload) => {
      setBusy(false);
      setSourceReadOverlay(null);
      setMessage(`已读取电影源目录：${payload.path}。当前未分类区共有 ${payload.unclassifiedCount} 个视频。`);
      void refresh().then(() => setView("unclassified"));
    });
  }, [query]);

  useEffect(() => {
    return window.frameBox.onMovieSourceReading((payload) => {
      setBusy(true);
      setMessage(null);
      setSourceReadOverlay({
        title: "正在读取电影源目录",
        path: payload.path,
        detail: "正在识别视频文件、读取时长和清晰度",
        currentPath: null,
        processed: 0,
        total: null
      });
    });
  }, []);

  useEffect(() => {
    return window.frameBox.onMovieSourceReadProgress((progress) => {
      const title =
        progress.phase === "discovering"
          ? "正在扫描电影源目录"
          : progress.phase === "complete"
            ? "读取完成"
            : "正在读取视频信息";

      setSourceReadOverlay((current) => ({
        title,
        path: progress.rootPath || current?.path || progress.currentPath || "电影源目录",
        detail: progress.message,
        currentPath: progress.currentPath,
        processed: progress.processed,
        total: progress.total > 0 ? progress.total : null
      }));
    });
  }, []);

  useEffect(() => {
    return window.frameBox.onMovieSourceReadFailed((payload) => {
      setBusy(false);
      setSourceReadOverlay(null);
      setMessage(`读取电影源目录失败：${payload.message}`);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void window.frameBox.listMovies({ query }).then(setMovies);
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function runTask<T>(task: () => Promise<T>, success?: string): Promise<T | null> {
    setBusy(true);
    setMessage(null);

    try {
      const result = await task();
      if (success) {
        setMessage(success);
      }
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function openMovie(id: string) {
    const movie = await runTask(() => window.frameBox.getMovie(id));
    if (movie) {
      setSelectedMovie(movie);
      setView("library");
    }
  }

  async function playMovie(id: string) {
    const movie = await runTask(() => window.frameBox.getMovie(id));
    if (!movie) {
      return;
    }

    const file = movie.files.find((candidate) => candidate.isPrimary) ?? movie.files[0];
    if (!file) {
      setSelectedMovie(movie);
      setMessage("这部电影还没有绑定视频文件。");
      return;
    }

    setSelectedMovie(movie);
    setView("library");
    const played = await runTask(() => window.frameBox.playMovieFile(file.id));
    if (played === null) {
      await refreshMovies();
    }
  }

  async function refreshMovies() {
    const nextMovies = await window.frameBox.listMovies({ query });
    setMovies(nextMovies);
    if (selectedMovie) {
      const nextSelected = await window.frameBox.getMovie(selectedMovie.id);
      setSelectedMovie(nextSelected);
    }
  }

  async function saveMovie(movie: MovieInput) {
    const saved = await runTask(() => window.frameBox.saveMovie({ movie }), "电影信息已保存");
    if (saved) {
      setSelectedMovie(saved);
      await refreshMovies();
    }
  }

  async function deleteMovie(id: string) {
    const nextMovies = await runTask(() => window.frameBox.deleteMovie(id), "库记录已删除，真实视频文件未删除");
    if (nextMovies) {
      setMovies(nextMovies);
      setSelectedMovie(null);
    }
  }

  async function rescan() {
    const files = await runTask(() => window.frameBox.rescanLibrary(), "扫描完成");
    if (files) {
      setUnclassified(files);
      await refreshMovies();
    }
  }

  async function chooseMovieSourceDirectory() {
    setBusy(true);
    setMessage(null);

    try {
      const selected = await window.frameBox.selectDirectory();
      if (!selected) {
        return;
      }

      setSourceReadOverlay({
        title: "正在读取电影源目录",
        path: selected,
        detail: "正在识别视频文件、读取时长和清晰度",
        currentPath: null,
        processed: 0,
        total: null
      });

      const dirs = await window.frameBox.addLibraryDir(selected);
      const [nextSettings, nextMovies, nextUnclassified] = await Promise.all([
        window.frameBox.getSettings(),
        window.frameBox.listMovies({ query }),
        window.frameBox.listUnclassified()
      ]);

      setSettings(nextSettings);
      setLibraryDirs(dirs);
      setMovies(nextMovies);
      setUnclassified(nextUnclassified);
      setSelectedUnclassified(nextUnclassified[0] ?? null);
      setView("unclassified");
      setMessage(`已读取电影源目录：${selected}。当前未分类区共有 ${nextUnclassified.length} 个视频。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setSourceReadOverlay(null);
    }
  }

  async function createMovieFromUnclassified(source: UnclassifiedFile, movie: MovieInput) {
    const saved = await runTask(
      () => window.frameBox.createMovieFromUnclassified({ unclassifiedId: source.id, movie }),
      "已入库"
    );
    if (saved) {
      setSelectedMovie(saved);
      setSelectedUnclassified(null);
      await refresh();
      setView("library");
    }
  }

  async function bindUnclassified(source: UnclassifiedFile, movieId: string, makePrimary: boolean) {
    const saved = await runTask(
      () => window.frameBox.bindUnclassifiedToMovie({ unclassifiedId: source.id, movieId, makePrimary }),
      "文件已绑定"
    );
    if (saved) {
      setSelectedMovie(saved);
      setSelectedUnclassified(null);
      await refresh();
      setView("library");
    }
  }

  async function ignoreUnclassified(id: string) {
    const files = await runTask(() => window.frameBox.ignoreUnclassified(id), "已忽略该文件");
    if (files) {
      setUnclassified(files);
      setSelectedUnclassified(null);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Clapperboard size={24} />
          </div>
          <div>
            <strong>FrameBox</strong>
            <span>本地电影库</span>
          </div>
        </div>

        <nav className="nav-list">
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            <Library size={18} />
            电影库
          </button>
          <button className={view === "unclassified" ? "active" : ""} onClick={() => setView("unclassified")}>
            <ListFilter size={18} />
            未分类
            {unclassified.length > 0 && <span className="count-badge">{unclassified.length}</span>}
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            <Settings size={18} />
            设置
          </button>
        </nav>

        <div className="sidebar-footer">
          <span>数据目录</span>
          <strong title={settings?.dataDir}>{settings?.dataDir ?? "初始化中"}</strong>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{view === "library" ? "电影库" : view === "unclassified" ? "未分类" : "设置"}</h1>
            <p>
              {view === "library"
                ? `${movies.length} 部影片`
                : view === "unclassified"
                  ? `${unclassified.length} 个待处理视频`
                  : "目录、播放器和数据位置"}
            </p>
          </div>

          <div className="topbar-actions">
            <button onClick={() => void chooseMovieSourceDirectory()} disabled={busy}>
              <FolderOpen size={17} />
              选择电影源目录
            </button>
            {view === "library" && (
              <label className="search-box">
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、主演、番号" />
              </label>
            )}
            <button className="icon-button" title="重新扫描" onClick={() => void rescan()} disabled={busy}>
              {busy ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
            </button>
          </div>
        </header>

        {message && (
          <div className="notice">
            <span>{message}</span>
            <button title="关闭" onClick={() => setMessage(null)}>
              <X size={15} />
            </button>
          </div>
        )}

        {sourceReadOverlay && <SourceReadLoadingOverlay overlay={sourceReadOverlay} />}

        {view === "library" && (
          <LibraryView
            movies={movies}
            selectedMovie={selectedMovie}
            busy={busy}
            onOpenMovie={openMovie}
            onPlayMovie={playMovie}
            onCloseMovie={() => setSelectedMovie(null)}
            onChooseSourceDirectory={chooseMovieSourceDirectory}
            onNewMovie={() => setSelectedMovie({ ...movieInputToDetails(emptyMovieInput), id: "" })}
            onSaveMovie={saveMovie}
            onDeleteMovie={deleteMovie}
            onAddImage={async (movieId, kind) => {
              const updated = await runTask(() => window.frameBox.addMovieImage({ movieId, kind }));
              if (updated) {
                setMessage(kind === "cover" ? "封面已更新" : "剧照已添加");
                setSelectedMovie(updated);
                await refreshMovies();
              }
            }}
            onRemoveImage={async (imageId) => {
              const updated = await runTask(() => window.frameBox.removeMovieImage(imageId), "图片已移除");
              if (updated) {
                setSelectedMovie(updated);
                await refreshMovies();
              }
            }}
            onPlayFile={async (fileId) => {
              const played = await runTask(() => window.frameBox.playMovieFile(fileId));
              if (played === null) {
                await refreshMovies();
              }
            }}
            onReveal={(targetPath) => runTask(() => window.frameBox.revealPath(targetPath))}
          />
        )}

        {view === "unclassified" && (
          <UnclassifiedView
            files={unclassified}
            movies={movies}
            selected={selectedUnclassified}
            onSelect={setSelectedUnclassified}
            onChooseSourceDirectory={chooseMovieSourceDirectory}
            onCreate={createMovieFromUnclassified}
            onBind={bindUnclassified}
            onIgnore={ignoreUnclassified}
            onReveal={(targetPath) => runTask(() => window.frameBox.revealPath(targetPath))}
          />
        )}

        {view === "settings" && settings && (
          <SettingsView
            settings={settings}
            dirs={libraryDirs}
            onSettingsChange={setSettings}
            onChooseSourceDirectory={chooseMovieSourceDirectory}
            onDirsChange={async (dirs) => {
              setLibraryDirs(dirs);
              await refresh();
            }}
            onRunTask={runTask}
          />
        )}
      </main>
    </div>
  );
}

function SourceReadLoadingOverlay({ overlay }: { overlay: SourceReadOverlay }) {
  const percent = overlay.total ? Math.min(100, Math.round((overlay.processed / overlay.total) * 100)) : null;
  const currentName = overlay.currentPath ? overlay.currentPath.split(/[\\/]/).pop() : null;

  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-panel">
        <div className="loading-spinner">
          <Loader2 className="spin" size={34} />
        </div>
        <div>
          <div className="loading-title-row">
            <strong>{overlay.title}</strong>
            {percent !== null && <b>{percent}%</b>}
          </div>
          <span title={overlay.path}>{overlay.path}</span>
          <small>{overlay.detail}</small>
          <div className={`progress-track ${percent === null ? "indeterminate" : ""}`}>
            <div className="progress-fill" style={{ width: percent === null ? "38%" : `${percent}%` }} />
          </div>
          <div className="progress-meta">
            <span>{overlay.total ? `${overlay.processed} / ${overlay.total} 个视频` : "正在统计视频数量"}</span>
            {currentName && <span title={overlay.currentPath ?? ""}>{currentName}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

interface LibraryViewProps {
  movies: MovieSummary[];
  selectedMovie: MovieDetails | null;
  busy: boolean;
  onOpenMovie(id: string): void;
  onPlayMovie(id: string): void;
  onCloseMovie(): void;
  onChooseSourceDirectory(): void;
  onNewMovie(): void;
  onSaveMovie(movie: MovieInput): void;
  onDeleteMovie(id: string): void;
  onAddImage(movieId: string, kind: "cover" | "still"): void;
  onRemoveImage(imageId: string): void;
  onPlayFile(fileId: string): void;
  onReveal(path: string): void;
}

function LibraryView(props: LibraryViewProps) {
  return (
    <div className="library-layout">
      <section className="content-pane">
        <div className="section-toolbar">
          <div>
            <strong>封面墙</strong>
            <span>按更新时间排序</span>
          </div>
          <button onClick={props.onNewMovie}>
            <Plus size={17} />
            新建
          </button>
        </div>

        {props.movies.length === 0 ? (
          <EmptyState
            icon={<Library size={30} />}
            title="还没有影片"
            text="选择电影源文件目录后，FrameBox 会读取其中的视频并放入未分类区。"
            action={
              <button className="primary" onClick={props.onChooseSourceDirectory}>
                <FolderOpen size={16} />
                选择电影源目录
              </button>
            }
          />
        ) : (
          <div className="movie-grid">
            {props.movies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                selected={props.selectedMovie?.id === movie.id}
                onOpen={props.onOpenMovie}
                onPlay={props.onPlayMovie}
              />
            ))}
          </div>
        )}
      </section>

      {props.selectedMovie && (
        <MovieDetailsModal onClose={props.onCloseMovie}>
          <MovieEditor
            movie={props.selectedMovie}
            busy={props.busy}
            onSave={props.onSaveMovie}
            onDelete={props.onDeleteMovie}
            onAddImage={props.onAddImage}
            onRemoveImage={props.onRemoveImage}
            onPlayFile={props.onPlayFile}
            onReveal={props.onReveal}
          />
        </MovieDetailsModal>
      )}
    </div>
  );
}

function MovieCard({
  movie,
  selected,
  onOpen,
  onPlay
}: {
  movie: MovieSummary;
  selected: boolean;
  onOpen(id: string): void;
  onPlay(id: string): void;
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const stillUrls = movie.previewUrls;
  const activePreviewUrl = isPreviewing && stillUrls.length > 0 ? stillUrls[previewIndex] : movie.coverUrl;

  useEffect(() => {
    if (!isPreviewing || stillUrls.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setPreviewIndex((current) => (current + 1) % stillUrls.length);
    }, 1100);

    return () => window.clearInterval(timer);
  }, [isPreviewing, stillUrls.length]);

  useEffect(() => {
    setPreviewIndex(0);
  }, [movie.id, stillUrls.length]);

  return (
    <article className={`movie-card ${selected ? "selected" : ""}`}>
      <div
        className="poster poster-preview"
        onMouseEnter={() => {
          setPreviewIndex(0);
          setIsPreviewing(true);
        }}
        onMouseLeave={() => {
          setIsPreviewing(false);
          setPreviewIndex(0);
        }}
      >
        {activePreviewUrl ? <img src={activePreviewUrl} alt={movie.title} /> : <Clapperboard size={36} />}
        {isPreviewing && stillUrls.length > 1 && (
          <span className="preview-badge">
            {previewIndex + 1}/{stillUrls.length}
          </span>
        )}
      </div>

      <button className="movie-card-body" title="打开电影详情" onClick={() => onOpen(movie.id)}>
        <span className="movie-code">{movie.code}</span>
        <strong>{movie.title}</strong>
        <small>{[movie.year, movie.resolution, formatDuration(movie.durationSeconds)].filter(Boolean).join(" · ")}</small>
        <TagLine tags={[...movie.actors.slice(0, 2), ...movie.genres.slice(0, 1)]} />
      </button>

      <button className="movie-play-button" title="播放" onClick={() => onPlay(movie.id)}>
        <Play size={16} />
      </button>
    </article>
  );
}

function MovieDetailsModal({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="modal-panel movie-detail-modal" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" title="关闭" onClick={onClose}>
          <X size={18} />
        </button>
        {children}
      </div>
    </div>
  );
}

interface MovieEditorProps {
  movie: MovieDetails;
  busy: boolean;
  onSave(movie: MovieInput): void;
  onDelete(id: string): void;
  onAddImage(movieId: string, kind: "cover" | "still"): void;
  onRemoveImage(imageId: string): void;
  onPlayFile(fileId: string): void;
  onReveal(path: string): void;
}

function MovieEditor({ movie, busy, onSave, onDelete, onAddImage, onRemoveImage, onPlayFile, onReveal }: MovieEditorProps) {
  const [draft, setDraft] = useState<MovieInput>(() => detailsToInput(movie));

  useEffect(() => {
    setDraft(detailsToInput(movie));
  }, [movie]);

  const hasPersistentId = Boolean(movie.id);

  return (
    <div className="editor">
      <div className="cover-preview">
        {movie.coverUrl ? <img src={movie.coverUrl} alt={movie.title} /> : <Clapperboard size={44} />}
        {hasPersistentId && (
          <button onClick={() => onAddImage(movie.id, "cover")}>
            <ImagePlus size={16} />
            封面
          </button>
        )}
      </div>

      <div className="title-edit-row">
        <label className="field title-field">
          <span>标题</span>
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </label>
        <button className="primary" disabled={busy} onClick={() => onSave(draft)}>
          <Save size={16} />
          保存
        </button>
      </div>

      <div className="form-grid editor-info-grid">
        <Field label="影片番号">
          <input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
        </Field>
        <Field label="年份">
          <input value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} />
        </Field>
        <Field label="清晰度">
          <input value={draft.resolution ?? ""} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} />
        </Field>
        <Field label="时长">
          <input
            type="number"
            min={0}
            value={draft.durationSeconds ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, durationSeconds: event.target.value ? Number(event.target.value) : null })
            }
          />
        </Field>
        <Field label="主演" full>
          <TagInput value={draft.actors} onChange={(actors) => setDraft({ ...draft, actors })} placeholder="输入后回车" />
        </Field>
        <Field label="类型" full>
          <TagInput value={draft.genres} onChange={(genres) => setDraft({ ...draft, genres })} placeholder="输入后回车" />
        </Field>
      </div>

      <Field label="备注" full>
        <textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} />
      </Field>

      {hasPersistentId && (
        <>
          <SectionTitle title="视频文件" />
          <div className="file-list">
            {movie.files.length === 0 ? (
              <span className="muted">暂无绑定视频</span>
            ) : (
              movie.files.map((file) => (
                <div className="file-row" key={file.id}>
                  <div>
                    <strong title={file.path}>{file.filename}</strong>
                    <span>
                      {file.isPrimary ? "主文件 · " : ""}
                      {[file.resolution, formatDuration(file.durationSeconds), formatBytes(file.sizeBytes)].filter(Boolean).join(" · ")}
                    </span>
                    {file.status === "missing" && <StatusBadge status="missing" />}
                  </div>
                  <button title="播放" onClick={() => onPlayFile(file.id)}>
                    <Play size={16} />
                  </button>
                  <button title="定位文件" onClick={() => onReveal(file.path)}>
                    <FolderPlus size={16} />
                  </button>
                </div>
              ))
            )}
          </div>

          <SectionTitle title="剧照" action={<button onClick={() => onAddImage(movie.id, "still")}><ImagePlus size={16} />添加</button>} />
          <div className="still-grid">
            {movie.stills.map((still) => (
              <div className="still" key={still.id}>
                <img src={still.url} alt="剧照" />
                <button title="移除" onClick={() => onRemoveImage(still.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <button className="danger" onClick={() => onDelete(movie.id)}>
            <Trash2 size={16} />
            删除库记录
          </button>
        </>
      )}
    </div>
  );
}

interface UnclassifiedViewProps {
  files: UnclassifiedFile[];
  movies: MovieSummary[];
  selected: UnclassifiedFile | null;
  onSelect(file: UnclassifiedFile): void;
  onChooseSourceDirectory(): void;
  onCreate(file: UnclassifiedFile, movie: MovieInput): void;
  onBind(file: UnclassifiedFile, movieId: string, makePrimary: boolean): void;
  onIgnore(id: string): void;
  onReveal(path: string): void;
}

function UnclassifiedView({
  files,
  movies,
  selected,
  onSelect,
  onChooseSourceDirectory,
  onCreate,
  onBind,
  onIgnore,
  onReveal
}: UnclassifiedViewProps) {
  return (
    <div className="split-layout">
      <section className="content-pane">
        {files.length === 0 ? (
          <EmptyState
            icon={<ListFilter size={30} />}
            title="未分类为空"
            text="选择电影源文件目录后，支持格式的视频会被读取到这里等待整理。"
            action={
              <button className="primary" onClick={onChooseSourceDirectory}>
                <FolderOpen size={16} />
                选择电影源目录
              </button>
            }
          />
        ) : (
          <div className="unclassified-list">
            {files.map((file) => (
              <button
                key={file.id}
                className={`unclassified-row ${selected?.id === file.id ? "selected" : ""}`}
                onClick={() => onSelect(file)}
              >
                <div>
                  <strong title={file.path}>{file.filename}</strong>
                  <span>{file.path}</span>
                </div>
                <div className="row-meta">
                  <StatusBadge status={file.status} />
                  <span>{file.detectedCode || "未识别番号"}</span>
                  <span>{[file.resolution, formatDuration(file.durationSeconds), formatBytes(file.sizeBytes)].filter(Boolean).join(" · ")}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <aside className="detail-pane">
        {selected ? (
          <UnclassifiedEditor
            file={selected}
            movies={movies}
            onCreate={onCreate}
            onBind={onBind}
            onIgnore={onIgnore}
            onReveal={onReveal}
          />
        ) : (
          <EmptyState icon={<Pencil size={30} />} title="选择一个视频" text="补全信息后入库，或绑定到已有电影。" />
        )}
      </aside>
    </div>
  );
}

function UnclassifiedEditor({
  file,
  movies,
  onCreate,
  onBind,
  onIgnore,
  onReveal
}: {
  file: UnclassifiedFile;
  movies: MovieSummary[];
  onCreate(file: UnclassifiedFile, movie: MovieInput): void;
  onBind(file: UnclassifiedFile, movieId: string, makePrimary: boolean): void;
  onIgnore(id: string): void;
  onReveal(path: string): void;
}) {
  const [draft, setDraft] = useState<MovieInput>(() => fileToMovieInput(file));
  const [targetMovie, setTargetMovie] = useState("");
  const [makePrimary, setMakePrimary] = useState(false);

  useEffect(() => {
    setDraft(fileToMovieInput(file));
    setTargetMovie("");
    setMakePrimary(false);
  }, [file]);

  return (
    <div className="editor">
      <div className="editor-header">
        <div>
          <span>未分类处理</span>
          <strong>{file.detectedCode || "待识别"}</strong>
        </div>
        <StatusBadge status={file.status} />
      </div>

      <div className="file-summary">
        <strong title={file.path}>{file.filename}</strong>
        <span>{[file.resolution, formatDuration(file.durationSeconds), formatBytes(file.sizeBytes)].filter(Boolean).join(" · ")}</span>
        {file.probeError && <small>{file.probeError}</small>}
      </div>

      <SectionTitle title="新建电影入库" />
      <div className="form-grid">
        <Field label="影片番号">
          <input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} />
        </Field>
        <Field label="标题">
          <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
        </Field>
        <Field label="年份">
          <input value={draft.year} onChange={(event) => setDraft({ ...draft, year: event.target.value })} />
        </Field>
        <Field label="清晰度">
          <input value={draft.resolution ?? ""} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} />
        </Field>
        <Field label="主演">
          <TagInput value={draft.actors} onChange={(actors) => setDraft({ ...draft, actors })} placeholder="输入后回车" />
        </Field>
        <Field label="类型">
          <TagInput value={draft.genres} onChange={(genres) => setDraft({ ...draft, genres })} placeholder="输入后回车" />
        </Field>
      </div>

      <div className="action-row">
        <button className="primary" onClick={() => onCreate(file, draft)}>
          <Save size={16} />
          入库
        </button>
        <button onClick={() => onReveal(file.path)}>
          <FolderPlus size={16} />
          定位
        </button>
        <button className="danger" onClick={() => onIgnore(file.id)}>
          <X size={16} />
          忽略
        </button>
      </div>

      <SectionTitle title="绑定到已有电影" />
      <div className="bind-box">
        <select value={targetMovie} onChange={(event) => setTargetMovie(event.target.value)}>
          <option value="">选择电影</option>
          {movies.map((movie) => (
            <option key={movie.id} value={movie.id}>
              {movie.code} · {movie.title}
            </option>
          ))}
        </select>
        <label className="check-row">
          <input type="checkbox" checked={makePrimary} onChange={(event) => setMakePrimary(event.target.checked)} />
          设为主文件
        </label>
        <button disabled={!targetMovie} onClick={() => onBind(file, targetMovie, makePrimary)}>
          <Plus size={16} />
          绑定
        </button>
      </div>
    </div>
  );
}

interface SettingsViewProps {
  settings: AppSettings;
  dirs: LibraryDirectory[];
  onSettingsChange(settings: AppSettings): void;
  onChooseSourceDirectory(): void;
  onDirsChange(dirs: LibraryDirectory[]): Promise<void>;
  onRunTask<T>(task: () => Promise<T>, success?: string): Promise<T | null>;
}

function SettingsView({ settings, dirs, onSettingsChange, onChooseSourceDirectory, onDirsChange, onRunTask }: SettingsViewProps) {
  const [playerMode, setPlayerMode] = useState<PlayerMode>(settings.playerMode);
  const [playerPath, setPlayerPath] = useState(settings.playerPath);
  const [playerArgs, setPlayerArgs] = useState(settings.playerArgs);

  useEffect(() => {
    setPlayerMode(settings.playerMode);
    setPlayerPath(settings.playerPath);
    setPlayerArgs(settings.playerArgs);
  }, [settings]);

  return (
    <div className="settings-grid">
      <section className="settings-section">
        <SectionTitle title="数据目录" />
        <div className="path-line">
          <Database size={18} />
          <span title={settings.dataDir}>{settings.dataDir}</span>
        </div>
        <button
          onClick={() =>
            void onRunTask(async () => {
              const selected = await window.frameBox.selectDirectory();
              if (!selected) {
                return settings;
              }
              const next = await window.frameBox.setDataDir(selected);
              onSettingsChange(next);
              return next;
            }, "数据目录已更新")
          }
        >
          <FolderPlus size={16} />
          更改数据目录
        </button>
      </section>

      <section className="settings-section">
        <SectionTitle title="电影源目录" />
        <div className="directory-list">
          {dirs.length === 0 ? (
            <span className="muted">暂无电影源目录</span>
          ) : (
            dirs.map((dir) => (
              <div className="directory-row" key={dir.id}>
                <span title={dir.path}>{dir.path}</span>
                <button title="移除目录" onClick={() => void onRunTask(() => window.frameBox.removeLibraryDir(dir.id).then(onDirsChange))}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="action-row">
          <button className="primary" onClick={() => void onChooseSourceDirectory()}>
            <FolderOpen size={16} />
            选择电影源目录并读取
          </button>
          <button
            onClick={() =>
              void onRunTask(async () => {
                const files = await window.frameBox.rescanLibrary();
                await onDirsChange(await window.frameBox.listLibraryDirs());
                return files;
              }, "扫描完成")
            }
          >
            <RefreshCw size={16} />
            重新读取
          </button>
        </div>
      </section>

      <section className="settings-section">
        <SectionTitle title="播放器" />
        <div className="segmented">
          <button className={playerMode === "system" ? "active" : ""} onClick={() => setPlayerMode("system")}>
            系统默认
          </button>
          <button className={playerMode === "custom" ? "active" : ""} onClick={() => setPlayerMode("custom")}>
            自定义
          </button>
        </div>
        <Field label="播放器路径">
          <div className="input-with-button">
            <input value={playerPath} onChange={(event) => setPlayerPath(event.target.value)} placeholder="选择播放器 exe" />
            <button
              title="选择播放器"
              onClick={() =>
                void onRunTask(async () => {
                  const selected = await window.frameBox.selectPlayer();
                  if (selected) {
                    setPlayerPath(selected);
                  }
                  return selected;
                })
              }
            >
              <FolderPlus size={16} />
            </button>
          </div>
        </Field>
        <Field label="启动参数">
          <input value={playerArgs} onChange={(event) => setPlayerArgs(event.target.value)} placeholder="{file}" />
        </Field>
        <button
          className="primary"
          onClick={() =>
            void onRunTask(async () => {
              const next = await window.frameBox.updatePlayerSettings({ playerMode, playerPath, playerArgs });
              onSettingsChange(next);
              return next;
            }, "播放器设置已保存")
          }
        >
          <Save size={16} />
          保存播放器
        </button>
      </section>

      <section className="settings-section">
        <SectionTitle title="支持格式" />
        <div className="extension-list">
          {settings.supportedExtensions.map((extension) => (
            <span key={extension}>{extension}</span>
          ))}
        </div>
      </section>
    </div>
  );
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`field ${full ? "full" : ""}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function SectionTitle({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="section-title">
      <strong>{title}</strong>
      {action}
    </div>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange(value: string[]): void; placeholder: string }) {
  const [text, setText] = useState("");

  function commit() {
    const next = text.trim();
    if (!next) {
      return;
    }
    onChange(Array.from(new Set([...value, next])));
    setText("");
  }

  return (
    <div className="tag-input">
      {value.map((tag) => (
        <button key={tag} type="button" onClick={() => onChange(value.filter((item) => item !== tag))}>
          {tag}
          <X size={12} />
        </button>
      ))}
      <input
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
          if (event.key === "Backspace" && !text && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
      />
    </div>
  );
}

function TagLine({ tags }: { tags: string[] }) {
  if (tags.length === 0) {
    return <span className="tag-line">未设置标签</span>;
  }

  return (
    <span className="tag-line">
      {tags.map((tag) => (
        <em key={tag}>{tag}</em>
      ))}
    </span>
  );
}

function StatusBadge({ status }: { status: UnclassifiedFile["status"] | "missing" }) {
  const text =
    status === "conflict" ? "番号冲突" : status === "parse_error" ? "解析异常" : status === "missing" ? "文件缺失" : "待整理";
  return <span className={`status ${status}`}>{text}</span>;
}

function EmptyState({
  icon,
  title,
  text,
  action
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{text}</span>
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

function detailsToInput(movie: MovieDetails): MovieInput {
  return {
    id: movie.id || undefined,
    code: movie.code,
    title: movie.title,
    year: movie.year,
    actors: movie.actors,
    genres: movie.genres,
    durationSeconds: movie.durationSeconds,
    resolution: movie.resolution,
    coverPath: movie.coverPath,
    notes: movie.notes
  };
}

function movieInputToDetails(movie: MovieInput): MovieDetails {
  return {
    id: movie.id || "",
    code: movie.code,
    title: movie.title,
    year: movie.year,
    actors: movie.actors,
    genres: movie.genres,
    durationSeconds: movie.durationSeconds,
    resolution: movie.resolution,
    coverPath: movie.coverPath,
    coverUrl: null,
    previewUrls: [],
    fileCount: 0,
    files: [],
    stills: [],
    notes: movie.notes,
    createdAt: "",
    updatedAt: ""
  };
}

function fileToMovieInput(file: UnclassifiedFile): MovieInput {
  return {
    code: file.detectedCode ?? "",
    title: file.detectedCode ?? file.filename.replace(/\.[^.]+$/, ""),
    year: "",
    actors: [],
    genres: [],
    durationSeconds: file.durationSeconds,
    resolution: file.resolution,
    coverPath: null,
    notes: ""
  };
}

function formatDuration(seconds: number | null): string {
  if (!seconds) {
    return "";
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}小时${minutes.toString().padStart(2, "0")}分`;
  }

  return `${minutes}分`;
}

function formatBytes(bytes: number): string {
  if (!bytes) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
