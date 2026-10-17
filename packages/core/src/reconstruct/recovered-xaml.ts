// The XAML of a Recovered Solution's WPF projects (FR-12): the original's WPF
// resources, `<Assembly>.g.resources`, which the markup compiler built from
// its XAML files and its `Resource` files, split back into them, so the build
// compiles them into the same resources again. Each BAML entry is decompiled
// to the XAML file it was named after, beside its code-behind; each other
// entry is the file it was:
//
//   <Name>/App.xaml                       app.baml, the ApplicationDefinition
//   <Name>/App.xaml.cs                    its code-behind
//   <Name>/Views/MainWindow.xaml          views/mainwindow.baml, a Page
//   <Name>/Views/MainWindow.xaml.cs       its code-behind
//   <Name>/Themes/Palette.xaml            themes/palette.baml, a Page of its own
//   <Name>/Assets/logo.png                assets/logo.png, a Resource
//
// The markup compiler names each entry after its file's path in the project,
// lowercased, so a file's case is not recorded: a code-behind's path gives
// its XAML file's, and anything else takes the case another file refers to
// it by (`Source="Themes/Palette.xaml"`), if one does.

import type {
  ManifestResource,
  RecoveredResource,
} from "./recovered-resources.js";
import type { DecompiledType, SourceLayout } from "./recovered-solution.js";

/** A XAML document, decompiled by the engine from the BAML the markup compiler built of it. */
export interface XamlDocument {
  /**
   * Its entry in the WPF resources, named after its XAML file's path,
   * lowercased: `views/mainwindow.baml`.
   */
  readonly entry: string;
  /** The type its `x:Class` names, e.g. `App.MainWindow`; `null` if it names none. */
  readonly class: string | null;
  /**
   * Whether it is the app's `ApplicationDefinition`, whose class's `Main`
   * the markup compiler generated as the Assembly's entry point.
   */
  readonly applicationDefinition: boolean;
  readonly code: string;
}

/**
 * The XAML of an Assembly's WPF resources, as the engine decompiled it
 * (engine/Xray.Engine/WpfXaml.cs). The members the markup compiler generated
 * of each class a document names are left out of the decompiled C#.
 */
export interface WpfXaml {
  /** The WPF resources' logical name: `<Assembly>.g.resources`. */
  readonly resource: string;
  /** Each BAML entry, decompiled; none if any could not be. */
  readonly documents: readonly XamlDocument[];
  /** Why none was decompiled, if one could not be; otherwise `null`. */
  readonly notDecompiled: string | null;
}

/** An item of a WPF project: a XAML file the markup compiler compiles, or a file it embeds beside them. */
export interface XamlItem {
  readonly itemType: "ApplicationDefinition" | "Page" | "Resource";
  /** The file, relative to the project's folder with `/` between segments. */
  readonly include: string;
}

/** The WPF resources of a project, split back into its XAML files and `Resource` files. */
export interface WpfResources {
  readonly xaml: WpfXaml;
  /** The WPF resources, as the engine read them, each entry a stream. */
  readonly resource: ManifestResource & {
    readonly entries: NonNullable<ManifestResource["entries"]>;
  };
}

const BAML_EXTENSION = ".baml";

/**
 * The WPF resources to split back into XAML files and `Resource` files: those
 * the engine decompiled the BAML of, embedded in the Assembly, each of whose
 * entries it read and each BAML one decompiled. Otherwise, why not, and what
 * comes of it, unless the Assembly holds no BAML (`null`).
 */
export function wpfResourcesToSplit(
  xaml: WpfXaml | null | undefined,
  resources: readonly ManifestResource[],
): WpfResources | { readonly notRecovered: string } | null {
  if (xaml === null || xaml === undefined) {
    return null;
  }
  if (xaml.notDecompiled !== null) {
    return {
      notRecovered: `${xaml.resource}'s BAML was not decompiled. ${xaml.notDecompiled} It is embedded as it is, and the classes it names keep the code the markup compiler generated of their XAML, which loads it; but the project has no XAML to change.`,
    };
  }
  const resource = resources.find(({ name }) => name === xaml.resource);
  const entries = resource?.location === "embedded" ? resource.entries : null;
  const decompiled = new Set(xaml.documents.map(({ entry }) => entry));
  const undecompiled = entries?.find(
    ({ name }) => isBaml(name) && !decompiled.has(name),
  );
  const why =
    resource?.location !== "embedded"
      ? `${xaml.resource} is not embedded in the Assembly.`
      : entries === null
        ? `${xaml.resource}'s entries could not be read. ${resource.notDecoded ?? ""}`.trimEnd()
        : undecompiled === undefined
          ? null
          : `${xaml.resource}'s entry "${undecompiled.name}" was not decompiled.`;
  if (resource === undefined || entries === null || why !== null) {
    return {
      notRecovered:
        `${why ?? ""} It is kept as it is, but the classes its XAML names leave out the code the markup compiler generated of it, so the project may not build.`.trimStart(),
    };
  }
  return { xaml, resource: { ...resource, entries } };
}

/**
 * Where each code-behind went, by its type's place in the decompiled types:
 * the class its XAML file names, and its file and that XAML file's, both
 * relative to the project's folder.
 */
export type CodeBehind = ReadonlyMap<
  number,
  { readonly class: string; readonly source: string; readonly xaml: string }
>;

/**
 * Claims in `layout` the file of each class a XAML document names, as Visual
 * Studio lays out a code-behind, beside its XAML file and named after it
 * (`Views/MainWindow.xaml.cs`), and that XAML file's path, where its entry
 * says it was: in the case of the path the type's own file would take, by
 * its PDB (`recorded`, as `recordedSourcePaths` gives them) or else by its
 * namespace, if that is the entry's path but for case; else as the entry
 * names it. Claimed before any other source file, so neither is taken.
 */
