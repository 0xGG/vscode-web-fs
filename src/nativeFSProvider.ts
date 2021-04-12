/**
 * File System Provider for Native File System
 * Referred from https://github.com/microsoft/vscode-extension-samples/blob/main/fsprovider-sample/src/fileSystemProvider.ts
 */

import * as vscode from "vscode";

export class NativeFS implements vscode.FileSystemProvider {
  // --- manage file metadata

  public async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    console.log("* nativefs stat: ", uri);
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
    console.log("* nativefs readDirectory: ", uri);
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

  // --- manage file contents

  public async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    console.log("* nativefs readFile: ", uri);

    try {
      const result: number[] | undefined = await vscode.commands.executeCommand(
        "nativeFS.readFile",
        uri
      );
      console.log("* nativefs readFile result: ", result);
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
    console.log("* nativefs writeFile: ", uri);

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
    console.log("* nativefs rename: ", oldUri, newUri);

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
    console.log("* nativefs delete: ", uri);

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
    console.log("* nativefs createDirectory: ", uri);

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
}
