import path from "node:path";
import fsp from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type MenuItemConstructorOptions,
  type OpenDialogOptions
} from "electron";
import { pathToFileURL } from "node:url";
import type {
  AddImagePayload,
  BindUnclassifiedPayload,
  CreateMovieFromUnclassifiedPayload,
  MovieSourceReadProgress,
  SaveMoviePayload,
  SearchMoviesPayload
} from "../shared/types.js";
import { AssetService } from "./services/assets.js";
import { DataDirectoryService } from "./services/dataDirectory.js";
import { DatabaseService } from "./services/database.js";
import { FileScannerService } from "./services/fileScanner.js";
import { MediaProbeService } from "./services/mediaProbe.js";
import { PlayerService } from "./services/player.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;

const dataDirectory = new DataDirectoryService();
const database = new DatabaseService();
const mediaProbe = new MediaProbeService();
const player = new PlayerService();
const assets = new AssetService(() => dataDirectory.getPaths());
const scanner = new FileScannerService(database, mediaProbe);

app.commandLine.appendSwitch("lang", "zh-CN");

function sendMovieSourceProgress(progress: MovieSourceReadProgress): void {
  mainWindow?.webContents.send("movieSource:readProgress", progress);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: "FrameBox",
    backgroundColor: "#f7f5ef",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (app.isPackaged) {
    const rendererPath = path.join(__dirname, "..", "..", "dist", "index.html");
    void window.loadURL(pathToFileURL(rendererPath).href);
  } else {
    void window.loadURL("http://127.0.0.1:5173");
    window.webContents.openDevTools({ mode: "detach" });
  }

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  mainWindow = window;
  return window;
}

function setChineseApplicationMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        {
          label: "选择电影源目录并读取",
          accelerator: "Ctrl+O",
          click: () => void chooseMovieSourceFromMain()
        },
        { label: "重新扫描电影目录", accelerator: "F5", click: () => void scanner.scanAll(sendMovieSourceProgress).then(sendUnclassifiedChanged) },
        { type: "separator" },
        { label: "退出", accelerator: "Alt+F4", click: () => app.quit() }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { label: "撤销", role: "undo" },
        { label: "重做", role: "redo" },
        { type: "separator" },
        { label: "剪切", role: "cut" },
        { label: "复制", role: "copy" },
        { label: "粘贴", role: "paste" },
        { label: "全选", role: "selectAll" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { label: "重新加载窗口", role: "reload" },
        { label: "强制重新加载", role: "forceReload" },
        { type: "separator" },
        { label: "实际大小", role: "resetZoom" },
        { label: "放大", role: "zoomIn" },
        { label: "缩小", role: "zoomOut" },
        { type: "separator" },
        { label: "全屏", role: "togglefullscreen" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 FrameBox",
          click: () => {
            const options = {
              type: "info" as const,
              title: "关于 FrameBox",
              message: "FrameBox",
              detail: "本地电影库管理工具\n版本 0.1.0"
            };
            void (mainWindow ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options));
          }
        }
      ]
    }
  ];

  if (!app.isPackaged) {
    template[2].submenu = [
      ...(template[2].submenu as MenuItemConstructorOptions[]),
      { type: "separator" },
      { label: "开发者工具", role: "toggleDevTools" }
    ];
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function chooseMovieSourceFromMain(): Promise<void> {
  const result = await showOpenDialog({
    title: "选择电影源目录",
    properties: ["openDirectory", "createDirectory"]
  });

  if (result.canceled || !result.filePaths[0]) {
    return;
  }

  const selectedPath = result.filePaths[0];
  mainWindow?.webContents.send("movieSource:reading", { path: selectedPath });

  try {
    await database.addLibraryDir(selectedPath);
    const files = await scanner.scanAll(sendMovieSourceProgress);
    await scanner.watchAll(sendUnclassifiedChanged);

    if (mainWindow) {
      mainWindow.webContents.send("unclassified:changed", files);
      mainWindow.webContents.send("movieSource:selected", {
        path: selectedPath,
        unclassifiedCount: files.length
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    mainWindow?.webContents.send("movieSource:readFailed", {
      path: selectedPath,
      message
    });
  }
}

function sendUnclassifiedChanged(): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send("unclassified:changed", database.listUnclassified());
}

function registerIpcHandlers(): void {
  ipcMain.handle("app:getStartupWarning", () => dataDirectory.getStartupWarning());

  ipcMain.handle("settings:get", () => database.getSettings());

  ipcMain.handle("dialog:selectDirectory", async () => {
    const result = await showOpenDialog({
      title: "选择目录",
      properties: ["openDirectory", "createDirectory"]
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:selectPlayer", async () => {
    const result = await showOpenDialog({
      title: "选择播放器",
      filters: [{ name: "播放器", extensions: ["exe"] }],
      properties: ["openFile"]
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("dialog:selectImage", async () => {
    const result = await showOpenDialog({
      title: "选择图片",
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }],
      properties: ["openFile"]
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("settings:setDataDir", async (_event, nextDataDir: string) => {
    const paths = await dataDirectory.changeDataDir(nextDataDir, () => database.exportBytes());
    await database.rehome(paths);
    await scanner.scanAll(sendMovieSourceProgress);
    await scanner.watchAll(sendUnclassifiedChanged);
    return database.getSettings();
  });

  ipcMain.handle("settings:updatePlayer", async (_event, settings) => database.updatePlayerSettings(settings));

  ipcMain.handle("libraryDirs:list", () => database.listLibraryDirs());

  ipcMain.handle("libraryDirs:add", async (_event, dirPath: string) => {
    const dirs = await database.addLibraryDir(dirPath);
    await scanner.scanAll(sendMovieSourceProgress);
    await scanner.watchAll(sendUnclassifiedChanged);
    sendUnclassifiedChanged();
    return dirs;
  });

  ipcMain.handle("libraryDirs:remove", async (_event, id: string) => {
    const dirs = await database.removeLibraryDir(id);
    await scanner.watchAll(sendUnclassifiedChanged);
    return dirs;
  });

  ipcMain.handle("library:rescan", async () => {
    const files = await scanner.scanAll(sendMovieSourceProgress);
    sendUnclassifiedChanged();
    return files;
  });

  ipcMain.handle("unclassified:list", () => database.listUnclassified());
  ipcMain.handle("unclassified:ignore", async (_event, id: string) => {
    const files = await database.ignoreUnclassified(id);
    sendUnclassifiedChanged();
    return files;
  });

  ipcMain.handle("unclassified:createMovie", async (_event, payload: CreateMovieFromUnclassifiedPayload) => {
    const movie = await database.createMovieFromUnclassified(payload);
    sendUnclassifiedChanged();
    return movie;
  });

  ipcMain.handle("unclassified:bindMovie", async (_event, payload: BindUnclassifiedPayload) => {
    const movie = await database.bindUnclassifiedToMovie(payload);
    sendUnclassifiedChanged();
    return movie;
  });

  ipcMain.handle("movies:list", (_event, payload?: SearchMoviesPayload) => database.listMovies(payload?.query ?? ""));
  ipcMain.handle("movies:get", (_event, id: string) => database.getMovie(id));
  ipcMain.handle("movies:save", (_event, payload: SaveMoviePayload) => database.saveMovie(payload));
  ipcMain.handle("movies:delete", async (_event, id: string) => database.deleteMovie(id));

  ipcMain.handle("movies:addImage", async (_event, payload: AddImagePayload) => {
    const result = await showOpenDialog({
      title: payload.kind === "cover" ? "选择封面" : "选择剧照",
      filters: [{ name: "图片", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }],
      properties: payload.kind === "still" ? ["openFile", "multiSelections"] : ["openFile"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    let updated = database.getMovie(payload.movieId);
    for (const filePath of result.filePaths) {
      const copied = await assets.copyImage(filePath, payload.kind);
      updated = await database.addMovieImage(payload.movieId, payload.kind, copied);
    }

    return updated;
  });

  ipcMain.handle("movies:removeImage", (_event, id: string) => database.removeMovieImage(id));

  ipcMain.handle("movies:playFile", async (_event, fileId: string) => {
    const file = database.getMovieFile(fileId);
    if (!file) {
      throw new Error("未找到视频文件。");
    }

    const readable = await pathIsReadable(file.path);
    await database.markMovieFileStatus(file.path, readable);
    await database.flush();
    if (!readable) {
      throw new Error(`无法读取视频文件：${file.path}。请确认对应硬盘、移动存储或网络位置已连接。`);
    }

    await player.play(file, database.getSettings());
  });

  ipcMain.handle("shell:revealPath", async (_event, targetPath: string) => {
    if (!(await pathIsReadable(targetPath))) {
      throw new Error(`无法定位文件：${targetPath}。请确认对应存储设备已连接。`);
    }

    shell.showItemInFolder(targetPath);
  });
}

function showOpenDialog(options: OpenDialogOptions) {
  return mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options);
}

async function pathIsReadable(targetPath: string): Promise<boolean> {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

app.whenReady().then(async () => {
  app.setName("FrameBox");
  setChineseApplicationMenu();
  const paths = await dataDirectory.init();
  await database.init(paths);
  registerIpcHandlers();
  createWindow();
  await scanner.scanAll();
  await scanner.watchAll(sendUnclassifiedChanged);
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on("window-all-closed", () => {
  scanner.closeWatchers();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
