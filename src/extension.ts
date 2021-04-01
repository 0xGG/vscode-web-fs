// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { basename } from "path";
import * as vscode from "vscode";
import { NativeFS } from "./fileSystemProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Extension "native-file-system" is now active!');

  const nativeFs = new NativeFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("nativefs", nativeFs, {
      isCaseSensitive: true,
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand(
    "native-file-system.openDirectory",
    async () => {
      if (
        typeof process === "undefined" &&
        typeof showDirectoryPicker !== "undefined"
      ) {
        const directoryHandle = await showDirectoryPicker();
        const dirPath = await nativeFs.attachDirectory(directoryHandle);
        vscode.workspace.updateWorkspaceFolders(0, 0, {
          uri: vscode.Uri.parse(`nativefs:${dirPath}`),
          name: basename(dirPath),
        });
      } else {
        vscode.window.showErrorMessage(
          "Your environment doesn't support the Native File System API"
        );
      }
    }
  );

  context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
