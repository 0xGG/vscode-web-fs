/**
 * File System Provider for Native File System
 * Referred from https://github.com/microsoft/vscode-extension-samples/blob/main/fsprovider-sample/src/fileSystemProvider.ts
 */

import Dexie from "dexie";
import { nanoid } from "nanoid";
import * as path from "path";
import { nativeFSPrefix } from "./nativeFSUtil";

/** A few type from vscode */
enum FileType {
  /**
   * The file type is unknown.
   */
  Unknown = 0,
  /**
   * A regular file.
   */
  File = 1,
  /**
   * A directory.
   */
  Directory = 2,
  /**
   * A symbolic link to a file.
   */
  SymbolicLink = 64,
}

/**
 * The `FileStat`-type represents metadata about a file
 */
export interface FileStat {
  /**
   * The type of the file, e.g. is a regular file, a directory, or symbolic link
   * to a file.
   *
   * *Note:* This value might be a bitmask, e.g. `FileType.File | FileType.SymbolicLink`.
   */
  type: FileType;
  /**
   * The creation timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
   */
  ctime: number;
  /**
   * The modification timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
   *
   * *Note:* If the file changed, it is important to provide an updated `mtime` that advanced
   * from the previous value. Otherwise there may be optimizations in place that will not show
   * the updated file contents in an editor for example.
   */
  mtime: number;
  /**
   * The size in bytes.
   *
   * *Note:* If the file changed, it is important to provide an updated `size`. Otherwise there
   * may be optimizations in place that will not show the updated file contents in an editor for
   * example.
   */
  size: number;
}

interface Uri {
  scheme?: string;
  path: string;
  authority?: string;
  query?: string;
  fragment?: string;
}

function FileNotFound(uri: Uri) {
  return new Error(`NativeFS FileNotFound ${uri.path}`);
}

function FileExists(uri: Uri) {
  return new Error(`NativeFS FileExists ${uri.path}`);
}

/**
 * Enumeration of file change types.
 */
enum FileChangeType {
  /**
   * The contents or metadata of a file have changed.
   */
  Changed = 1,

  /**
   * A file has been created.
   */
  Created = 2,

  /**
   * A file has been deleted.
   */
  Deleted = 3,
}

/**
 * The event filesystem providers must use to signal a file change.
 */
interface FileChangeEvent {
  /**
   * The type of change.
   */
  readonly type: FileChangeType;

  /**
   * The uri of the file that has changed.
   */
  readonly uri: Uri;
}

export async function verifyPermission(
  fileHandle: FileSystemHandle,
  mode?: FileSystemPermissionMode
) {
  const options: FileSystemHandlePermissionDescriptor = {
    mode,
  };
  if (!fileHandle) {
    return false;
  }
  // Check if permission was already granted. If so, return true.
  if ((await fileHandle.queryPermission(options)) === "granted") {
    return true;
  }

  // Request permission. If the user grants permission, return true.
  if ((await fileHandle.requestPermission(options)) === "granted") {
    return true;
  }
  // The user didn't grant permission, so return false.
  return false;
}

