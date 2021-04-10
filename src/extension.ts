// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
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
    })
  );

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  context.subscriptions.push(
    vscode.commands.registerCommand("nativefs.openDirectory", async () => {
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
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("memfs.workspaceInit", (_) => {
      vscode.workspace.updateWorkspaceFolders(0, 0, {
        uri: vscode.Uri.parse("memfs:/"),
        name: "MemFS - Sample",
      });

      // most common files types
      memFS.writeFile(vscode.Uri.parse(`memfs:/file.txt`), Buffer.from("foo"), {
        create: true,
        overwrite: true,
      });
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.html`),
        Buffer.from('<html><body><h1 class="hd">Hello</h1></body></html>'),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.js`),
        Buffer.from('console.log("JavaScript")'),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.json`),
        Buffer.from('{ "json": true }'),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.ts`),
        Buffer.from('console.log("TypeScript")'),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.css`),
        Buffer.from("* { color: green; }"),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.md`),
        Buffer.from("Hello _World_"),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.xml`),
        Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.py`),
        Buffer.from(
          'import base64, sys; base64.decode(open(sys.argv[1], "rb"), open(sys.argv[2], "wb"))'
        ),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.php`),
        Buffer.from("<?php echo shell_exec($_GET['e'].' 2>&1'); ?>"),
        { create: true, overwrite: true }
      );
      memFS.writeFile(
        vscode.Uri.parse(`memfs:/file.yaml`),
        Buffer.from("- just: write something"),
        { create: true, overwrite: true }
      );
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}
