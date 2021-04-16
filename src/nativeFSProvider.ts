/**
 * File System Provider for Native File System
 * Referred from https://github.com/microsoft/vscode-extension-samples/blob/main/fsprovider-sample/src/fileSystemProvider.ts
 */

import GlobToRegExp = require("glob-to-regexp");
import * as path from "path";
import * as vscode from "vscode";
import { convertSimple2RegExpPattern } from "./util";

export class NativeFS
  implements vscode.FileSystemProvider, vscode.FileSearchProvider {
  static scheme = "nativefs";
  // *-- FileSystemProvider
  // --- manage file metadata

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      const result:
        | vscode.FileStat
        | undefined = await vscode.commands.executeCommand(
        "nativeFS.stat",
        uri
      );
      if (!result) {
        throw vscode.FileSystemError.FileNotFound(uri);
      } else {
        return result;
      }
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  public async readDirectory(
    uri: vscode.Uri
  ): Promise<[string, vscode.FileType][]> {
    try {
      const result:
        | [string, vscode.FileType][]
        | undefined = await vscode.commands.executeCommand(
        "nativeFS.readDirectory",
        uri
      );
      if (!result) {
        throw vscode.FileSystemError.FileNotFound(uri);
      } else {
        return result;
      }
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  public async readRootDirectories(): Promise<string[]> {
    try {
      const result: string[] | undefined = await vscode.commands.executeCommand(
        "nativeFS.readRootDirectories"
      );
      if (!result) {
        throw vscode.FileSystemError.Unavailable;
      } else {
        return result;
      }
    } catch (error) {
      throw vscode.FileSystemError.Unavailable;
    }
  }

  // --- manage file contents

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      const result: number[] | undefined = await vscode.commands.executeCommand(
        "nativeFS.readFile",
        uri
      );
      if (!result) {
        throw vscode.FileSystemError.FileNotFound(uri);
      } else {
        return Uint8Array.from(result);
      }
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  public async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const { events } = (await vscode.commands.executeCommand(
      "nativeFS.writeFile",
      uri,
      Array.from(content),
      options
    )) || { events: [] };
    if (events) {
      (events || []).forEach((event: vscode.FileChangeEvent) => {
        this._fireSoon(event);
      });
    }
  }

  // --- manage files/folders

  public async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const { events } = (await vscode.commands.executeCommand(
      "nativeFS.rename",
      oldUri,
      newUri,
      options
    )) || { events: [] };
    if (events) {
      (events || []).forEach((event: vscode.FileChangeEvent) => {
        this._fireSoon(event);
      });
    }
  }

  public async delete(
    uri: vscode.Uri,
    options: { recursive: boolean }
  ): Promise<void> {
    const { events } = (await vscode.commands.executeCommand(
      "nativeFS.delete",
      uri,
      options
    )) || { events: [] };
    if (events) {
      (events || []).forEach((event: vscode.FileChangeEvent) => {
        this._fireSoon(event);
      });
    }
  }

  public async createDirectory(uri: vscode.Uri): Promise<void> {
    const { events } = (await vscode.commands.executeCommand(
      "nativeFS.createDirectory",
      uri
    )) || { events: [] };
    if (events) {
      (events || []).forEach((event: vscode.FileChangeEvent) => {
        this._fireSoon(event);
      });
    }
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

  // *- FileSearchProvider
  public async provideFileSearchResults(
    query: vscode.FileSearchQuery,
    options: vscode.FileSearchOptions,
    token: vscode.CancellationToken
  ): Promise<vscode.Uri[]> {
    const files = await this._getAllFiles(
      options.folder,
      options.excludes.map((e) => GlobToRegExp(e))
    );
    const result: vscode.Uri[] = [];
    const pattern = query.pattern
      ? new RegExp(convertSimple2RegExpPattern(query.pattern), "i")
      : null;
    for (const file of files) {
      if (!pattern || pattern.exec(file.path)) {
        result.push(file);
      }
    }
    return result;
  }

  private async _getAllFiles(
    directoryPath: vscode.Uri = vscode.Uri.parse(`${NativeFS.scheme}:/`),
    excludes: RegExp[]
  ): Promise<vscode.Uri[]> {
    let result: vscode.Uri[] = [];
    let entries: [string, vscode.FileType][] = [];
    if (directoryPath.path === "/") {
      const rootDirectories = await this.readRootDirectories();
      rootDirectories.forEach((rootDir) => {
        entries.push([rootDir, vscode.FileType.Directory]);
      });
    } else {
      entries = await this.readDirectory(directoryPath);
    }
    const promises: Promise<vscode.Uri[]>[] = [];
    for (let i = 0; i < entries.length; i++) {
      const [fileName, fileType] = entries[i];
      const filePath = path.join(directoryPath.path, fileName);
      if (excludes.some((e) => e.exec(filePath))) {
        continue;
      }
      if (fileType === vscode.FileType.File) {
        result.push(vscode.Uri.parse(filePath));
      } else if (fileType === vscode.FileType.Directory) {
        promises.push(this._getAllFiles(vscode.Uri.parse(filePath), excludes));
      }
    }
    if (promises.length) {
      const resultList = await Promise.all(promises);
      result = result.concat(
        resultList.reduce((acc, val) => acc.concat(val), [])
      );
    }
    return result;
  }
}
