import fs from "node:fs/promises";
import path from "node:path";
import type { ImageKind } from "../../shared/types.js";
import type { FrameBoxPaths } from "./dataDirectory.js";
import { createId } from "../utils/id.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);

export class AssetService {
  constructor(private getPaths: () => FrameBoxPaths) {}

  async copyImage(sourcePath: string, kind: ImageKind): Promise<string> {
    const ext = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new Error("请选择 jpg、png、webp 或 bmp 图片。");
    }

    const paths = this.getPaths();
    const targetDir = kind === "cover" ? paths.coversDir : paths.stillsDir;
    const targetPath = path.join(targetDir, `${createId(kind)}${ext}`);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    return targetPath;
  }
}
