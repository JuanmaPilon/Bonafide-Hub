import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const communicationsBaseDir = path.resolve(
  process.cwd(),
  "docs",
  "comunicados",
);

export async function getCommunicationContent(
  relativePath: string,
): Promise<string> {
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error("El archivo no puede estar vacio");
  }

  const sanitizedPath = trimmed.replaceAll("\\", "/");
  if (!sanitizedPath.endsWith(".md")) {
    throw new Error("El archivo debe terminar en .md");
  }

  const resolvedPath = path.resolve(communicationsBaseDir, sanitizedPath);
  if (!resolvedPath.startsWith(`${communicationsBaseDir}${path.sep}`)) {
    throw new Error("Ruta de archivo invalida");
  }

  return readFile(resolvedPath, "utf8");
}

export function splitForDiscord(content: string, maxLength = 1900): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > maxLength) {
    const splitIndex = remaining.lastIndexOf("\n", maxLength);
    const safeSplitIndex = splitIndex > 0 ? splitIndex : maxLength;

    chunks.push(remaining.slice(0, safeSplitIndex).trim());
    remaining = remaining.slice(safeSplitIndex).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

async function readMarkdownFilesRecursively(
  baseDir: string,
  currentDir: string,
): Promise<string[]> {
  const entries = await readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.resolve(currentDir, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await readMarkdownFilesRecursively(
        baseDir,
        absolutePath,
      );
      files.push(...nestedFiles);
      continue;
    }

    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const relativePath = path
      .relative(baseDir, absolutePath)
      .replaceAll("\\", "/");
    files.push(relativePath);
  }

  return files;
}

export async function listCommunicationFiles(
  filterText: string,
): Promise<string[]> {
  const normalizedFilter = filterText.trim().toLowerCase();

  const files = await readMarkdownFilesRecursively(
    communicationsBaseDir,
    communicationsBaseDir,
  ).catch((error: unknown) => {
    const maybeFsError = error as NodeJS.ErrnoException;
    if (maybeFsError.code === "ENOENT") {
      return [];
    }

    throw error;
  });

  const filtered = files.filter((file) =>
    file.toLowerCase().includes(normalizedFilter),
  );

  return filtered.sort((a, b) => a.localeCompare(b)).slice(0, 25);
}
