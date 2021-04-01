/**
 * File System Provider for Native File System
 * Referred from https://github.com/microsoft/vscode-extension-samples/blob/main/fsprovider-sample/src/fileSystemProvider.ts
 */

import { nanoid } from "nanoid";
import * as vscode from "vscode";

export async function verifyPermission(
  fileHandle: FileSystemHandle,
  mode?: FileSystemPermissionMode
) {
  const options: FileSystemHandlePermissionDescriptor = {
    mode,
  };
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

export class NativeFS implements vscode.FileSystemProvider {
  /**
   * Its key is in format of /$RANDOM_ID/$DIRECTORY_NAME
   */
  private directoryHandleMap: { [key: string]: FileSystemDirectoryHandle } = {};

  // --- attach local directory
  public async attachDirectory(
    directoryHandle: FileSystemDirectoryHandle
  ): Promise<string> {
    const rootDir = "/" + nanoid(8) + "/" + directoryHandle.name + "/";
    this.directoryHandleMap[rootDir] = directoryHandle;
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

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    let i = 0;
    for (; i < pathArr.length - 1; i++) {
      directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
    }
    // Check if it's file
    try {
      const fHandle = await directoryHandle.getFileHandle(pathArr[i]);
      const file = await fHandle.getFile(); // https://w3c.github.io/FileAPI/#dfn-file
      const stat: vscode.FileStat = {
        type: vscode.FileType.File,
        ctime: file.lastModified, // <= This is now wrong
        mtime: file.lastModified,
        size: file.size,
      };
      return stat;
    } catch (error) {
      // Check if it's directory
      try {
        const dHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
        let size = 0;
        for await (const entry of directoryHandle.values()) {
          size += 1;
        }

        const stat: vscode.FileStat = {
          type: vscode.FileType.Directory,
          ctime: 0, // This is now wrong
          mtime: 0, // This is now wrong
          size,
        };
        return stat;
      } catch (error) {
        throw error;
      }
    }
  }

  public async readDirectory(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
    } else {
      let i = 0;
      for (; i < pathArr.length; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
      }
      const result: [string, vscode.FileType][] = [];
      for await (const entry of directoryHandle.values()) {
        result.push([
          entry.name,
          entry.kind === "directory"
            ? vscode.FileType.Directory
            : vscode.FileType.File,
        ]);
      }
      return result;
    }
  }

  // --- manage file contents

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "read");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
    } else {
      let i = 0;
      for (; i < pathArr.length - 1; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
      }
      const file = await (
        await directoryHandle.getFileHandle(pathArr[i])
      ).getFile();
      return new Uint8Array(await file.arrayBuffer());
    }
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
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
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (exists && options.create && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(uri);
      }

      const fileHandle = await directoryHandle.getFileHandle(pathArr[i], {
        create: options.create,
      });
      if (!exists) {
        this._fireSoon({ type: vscode.FileChangeType.Created, uri });
      }
      const writable = await fileHandle.createWritable();
      await writable.write(content);
      await (writable as any).close();

      this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    }
  }

  // --- manage files/folders

  public async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const data = await this.readFile(oldUri);
    await this.writeFile(newUri, data, {
      create: true,
      overwrite: options.overwrite,
    });
    await this.delete(oldUri, { recursive: true });
    this._fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    );
  }

  public async delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): Promise<void> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    let i = 0;
    for (; i < pathArr.length - 1; i++) {
      directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i]);
    }
    await directoryHandle.removeEntry(pathArr[i], {
      recursive: options.recursive,
    });
    this._fireSoon(
      // { type: vscode.FileChangeType.Changed, uri: dirname },
      { uri, type: vscode.FileChangeType.Deleted }
    );
  }

  public async createDirectory(uri: vscode.Uri): Promise<void> {
    let [directoryHandle, pathArr] = await this.helper(uri.path, "readwrite");
    if (!directoryHandle) {
      throw vscode.FileSystemError.FileNotFound(uri);
    } else {
      for (let i = 0; i < pathArr.length; i++) {
        directoryHandle = await directoryHandle.getDirectoryHandle(pathArr[i], {
          create: true,
        });
      }
    }
    this._fireSoon(
      // { type: vscode.FileChangeType.Changed, uri: dirname },
      { type: vscode.FileChangeType.Created, uri }
    );
  }

  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private _bufferedEvents: vscode.FileChangeEvent[] = [];
  private _fireSoonHandle?: NodeJS.Timer;

  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this
    ._emitter.event;

  watch(_resource: vscode.Uri): vscode.Disposable {
    // ignore, fires for all changes...
    return new vscode.Disposable(() => {});
  }

  private _fireSoon(...events: vscode.FileChangeEvent[]): void {
    this._bufferedEvents.push(...events);

    if (this._fireSoonHandle) {
      clearTimeout(this._fireSoonHandle);
    }

    this._fireSoonHandle = setTimeout(() => {
      this._emitter.fire(this._bufferedEvents);
      this._bufferedEvents.length = 0;
    }, 5);
  }
}
