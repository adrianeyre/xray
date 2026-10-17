// For tests, in a page (happy-dom), as Monaco needs one: a file highlighted
// as the code viewer highlights it, with Monaco's own tokenizer and the
// languages the viewer registers.

import * as monaco from "monaco-editor/editor";

import { languageOf } from "./viewer-files.js";
import "./viewer-languages.js";

/** A part of a line, and what Monaco highlights it as, such as `tag.xml`. */
export interface Token {
  readonly text: string;
  readonly type: string;
}

/**
 * Each line of `text`, as the tokens Monaco highlights it in as the file at
 * `path`, but for whitespace between them.
 */
export async function highlight(
  path: string,
  text: string,
): Promise<Token[][]> {
  const language = languageOf(path);
  // Monaco loads a language's grammar only once it is first asked for.
  await monaco.editor.colorize("", language, {});
  const lines = text.split(/\r?\n/);
  return monaco.editor.tokenize(text, language).map((tokens, i) => {
    const line = lines[i] ?? "";
    return tokens
      .map(({ offset, type }, j) => ({
        text: line.slice(offset, tokens[j + 1]?.offset ?? line.length),
        type,
      }))
      .filter(({ text }) => text.trim() !== "");
  });
}

/** The tokens of every line typed `type`, or matching it, in order. */
export function ofType(lines: Token[][], type: string | RegExp): string[] {
  return lines
    .flat()
    .flatMap((token) =>
      (typeof type === "string" ? token.type === type : type.test(token.type))
        ? [token.text]
        : [],
    );
}

/**
 * What the XAML `text` holds that the viewer must highlight: the name of each
 * element, as it opens and as it closes; the name of each attribute; and
 * each attribute's value, quoted.
 */
export function xamlParts(text: string): {
  readonly tags: string[];
  readonly attributeNames: string[];
  readonly attributeValues: string[];
} {
  return {
    tags: [...text.matchAll(/<\/?([\w:.]+)/g)].map(
      (match) => match[1] as string,
    ),
    attributeNames: [...text.matchAll(/([\w:.]+)="/g)].map(
      (match) => match[1] as string,
    ),
    attributeValues: [...text.matchAll(/="([^"]*)"/g)].map(
      (match) => `"${match[1] as string}"`,
    ),
  };
}

/** The same parts of the XAML `text`, as Monaco highlights them. */
export async function highlightedXamlParts(
  path: string,
  text: string,
): Promise<ReturnType<typeof xamlParts>> {
  const lines = await highlight(path, text);
  return {
    // The / closing an empty element is highlighted as its tag is.
    tags: ofType(lines, "tag.xml").filter((part) => part !== "/"),
    attributeNames: ofType(lines, "attribute.name.xml"),
    attributeValues: ofType(lines, "attribute.value.xml"),
  };
}
