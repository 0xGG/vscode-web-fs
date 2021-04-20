import escapeStringRegexp from "escape-string-regexp";
import * as path from "path";
import * as vscode from "vscode";
const {
  isBinary,
} = require("../node_modules/istextorbinary/edition-browsers/");

const textDecoder = new TextDecoder();

export function convertSimple2RegExpPattern(pattern: string): string {
  return (
    pattern
      .split("")
      .map((x) => x) // escape each character
      .join(".*")
      .replace(/\.\*\*+/g, ".*") + ".*"
  ).replace(/([\-\\\{\}\+\?\|\^\$\.\,\[\]\(\)\#\s])\.\*/g, "\\$1.*");
}

export async function getAllFiles(
  fs: vscode.FileSystemProvider,
  scheme: string,
  directoryPath: vscode.Uri,
  excludes: RegExp[]
): Promise<vscode.Uri[]> {
  let result: vscode.Uri[] = [];
  let entries: [string, vscode.FileType][] = await fs.readDirectory(
    directoryPath
  );
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
      promises.push(
        getAllFiles(
          fs,
          scheme,
          vscode.Uri.parse(`${scheme}:${filePath}`),
          excludes
        )
      );
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

//  * References
//  ** https://github.com/microsoft/vscode/blob/e1f0f8f51390dea5df9096718fb6b647ed5a9534/src/vs/workbench/services/search/node/ripgrepTextSearchEngine.ts
//  ** https://github.com/microsoft/vscode/blob/94c9ea46838a9a619aeafb7e8afd1170c967bb55/src/vs/workbench/services/search/node/ripgrepSearchProvider.ts
//  ** https://github.com/microsoft/vscode-web-playground/blob/main/src/memfs.ts
export async function searchText(
  fs: vscode.FileSystemProvider,
  scheme: string,
  directoryPath: vscode.Uri,
  query: vscode.TextSearchQuery,
  includes: RegExp[],
  excludes: RegExp[],
  progress: vscode.Progress<vscode.TextSearchResult>,
  _token: vscode.CancellationToken
) {
  if (_token.isCancellationRequested) {
    return;
  }
  const entries = await fs.readDirectory(directoryPath);
  const promises: Promise<void>[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [fileName, fileType] = entries[i];
    const filePath = path.join(directoryPath.path, fileName);
    if (excludes.some((e) => e.exec(filePath))) {
      continue;
    }
    if (includes.length && !includes.some((e) => e.exec(filePath))) {
      continue;
    }
    if (fileType === vscode.FileType.File) {
      promises.push(
        search(
          fs,
          query,
          vscode.Uri.parse(`${scheme}:${filePath}`),
          progress,
          _token
        )
      );
    } else if (fileType === vscode.FileType.Directory) {
      promises.push(
        searchText(
          fs,
          scheme,
          vscode.Uri.parse(`${scheme}:${filePath}`),
          query,
          includes,
          excludes,
          progress,
          _token
        )
      );
    }
  }
  if (promises.length) {
    await Promise.all(promises);
  }
}

async function search(
  fs: vscode.FileSystemProvider,
  query: vscode.TextSearchQuery,
  filePath: vscode.Uri,
  progress: vscode.Progress<vscode.TextSearchResult>,
  _token: vscode.CancellationToken
) {
  if (_token.isCancellationRequested) {
    return;
  }
  const { binary, content } = await isFileBinary(fs, filePath);
  if (binary) {
    return;
  }
  const stringContent = textDecoder.decode(content);
  let lines: { text: string; index: number }[] | undefined;
  let flags = "g";
  let regexpStr = query.isRegExp
    ? query.pattern
    : escapeStringRegexp(query.pattern);
  if (!query.isCaseSensitive) {
    flags += "i";
  }
  if (query.isWordMatch) {
    regexpStr = "\\b" + regexpStr + "\\b";
  }

  const queryRegexp = new RegExp(regexpStr, flags);
  let result: RegExpExecArray | null;
  while ((result = queryRegexp.exec(stringContent))) {
    if (!lines) {
      let index = 0;
      lines = stringContent.split("\n").map((text) => {
        const result = { text, index };
        index = index + text.length + 1;
        return result;
      });
    }

    const matchedString = result[0];
    const ahead = stringContent.slice(0, result.index);
    const lineNumber = (ahead.match(/\n/gm) || []).length;
    const report = {
      uri: filePath,
      ranges: new vscode.Range(
        new vscode.Position(lineNumber, result.index - lines[lineNumber].index),
        new vscode.Position(
          lineNumber,
          result.index - lines[lineNumber].index + matchedString.length
        )
      ),
      preview: {
        text: lines[lineNumber].text,
        matches: new vscode.Range(
          new vscode.Position(0, result.index - lines[lineNumber].index),
          new vscode.Position(
            0,
            result.index - lines[lineNumber].index + matchedString.length
          )
        ),
      },
    };
    progress.report(report);
  }
}

async function isFileBinary(
  fs: vscode.FileSystemProvider,
  filePath: vscode.Uri
): Promise<{ binary: boolean; content: Uint8Array }> {
  if (isBinary(filePath.path) || filePath.path.match(/\.(asar)$/)) {
    return { binary: true, content: await fs.readFile(filePath) };
  } else {
    // Check content
    const content = await fs.readFile(filePath);
    return { binary: !!isBinary(null, content.buffer as any), content };
  }
}
