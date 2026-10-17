import { dirname, isAbsolute, join, relative, sep } from "node:path";

/** An error or warning `dotnet build` reported (FR-13). */
export interface BuildDiagnostic {
  readonly severity: "error" | "warning";
  /** The compiler's or tool's code, such as `CS0246`; empty if it gave none. */
  readonly code: string;
  readonly message: string;
  /**
   * The file it is about: relative to the Recovered Solution with `/` between
   * segments when the file is in it, or absolute as `dotnet build` printed it
   * when it is not (an SDK targets file, say). Absent when it names no file.
   */
  readonly file?: string;
  /** 1-based, when it gives one. */
  readonly line?: number;
  /** 1-based, when it gives one. */
  readonly column?: number;
  /** The project being built, relative to the Recovered Solution as {@link file} is. */
  readonly project?: string;
}

// MSBuild's canonical format (Microsoft.Build.Shared.CanonicalError):
//   origin : [subcategory] category [code] : text
// where origin is a file, optionally with a location, or a tool name. A
// Windows drive's colon is part of the origin; a node prefix ("12>") is not.
const CANONICAL =
  /^\s*(?:\d+>)?(?:(?<origin>(?:[A-Za-z]:)?[^:]*?)\s*:)?\s*(?:[^:]*?\s)?(?<severity>error|warning)(?:\s+(?<code>[^:\s]*))?\s*:(?<text>.*)$/;
// (line), (line-endLine), (line,column), (line,column-endColumn) or
// (line,column,endLine,endColumn), at the end of a file name.
const LOCATION =
  /^(?<file>.*?)\((?<line>\d+)(?:-\d+)?(?:,(?<column>\d+)[,\d-]*)?\)$/;
// The project the console logger appends, after the text.
const PROJECT = /^(?<text>.*?)\s+\[(?<project>[^\]]+\.(?:\w*proj|sln))\]$/;

/**
 * Picks out the errors and warnings in what `dotnet build` printed for the
 * Recovered Solution in `directory`, each mapped to the file and line it is
 * about, in the order they were first printed. The console logger prints each
 * one again in its summary; those repeats are dropped.
 *
 * `aliases` are other absolute paths of `directory`, such as its real path
 * where a symbolic link leads to it (macOS's temporary folder does), since
 * `dotnet build` prints the path it was given or the real one.
 */
export function parseBuildDiagnostics(
  output: string,
  directory: string,
  aliases: readonly string[] = [],
): BuildDiagnostic[] {
  const roots = [directory, ...aliases];
  const seen = new Set<string>();
  const diagnostics: BuildDiagnostic[] = [];
  for (const line of output.split(/\r?\n/)) {
    const diagnostic = parseLine(line, roots);
    if (diagnostic === undefined) {
      continue;
    }
    const key = JSON.stringify(diagnostic);
    if (!seen.has(key)) {
      seen.add(key);
      diagnostics.push(diagnostic);
    }
  }
  return diagnostics;
}

function parseLine(
  line: string,
  roots: readonly string[],
): BuildDiagnostic | undefined {
  const match = CANONICAL.exec(line);
  if (match?.groups === undefined) {
    return undefined;
  }
  const { origin = "", severity, code = "" } = match.groups;
  let text = (match.groups.text ?? "").trim();
  let project: string | undefined;
  const withProject = PROJECT.exec(text);
  if (withProject?.groups !== undefined) {
    text = withProject.groups.text ?? "";
    project = withProject.groups.project;
  }

  let file: string | undefined;
  let lineNumber: number | undefined;
  let column: number | undefined;
  const located = LOCATION.exec(origin.trim());
  if (located?.groups !== undefined) {
    file = located.groups.file?.trim();
    lineNumber = Number(located.groups.line);
    if (located.groups.column !== undefined) {
      column = Number(located.groups.column);
    }
  } else if (isAbsolute(origin.trim())) {
    // A file without a location, such as a project NuGet could not restore.
    file = origin.trim();
  }
  // Any other origin is a tool's name (MSBUILD, CSC…), not a file.

  // A relative file is relative to the project that reported it.
  if (file !== undefined && !isAbsolute(file) && project !== undefined) {
    file = join(dirname(project), file);
  }

  return {
    severity: severity === "error" ? "error" : "warning",
    code,
    message: text.trim(),
    ...(file === undefined || file === ""
      ? {}
      : { file: inSolution(file, roots) }),
    ...(lineNumber === undefined ? {} : { line: lineNumber }),
    ...(column === undefined ? {} : { column }),
    ...(project === undefined ? {} : { project: inSolution(project, roots) }),
  };
}

/**
 * An absolute `path` relative to whichever root holds it, with `/` between
 * segments; otherwise `path` as it was.
 */
function inSolution(path: string, roots: readonly string[]): string {
  if (!isAbsolute(path)) {
    return path;
  }
  for (const root of roots) {
    const relativePath = relative(root, path);
    if (
      relativePath !== "" &&
      relativePath !== ".." &&
      !relativePath.startsWith(`..${sep}`) &&
      !isAbsolute(relativePath)
    ) {
      return relativePath.split(sep).join("/");
    }
  }
  return path;
}
