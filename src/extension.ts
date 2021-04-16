// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as path from "path";
import * as vscode from "vscode";
import { MemFS } from "./memFSProvider";
import { NativeFS } from "./nativeFSProvider";

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  // Register providers
  // * NativeFS
  const nativeFS = new NativeFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(NativeFS.scheme, nativeFS, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSearchProvider(NativeFS.scheme, nativeFS)
  );

  // * MemFS
  const memFS = new MemFS();
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(MemFS.scheme, memFS, {
      isCaseSensitive: true,
      isReadonly: false,
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerFileSearchProvider(MemFS.scheme, memFS)
  );

  const encoder = new TextEncoder();

  // Always create memfs:/Welcome directory
  const welcomeDirectoryUri = vscode.Uri.parse(`${MemFS.scheme}:/Welcome/`);
  const welcomeREADMEUri = vscode.Uri.parse(
    `${MemFS.scheme}:/Welcome/README.md`
  );
  const workspaceFileUri = vscode.Uri.parse(
    `${MemFS.scheme}:/web-fs.code-workspace`
  );
  try {
    await memFS.createDirectory(welcomeDirectoryUri);
  } catch (_) {}

  // Add README.md to /Welcome
  if (!(await memFS.exists(welcomeREADMEUri))) {
    await memFS.writeFile(
      welcomeREADMEUri,
      encoder.encode(
        `# Welcome! (Experiment)
Please open **Command Palette** then run: 

* \`NativeFS: Open Folder\` command to open a local folder on your device.  
* \`MemFS: Open Folder\` command to create/open a temporary folder in memory. 

Enjoy!`
      ),
      {
        create: true,
        overwrite: true,
      }
    );
  }
  // Initialize the workspaceFile
  if (!(await memFS.exists(workspaceFileUri))) {
    await memFS.writeFile(
      workspaceFileUri,
      encoder.encode(
        `{
        "folders": ${JSON.stringify([welcomeDirectoryUri])}
      }`
      ),
      {
        create: true,
        overwrite: true,
      }
    );
  }

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
        await memFS.createDirectory(
          vscode.Uri.parse(`${MemFS.scheme}:/${name}`)
        );
      } catch (_) {}

      const state = vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse(`${MemFS.scheme}:/${name}`),
        name: name,
      });
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
