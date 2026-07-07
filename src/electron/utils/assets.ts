import { pathToFileURL } from "node:url";

export function toFileUrl(filePath: string | null | undefined): string | null {
  if (!filePath) {
    return null;
  }

  return pathToFileURL(filePath).href;
}
