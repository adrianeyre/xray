// Which of a Recovered Solution's files the code viewer (code-viewer.ts)
// highlights, as which language, and which it does not read. Nothing here
// needs a page, so it runs, and is tested, in Node.js as in the browser.

/** The languages the viewer highlights; any other file is plain text. */
export type ViewerLanguage = "csharp" | "xml" | "sln" | "plaintext";

/**
 * The language the file at `path` is highlighted as: C# for C#; XML for
 * XAML, a project (`.csproj`) and a `.resx`; a solution's own for a `.sln`;
 * plain text for any other.
 */
export function languageOf(path: string): ViewerLanguage {
  return /\.cs$/i.test(path)
    ? "csharp"
    : /\.(xaml|csproj|resx)$/i.test(path)
      ? "xml"
      : /\.sln$/i.test(path)
        ? "sln"
        : "plaintext";
}

/**
 * Whether the file at `path` is a binary, such as an Assembly copied into
 * `Dependencies/`, or a resource embedded as it is: an image, a `.resources`
 * file, or bytes a `.resx` refers to (`.bin`). The viewer does not show it as
 * text.
 */
export function isBinary(path: string): boolean {
  return /\.(dll|exe|resources|bin|png|jpe?g|gif|bmp|ico|cur|wav|ttf|otf|woff2?|zip|pdf)$/i.test(
    path,
  );
}