let registered = false;
export function registerNativeFS(product: any) {
  if (registered) {
    return;
  } else {
    registered = true;
  }
  const nativeFS = new NativeFS();
  const commands = product.commands || [];
  commands.push(
    {
      id: "nativeFS.showDirectoryPicker",
      handler: async () => {
        const directoryHandle = await window.showDirectoryPicker();
        const rootDir = nativeFS.attachDirectory(directoryHandle);
        return rootDir;
      },
    },
    {
      id: "nativeFS.stat",
      async handler(uri: Uri) {
        return await nativeFS.stat(uri);
      },
    },
    {
      id: "nativeFS.readDirectory",
      async handler(uri: Uri) {
        return await nativeFS.readDirectory(uri);
      },
    },
    {
      id: "nativeFS.readRootDirectories",
      async handler() {
        return await nativeFS.readRootDirectories();
      },
    },
    {
      id: "nativeFS.readFile",
      async handler(uri: Uri) {
        return await nativeFS.readFile(uri);
      },
    },
    {
      id: "nativeFS.writeFile",
      async handler(
        uri: Uri,
        content: number[],
        options: { create: boolean; overwrite: boolean }
      ) {
        return await nativeFS.writeFile(uri, content, options);
      },
    },
    {
      id: "nativeFS.rename",
      async handler(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }) {
        return await nativeFS.rename(oldUri, newUri, options);
      },
    },
    {
      id: "nativeFS.delete",
      async handler(uri: Uri, options: { recursive: boolean }) {
        return await nativeFS.delete(uri, options);
      },
    },
    {
      id: "nativeFS.createDirectory",
      async handler(uri: Uri) {
        return await nativeFS.createDirectory(uri);
      },
    }
  );
}

interface DirectoryHandleEntry {
  rootDir: string;
  handle: FileSystemDirectoryHandle;
}

class DirectoryHandleDatabase extends Dexie {
  entries: Dexie.Table<DirectoryHandleEntry, number>;

  constructor(databaseName = "nativefs_directory_handles") {
    super(databaseName);
    this.version(1).stores({
      entries: "rootDir,handle",
    });
    this.entries = this.table("entries");
  }
}

export class NativeFS {
  /**
   * Its key is in format of /$RANDOM_ID/$DIRECTORY_NAME
   */
  private directoryHandleMap: {
    [key: string]: FileSystemDirectoryHandle;
  } = {};

  private db: DirectoryHandleDatabase;

  constructor() {
    this.db = new DirectoryHandleDatabase();
    this.initDatabase();
  }

  private async initDatabase() {
    await this.db.open();
    this.db.entries.each((entry) => {
      this.directoryHandleMap[entry.rootDir] = entry.handle;
    });
  }

  // --- attach local directory
  public async attachDirectory(
    directoryHandle: FileSystemDirectoryHandle
  ): Promise<string> {
    const rootDir =
      nativeFSPrefix + nanoid(8) + "/" + directoryHandle.name + "/";
    this.directoryHandleMap[rootDir] = directoryHandle;
    await this.db.entries.put({
      rootDir,
      handle: directoryHandle,
    });
    return rootDir;
  }

  public async helper(
    path: string,
    mode: FileSystemPermissionMode = "readwrite"
  ): Promise<[FileSystemDirectoryHandle, string[]]> {
    const pathArr = path.replace(/\/+$/, "").split("/");
    const rootDir = "/" + pathArr[1] + "/" + pathArr[2] + "/";
    const directoryHandle = this.directoryHandleMap[rootDir];
    await verifyPermission(directoryHandle, mode);
    return [directoryHandle, pathArr.slice(3, pathArr.length)];
  }

  // --- manage file metadata

