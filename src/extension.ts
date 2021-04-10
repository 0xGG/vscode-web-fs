// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";
import { Provider } from "./fileSystemProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log("Activated vscode-native-file-system extension");
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  const provider = new Provider();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider("nativefs", provider, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand(
    "native-file-system.openDirectory",
    async () => {
      try {
        const directoryPath:
          | string
          | undefined = await vscode.commands.executeCommand(
          "nativeFS.showDirectoryPicker"
        );
        vscode.workspace.updateWorkspaceFolders(
          vscode.workspace.workspaceFolders
            ? vscode.workspace.workspaceFolders.length
            : 0,
          null,
          {
            uri: vscode.Uri.parse(`nativefs:${directoryPath}`),
            name: (directoryPath?.match(/(\|\/)(.+?)$/) || ["Unknown"])[0],
          }
        );
      } catch (error) {
        console.error(error);
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
