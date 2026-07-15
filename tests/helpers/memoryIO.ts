export type MemoryFile = string | Uint8Array;

export interface MemoryIOHarness {
  delete(path: string): void;
  exists(path: string): boolean;
  operations: {
    directories: string[];
    textWrites: string[];
    writes: Array<{ flush?: boolean; path: string }>;
  };
  readBytes(path: string): number[] | undefined;
  readText(path: string): string | undefined;
  restore(): void;
  writeBytes(path: string, value: Uint8Array): void;
  writeText(path: string, value: string): void;
}

export function installMemoryIO(): MemoryIOHarness {
  const previousIOUtils = globalThis.IOUtils;
  const previousPathUtils = globalThis.PathUtils;
  const directories = new Set<string>();
  const files = new Map<string, MemoryFile>();
  const operations: MemoryIOHarness["operations"] = {
    directories: [],
    textWrites: [],
    writes: [],
  };

  globalThis.PathUtils = {
    filename: (path: string) => path.split("/").filter(Boolean).at(-1) ?? "",
    join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  } as unknown as typeof PathUtils;
  globalThis.IOUtils = {
    exists: async (path: string) =>
      files.has(path) ||
      directories.has(path) ||
      [...files.keys(), ...directories].some((entry) =>
        entry.startsWith(`${path}/`),
      ),
    getChildren: async (path: string) => {
      const prefix = `${path}/`;
      return [
        ...new Set(
          [...files.keys(), ...directories]
            .filter((entry) => entry.startsWith(prefix))
            .map(
              (entry) => `${path}/${entry.slice(prefix.length).split("/")[0]}`,
            ),
        ),
      ];
    },
    makeDirectory: async (path: string) => {
      operations.directories.push(path);
      directories.add(path);
    },
    move: async (source: string, destination: string) => {
      const value = files.get(source);
      if (value === undefined) throw new Error(`Missing source: ${source}`);
      files.set(destination, value);
      files.delete(source);
    },
    read: async (path: string) => {
      const value = files.get(path);
      if (!(value instanceof Uint8Array)) {
        throw new Error(`Missing bytes: ${path}`);
      }
      return Uint8Array.from(value);
    },
    readUTF8: async (path: string) => {
      const value = files.get(path);
      if (typeof value !== "string") throw new Error(`Missing text: ${path}`);
      return value;
    },
    remove: async (path: string, options?: { recursive?: boolean }) => {
      files.delete(path);
      directories.delete(path);
      if (options?.recursive) {
        for (const candidate of files.keys()) {
          if (candidate.startsWith(`${path}/`)) files.delete(candidate);
        }
        for (const candidate of directories) {
          if (candidate.startsWith(`${path}/`)) directories.delete(candidate);
        }
      }
    },
    write: async (
      path: string,
      bytes: Uint8Array,
      options?: { flush?: boolean },
    ) => {
      operations.writes.push({ flush: options?.flush, path });
      files.set(path, Uint8Array.from(bytes));
      return bytes.byteLength;
    },
    writeUTF8: async (path: string, value: string) => {
      operations.textWrites.push(path);
      files.set(path, value);
      return value.length;
    },
  } as unknown as typeof IOUtils;

  return {
    delete: (path) => files.delete(path),
    exists: (path) => files.has(path),
    operations,
    readBytes: (path) => {
      const value = files.get(path);
      return value instanceof Uint8Array ? Array.from(value) : undefined;
    },
    readText: (path) => {
      const value = files.get(path);
      return typeof value === "string" ? value : undefined;
    },
    restore: () => {
      globalThis.IOUtils = previousIOUtils;
      globalThis.PathUtils = previousPathUtils;
    },
    writeBytes: (path, value) => files.set(path, Uint8Array.from(value)),
    writeText: (path, value) => files.set(path, value),
  };
}
