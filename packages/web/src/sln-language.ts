// How the code viewer highlights a Visual Studio solution file (`.sln`), as
// a Reconstruction writes one, for which Monaco has no language of its own.

import type { languages } from "monaco-editor/editor";

/** The id Monaco knows the language of solution files by. */
export const SLN = "sln";

/**
 * Monaco's grammar of a solution file: its header, the comment beneath it,
 * the words that open and close its projects, sections and Global block,
 * quoted names and paths, GUIDs, and version numbers.
 */
export const SLN_LANGUAGE: languages.IMonarchLanguage = {
  defaultToken: "",
  tokenPostfix: ".sln",
  keywords: [
    "Project",
    "EndProject",
    "ProjectSection",
    "EndProjectSection",
    "Global",
    "EndGlobal",
    "GlobalSection",
    "EndGlobalSection",
    "preProject",
    "postProject",
    "preSolution",
    "postSolution",
  ],
  tokenizer: {
    root: [
      [/^\s*Microsoft Visual Studio Solution File\b.*$/, "metatag"],
      [/^\s*#.*$/, "comment"],
      [/"/, "string", "@string"],
      [/\{[\dA-Fa-f]{8}(?:-[\dA-Fa-f]{4}){3}-[\dA-Fa-f]{12}\}/, "type"],
      [
        /[A-Za-z_]\w*/,
        { cases: { "@keywords": "keyword", "@default": "identifier" } },
      ],
      [/\d+(?:\.\d+)*/, "number"],
      [/[=()|.,]/, "delimiter"],
      [/\s+/, "white"],
    ],
    string: [
      [/[^"]+/, "string"],
      [/"/, "string", "@pop"],
    ],
  },
};