export function placeCodeBehind(
  { xaml }: WpfResources,
  types: readonly DecompiledType[],
  recorded: readonly (readonly string[] | null)[],
  layout: SourceLayout,
): CodeBehind {
  const placed = new Map<
    number,
    { class: string; source: string; xaml: string }
  >();
  for (const document of xaml.documents) {
    const index = types.findIndex(
      ({ declares: [own] }) =>
        own !== undefined && fullName(own) === document.class,
    );
    const type = types[index];
    if (type === undefined || document.class === null || placed.has(index)) {
      continue;
    }
    const stem = entryStem(document.entry);
    const own = recorded[index];
    const byPdb =
      own === null || own === undefined
        ? null
        : [
            ...own.slice(0, -1),
            (own[own.length - 1] as string).replace(/(\.xaml)?\.cs$/i, ""),
          ];
    const byNamespace = [...layout.folders(type.namespace), type.name];
    const segments =
      [byPdb, byNamespace].find(
        (candidate) =>
          candidate !== null &&
          candidate.join("/").toLowerCase() === stem.join("/").toLowerCase(),
      ) ?? stem;
    const folders = segments.slice(0, -1);
    const file = segments[segments.length - 1] as string;
    const xamlPath = layout.claimPath([...folders, `${file}.xaml`]);
    placed.set(index, {
      class: document.class,
      xaml: xamlPath,
      source: layout.claimPath([
        ...xamlPath.split("/").slice(0, -1),
        `${xamlPath.slice(xamlPath.lastIndexOf("/") + 1)}.cs`,
      ]),
    });
  }
  return placed;
}

/** The files and items of a project's WPF resources, planned. */
export interface PlannedXaml {
  /** Each file to write, relative to the project's folder: XAML as text, `Resource` files as bytes. */
  readonly files: readonly {
    readonly path: string;
    readonly contents: string | Uint8Array;
  }[];
  /** Its `ApplicationDefinition`, then its `Page`s, then its `Resource`s, each in the order the WPF resources hold them. */
  readonly items: readonly XamlItem[];
  /** What became of the WPF resources. */
  readonly resource: RecoveredResource;
}

/**
 * Lays out the XAML files and `Resource` files of a project's WPF resources,
 * claiming each path from `layout` once its sources have claimed theirs: each
 * class's XAML file where {@link placeCodeBehind} placed it, and any other
 * file where its entry says it was, in the case another file refers to it by
 * (`texts`, the project's XAML and C#), if one does, and in the case of any
 * folder already claimed.
 */
export function planXaml(
  { xaml, resource }: WpfResources,
  codeBehind: CodeBehind,
  layout: SourceLayout,
  texts: readonly string[],
): PlannedXaml {
  const documents = new Map(
    xaml.documents.map((document) => [document.entry, document]),
  );
  // Each class's XAML file, taken by the first document naming it.
  const classes = new Map(
    [...codeBehind.values()].map((placed) => [placed.class, placed.xaml]),
  );
  const files: { path: string; contents: string | Uint8Array }[] = [];
  const definitions: XamlItem[] = [];
  const pages: XamlItem[] = [];
  const resources: XamlItem[] = [];
  for (const entry of resource.entries) {
    const document = documents.get(entry.name);
    if (document === undefined) {
      const path = layout.claimInFolders(
        referencedCase(decoded(entry.name), texts),
      );
      files.push({ path, contents: entry.value as Uint8Array });
      resources.push({ itemType: "Resource", include: path });
      continue;
    }
    const placed =
      document.class === null ? undefined : classes.get(document.class);
    classes.delete(document.class ?? "");
    const path =
      placed ??
      layout.claimInFolders(
        referencedCase(`${entryStem(document.entry).join("/")}.xaml`, texts),
      );
    files.push({ path, contents: document.code });
    (document.applicationDefinition ? definitions : pages).push({
      itemType: document.applicationDefinition
        ? "ApplicationDefinition"
        : "Page",
      include: path,
    });
  }
  return {
    files,
    items: [...definitions, ...pages, ...resources],
    resource: {
      name: resource.name,
      culture: null,
      public: resource.public,
      recoveredAs: "xaml",
      path: null,
      reason: null,
    },
  };
}

function isBaml(entry: string): boolean {
  return entry.toLowerCase().endsWith(BAML_EXTENSION);
}

/** A BAML entry's XAML file's path, as segments, without its extension: `views/mainwindow.baml` → `views`, `mainwindow`. */
function entryStem(entry: string): string[] {
  return decoded(entry.slice(0, -BAML_EXTENSION.length)).split("/");
}

/**
 * An entry's name as the path it was, which the markup compiler escapes as a
 * URI does (`my%20logo.png`), with `/` between segments.
 */
function decoded(entry: string): string {
  try {
    return decodeURIComponent(entry);
  } catch {
    return entry;
  }
}

/**
 * `path` (`themes/palette.xaml`) as segments, in the case another file
 * refers to it by, as a URI does (`Source="Themes/Palette.xaml"`,
 * `"pack://application:,,,/Themes/Palette.xaml"`), if one does: in quotes, or
 * after an assembly's `;component/` or an app's `,,,/`. Otherwise as it is.
 */
function referencedCase(path: string, texts: readonly string[]): string[] {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = new RegExp(
    `(?:["']/?|;component/|,,,/)(${escaped})["']`,
    "i",
  );
  for (const text of texts) {
    const found = reference.exec(text)?.[1];
    if (found !== undefined) {
      return found.split("/");
    }
  }
  return path.split("/");
}

function fullName({
  namespace,
  name,
}: {
  readonly namespace: string;
  readonly name: string;
}): string {
  return namespace === "" ? name : `${namespace}.${name}`;
}