  public async stat(uri: Uri): Promise<FileStat> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    }
    let i = 0;
    for (; i < pathArr.length - 1; i++) {
      directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
    }

    const getDirectoryHandleStat = async (
      directoryHandle: FileSystemDirectoryHandle
    ) => {
      let size = 0;
      for await (const entry of directoryHandle.values()) {
        size += 1;
      }
      const stat: FileStat = {
        type: FileType.Directory,
        ctime: 0, // This is now wrong
        mtime: 0, // This is now wrong
        size,
      };
      return stat;
    };

    if (!pathArr.length) {
      return await getDirectoryHandleStat(directoryHandle);
    }

    // Check if it's file
    try {
      const fHandle = await directoryHandle.getFileHandle(pathArr[i]);
      const file = await fHandle.getFile(); // https://w3c.github.io/FileAPI/#dfn-file
      const stat: FileStat = {
        type: FileType.File,
        ctime: file.lastModified, // <= This is now wrong
        mtime: file.lastModified,
        size: file.size,
      };
      return stat;
    } catch (error) {
      // Check if it's directory
      try {
        const dHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
        return await getDirectoryHandleStat(dHandle);
      } catch (error) {
        throw error;
      }
    }
  }

  public async readDirectory(uri: Uri): Promise<[string, FileType][]> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    } else {
      let i = 0;
      for (; i < pathArr.length; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
      }
      const result: [string, FileType][] = [];
      for await (const entry of directoryHandle.values()) {
        result.push([
          entry.name,
          entry.kind === "directory" ? FileType.Directory : FileType.File,
        ]);
      }
      return result;
    }
  }

  public async readRootDirectories(): Promise<string[]> {
    const result: string[] = [];
    for (const rootDir in this.directoryHandleMap) {
      result.push(rootDir);
    }
    return result;
  }

  // --- manage file contents

  public async readFile(uri: Uri): Promise<number[]> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    } else {
      let i = 0;
      for (; i < pathArr.length - 1; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
      }
      const file = await (
        await directoryHandle.getFileHandle(pathArr[i])
      ).getFile();
      return Array.from(new Uint8Array(await file.arrayBuffer()));
    }
  }

  public async writeFile(
    uri: Uri,
    content: number[],
    options: { create: boolean; overwrite: boolean }
  ): Promise<{ events: FileChangeEvent[] }> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    } else {
      let i = 0;
      for (; i < pathArr.length - 1; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i], {
          create: options.create,
        });
      }

      let exists = false;
      for await (const entry of directoryHandle.values()) {
        if (entry.name === pathArr[i]) {
          exists = true;
          break;
        }
      }
      if (!exists && !options.create) {
        throw FileNotFound(uri);
      }
      if (exists && options.create && !options.overwrite) {
        throw FileExists(uri);
      }

      const fileHandle = await directoryHandle.getFileHandle(pathArr[i], {
        create: options.create,
      });
      const events: FileChangeEvent[] = [];
      if (!exists) {
        events.push({ type: FileChangeType.Created, uri });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(Uint8Array.from(content));
      await (writable as any).close();
      events.push({ type: FileChangeType.Changed, uri });
      return {
        events,
      };
    }
  }

  // --- manage files/folders

  public async rename(
    oldUri: Uri,
    newUri: Uri,
    options: { overwrite: boolean }
  ): Promise<{ events: FileChangeEvent[] }> {
    const data = await this.readFile(oldUri);
    await this.writeFile(newUri, data, {
      create: true,
      overwrite: options.overwrite,
    });
    await this.delete(oldUri, { recursive: true });
    return {
      events: [
        { type: FileChangeType.Deleted, uri: oldUri },
        { type: FileChangeType.Created, uri: newUri },
      ],
    };
  }

  public async delete(
    uri: Uri,
    options: { recursive: boolean }
  ): Promise<{ events: FileChangeEvent[] }> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    }
    let i = 0;
    for (; i < pathArr.length - 1; i++) {
      directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
    }
    await directoryHandle.removeEntry(pathArr[i], {
      recursive: options.recursive,
    });
    const dirname: Uri = {
      scheme: "nativefs",
      path: path.posix.dirname(uri.path),
      authority: "",
      query: "",
      fragment: "",
    };
    return {
      events: [
        {
          type: FileChangeType.Changed,
          uri: dirname,
        },
        { uri, type: FileChangeType.Deleted },
      ],
    };
  }

  public async createDirectory(
    uri: Uri
  ): Promise<{ events: FileChangeEvent[] }> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw FileNotFound(uri);
    } else {
      for (let i = 0; i < pathArr.length; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i], {
          create: true,
        });
      }
    }
    const dirname: Uri = {
      scheme: "nativefs",
      path: path.posix.dirname(uri.path),
      authority: "",
      query: "",
      fragment: "",
    };

    return {
      events: [
        { type: FileChangeType.Changed, uri: dirname },
        { type: FileChangeType.Created, uri },
      ],
    };
  }
}
