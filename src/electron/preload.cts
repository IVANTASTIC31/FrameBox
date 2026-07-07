import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  AddImagePayload,
  BindUnclassifiedPayload,
  CreateMovieFromUnclassifiedPayload,
  FrameBoxApi,
  MovieSourceReadProgress,
  SaveMoviePayload,
  SearchMoviesPayload
} from "../shared/types.js";

const api: FrameBoxApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  selectDirectory: () => ipcRenderer.invoke("dialog:selectDirectory"),
  selectPlayer: () => ipcRenderer.invoke("dialog:selectPlayer"),
  selectImage: () => ipcRenderer.invoke("dialog:selectImage"),
  setDataDir: (path) => ipcRenderer.invoke("settings:setDataDir", path),
  updatePlayerSettings: (settings) => ipcRenderer.invoke("settings:updatePlayer", settings),
  listLibraryDirs: () => ipcRenderer.invoke("libraryDirs:list"),
  addLibraryDir: (path) => ipcRenderer.invoke("libraryDirs:add", path),
  removeLibraryDir: (id) => ipcRenderer.invoke("libraryDirs:remove", id),
  rescanLibrary: () => ipcRenderer.invoke("library:rescan"),
  listUnclassified: () => ipcRenderer.invoke("unclassified:list"),
  ignoreUnclassified: (id) => ipcRenderer.invoke("unclassified:ignore", id),
  createMovieFromUnclassified: (payload: CreateMovieFromUnclassifiedPayload) =>
    ipcRenderer.invoke("unclassified:createMovie", payload),
  bindUnclassifiedToMovie: (payload: BindUnclassifiedPayload) =>
    ipcRenderer.invoke("unclassified:bindMovie", payload),
  listMovies: (payload?: SearchMoviesPayload) => ipcRenderer.invoke("movies:list", payload),
  getMovie: (id) => ipcRenderer.invoke("movies:get", id),
  saveMovie: (payload: SaveMoviePayload) => ipcRenderer.invoke("movies:save", payload),
  deleteMovie: (id) => ipcRenderer.invoke("movies:delete", id),
  addMovieImage: (payload: AddImagePayload) => ipcRenderer.invoke("movies:addImage", payload),
  removeMovieImage: (id) => ipcRenderer.invoke("movies:removeImage", id),
  playMovieFile: (fileId) => ipcRenderer.invoke("movies:playFile", fileId),
  revealPath: (path) => ipcRenderer.invoke("shell:revealPath", path),
  onChooseMovieSource: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("movieSource:choose", listener);
    return () => ipcRenderer.removeListener("movieSource:choose", listener);
  },
  onMovieSourceReading: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: { path: string }) => callback(payload);
    ipcRenderer.on("movieSource:reading", listener);
    return () => ipcRenderer.removeListener("movieSource:reading", listener);
  },
  onMovieSourceReadProgress: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: MovieSourceReadProgress) => callback(payload);
    ipcRenderer.on("movieSource:readProgress", listener);
    return () => ipcRenderer.removeListener("movieSource:readProgress", listener);
  },
  onMovieSourceSelected: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: { path: string; unclassifiedCount: number }) => callback(payload);
    ipcRenderer.on("movieSource:selected", listener);
    return () => ipcRenderer.removeListener("movieSource:selected", listener);
  },
  onMovieSourceReadFailed: (callback) => {
    const listener = (_event: IpcRendererEvent, payload: { path: string; message: string }) => callback(payload);
    ipcRenderer.on("movieSource:readFailed", listener);
    return () => ipcRenderer.removeListener("movieSource:readFailed", listener);
  }
};

contextBridge.exposeInMainWorld("frameBox", api);
