// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as vscode from "vscode";
import { MemFS } from "./memFSProvider";
import { NativeFS } from "./nativeFSProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Activated vscode-native-file-system extension");
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const nativeFS = new NativeFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("nativefs", nativeFS, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );

  const memFS = new MemFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("memfs", memFS, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("nativefs.openFolder", async () => {
      try {
        const directoryPath:
          | string
          | undefined = await vscode.commands.executeCommand(
          "nativeFS.showDirectoryPicker"
        );
        if (!directoryPath) {
          return vscode.window.showErrorMessage(`Failed to open folder`);
        }
        console.log("nativefs open folder: ", directoryPath);

        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders.length
            : 0,
          null,
          {
            uri: vscode.Uri.parse(`nativefs:${directoryPath}`),
            name: path.basename(directoryPath),
          }
        );
      } catch (error) {
        console.error(error);
        vscode.window.showErrorMessage(
          "Your environment doesn't support the Native File System API"
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memfs.openFolder", async (_) => {
      const name = await vscode.window.showInputBox({
        value: "Welcome",
        placeHolder: "Please enter the folder name",
      });
      if (!name) {
        vscode.window.showErrorMessage(`Empty folder name is not supported`);
      }
      try {
        memFS.createDirectory(vscode.Uri.parse(`memfs:/${name}`));
      } catch (_) {}

      const state = vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse(`memfs:/${name}`),
        name: name,
      });
      console.log("updateWorkspaceFolders state: ", state);

      console.log("workspace folders", vscode.workspace.workspaceFolders);
    })
  );

  // Always create memfs:/Welcome directory
  try {
    memFS.createDirectory(vscode.Uri.parse(`memfs:/Welcome`));
  } catch (_) {}
  if (
    vscode.workspace.workspaceFolders?.some(
      (f) => f.uri.scheme === "memfs" && f.uri.path === "/Welcome"
    )
  ) {
    console.log("Find /Welcome ");
    const encoder = new TextEncoder();
    memFS.writeFile(
      vscode.Uri.parse(`memfs:/Welcome/README.md`),
      encoder.encode(`# Welcome!`),
      {
        create: true,
        overwrite: false,
      }
    );
  }
}

// this method is called when your extension is deactivated
export function deactivate() {}
