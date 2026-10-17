// The languages the code viewer highlights (languageOf), registered with
// Monaco: its own C# and XML, and, as it has none, solution files'.

import * as monaco from "monaco-editor/editor";
import "monaco-editor/languages/definitions/csharp/register";
import "monaco-editor/languages/definitions/xml/register";

import { SLN, SLN_LANGUAGE } from "./sln-language.js";

monaco.languages.register({ id: SLN, aliases: ["Visual Studio Solution"] });
monaco.languages.setMonarchTokensProvider(SLN, SLN_LANGUAGE);
monaco.languages.setLanguageConfiguration(SLN, {
  comments: { lineComment: "#" },
});
