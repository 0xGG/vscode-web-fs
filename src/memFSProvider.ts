/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import GlobToRegExp = require("glob-to-regexp");
import * as path from "path";
import * as vscode from "vscode";
import { convertSimple2RegExpPattern, getAllFiles, searchText } from "./util";
const LightningFS = require("@isomorphic-git/lightning-fs");

interface FSStat {
  type: "file" | "dir";
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  isFile: () => boolean;
  isDirectory: () => boolean;
  isSymbolicLink: () => boolean;
}

export class MemFS
  implements
    vscode.FileSystemProvider,
    vscode.FileSearchProvider,
    vscode.TextSearchProvider {
  static scheme = "memfs";

  private pfs: any;
  constructor() {
    const fs: any = new LightningFS("fs");
    this.pfs = fs.promises;
  }

  // * - FileSystemProvider
  // --- manage file metadata

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    try {
      const fstat: FSStat = await this.pfs.stat(uri.path);
      const stat: vscode.FileStat = {
        type: fstat.isDirectory()
          ? vscode.FileType.Directory
          : fstat.isFile()
          ? vscode.FileType.File
          : fstat.isSymbolicLink()
          ? vscode.FileType.SymbolicLink
          : vscode.FileType.Unknown,
        size: fstat.size,
        mtime: fstat.mtimeMs,
        ctime: fstat.ctimeMs,
      };
      return stat;
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const files = await this.pfs.readdir(uri.path);
    const result: [string, vscode.FileType][] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const stat = await this.stat(
        vscode.Uri.parse(`memfs:${path.join(uri.path, file)}`)
      );
      result.push([file, stat.type]);
    }
    return result;
  }

  // --- manage file contents

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    try {
      return await this.pfs.readFile(uri.path);
    } catch (error) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const dirname = uri.with({ path: path.posix.dirname(uri.path) });
    try {
      let stat: vscode.FileStat | undefined;
      try {
        stat = await this.stat(uri);
      } catch (error) {
        stat = undefined;
      }

      if (stat && stat.type === vscode.FileType.Directory) {
        throw vscode.FileSystemError.FileIsADirectory(uri);
      }
      if (!stat && !options.create) {
        throw vscode.FileSystemError.FileNotFound(uri);
      }
      if (stat && options.create && !options.overwrite) {
        throw vscode.FileSystemError.FileExists(uri);
      }
      await this.pfs.writeFile(uri.path, content);
      if (!stat) {
        this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname });
        this._fireSoon({ type: vscode.FileChangeType.Created, uri });
      }
      this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
    } catch (error) {
      throw error;
    }
  }

  // --- manage files/folders

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    let newUriStat: vscode.FileStat | undefined;
    try {
      newUriStat = await this.stat(newUri);
    } catch (error) {
      newUriStat = undefined;
    }
    if (!options.overwrite && newUriStat) {
      throw vscode.FileSystemError.FileExists(newUri);
    }

    if (newUriStat && newUriStat.type === vscode.FileType.Directory) {
      await this.mkdirp(newUri);
    } else {
      await this.mkdirp(
        vscode.Uri.parse(`memfs:${path.posix.dirname(newUri.path)}`)
      );
    }

    const data = await this.readFile(oldUri);
    await this.writeFile(newUri, data, {
      create: true,
      overwrite: options.overwrite,
    });
    await this.delete(oldUri);
    /*
    this._fireSoon(
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri }
    );
    */
  }

  async exists(uri: vscode.Uri): Promise<boolean> {
    try {
      const exists = !!(await this.pfs.stat(uri.path));
      return exists;
    } catch (error) {
      return false;
    }
  }

  async mkdirp(dirPath: vscode.Uri): Promise<void> {
    if (await this.exists(dirPath)) {
      return;
    } else {
      await this.mkdirp(
        vscode.Uri.parse(`memfs:${path.posix.dirname(dirPath.path)}`)
      );
      await this.mkdir(dirPath);
      this._fireSoon(
        {
          type: vscode.FileChangeType.Changed,
          uri: vscode.Uri.parse(`memfs:${path.posix.dirname(dirPath.path)}`),
        },
        {
          type: vscode.FileChangeType.Created,
          uri: vscode.Uri.parse(`memfs:${dirPath}`),
        }
      );
    }
  }

  async mkdir(uri: vscode.Uri): Promise<void> {
    await this.pfs.mkdir(uri.path, "0777");
  }

  async delete(uri: vscode.Uri): Promise<void> {
    let stat: vscode.FileStat | undefined;
    try {
      stat = await this.stat(uri);
    } catch (error) {
      stat = undefined;
    }
    if (!stat) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (stat.type === vscode.FileType.Directory) {
      await this.rmdir(uri.path);
    } else {
      await this.unlink(uri.path);
    }
  }

  async unlink(filePath: string) {
    await this.pfs.unlink(filePath);
    this._fireSoon(
      {
        type: vscode.FileChangeType.Changed,
        uri: vscode.Uri.parse(`memfs:${path.posix.dirname(filePath)}`),
      },
      {
        uri: vscode.Uri.parse(`memfs:${filePath}`),
        type: vscode.FileChangeType.Deleted,
      }
    );
  }

  async rmdir(dirPath: string): Promise<void> {
    const files = await this.pfs.readdir(dirPath);
    const promises = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const filePath = path.resolve(dirPath, file);
      const stat = await this.pfs.stat(filePath);
      if (stat.isDirectory()) {
        promises.push(this.rmdir(filePath));
      } else {
        promises.push(this.unlink(filePath));
      }
    }
    await Promise.all(promises);
    await this.pfs.rmdir(dirPath);

    this._fireSoon(
      {
        type: vscode.FileChangeType.Changed,
        uri: vscode.Uri.parse(`memfs:${path.posix.dirname(dirPath)}`),
      },
      {
        uri: vscode.Uri.parse(`memfs:${dirPath}`),
        type: vscode.FileChangeType.Deleted,
      }
    );
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    try {
      await this.mkdirp(uri);
    } catch (error) {
      throw error;
    }
  }

  // --- manage file events

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
    const files = await getAllFiles(
      this,
      MemFS.scheme,
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

  //  *- TextSearchProvider
  public async provideTextSearchResults(
    query: vscode.TextSearchQuery,
    options: vscode.TextSearchOptions,
    progress: vscode.Progress<vscode.TextSearchResult>,
    _token: vscode.CancellationToken
  ): Promise<vscode.TextSearchComplete> {
    const result: vscode.TextSearchComplete = { limitHit: false };
    const includes = options.includes.map((e) => GlobToRegExp(e));
    const excludes = options.excludes.map((e) => GlobToRegExp(e));
    await searchText(
      this,
      MemFS.scheme,
      options.folder,
      query,
      includes,
      excludes,
      progress,
      _token
    );
    return result;
  }
}
