// The resources of a Recovered Solution's projects (FR-12): every resource of
// an Assembly's manifest, and of its satellite assemblies, laid out beside its
// sources and embedded under its own logical name, so the rebuilt Assembly's
// manifest names each as the original's did. A `.resources` file whose
// entries a `.resx` can hold again becomes one, which the build compiles back;
// any other resource is embedded as it is:
//
//   <Name>/Strings.resx                 <Root>.Strings.resources
//   <Name>/Strings.fr.resx              <Root>.Strings.fr.resources, of fr/<Name>.resources.dll
//   <Name>/Images.resx                  <Root>.Images.resources, holding a byte[]…
//   <Name>/Images/Flag.png              …which it refers to
//   <Name>/Phrases/Menu.resx            <Root>.Phrases.Menu.resources, beside Phrases/Menu.cs
//   <Name>/Assets.logo.png              <Root>.Assets.logo.png, as it is

import type { SourceLayout } from "./recovered-solution.js";

/** An entry of a `.resources` file that a `.resx` built by the .NET SDK can hold again. */
export interface ResourceEntry {
  readonly name: string;
  /** `string`, held in the `.resx`; or `bytes` (a `byte[]`) or `stream`, held in a file it refers to. */
  readonly kind: "string" | "bytes" | "stream";
  /** The string; or, for `bytes` and `stream`, every byte. */
  readonly value: string | Uint8Array;
}

/**
 * A resource of an Assembly's manifest, as the engine reads it
 * (engine/Xray.Engine/ManifestResources.cs).
 */
export interface ManifestResource {
  /** Its logical name, as `GetManifestResourceStream` asks for it: `App.Strings.resources`. */
  readonly name: string;
  /** Whether it is public, rather than private to its Assembly. */
  readonly public: boolean;
  /** `embedded` in the Assembly, or linked: in another `file` of it, or in another `assembly`. */
  readonly location: "embedded" | "file" | "assembly";
  /** For a linked resource, the file or assembly it is in; otherwise `null`. */
  readonly linkedTo: string | null;
  /** An embedded resource's bytes, unless {@link entries} gives them; otherwise `null`. */
  readonly data: Uint8Array | null;
  /**
   * For an embedded `.resources` file whose every entry a `.resx` can hold
   * again, each of them; otherwise `null`.
   */
  readonly entries: readonly ResourceEntry[] | null;
  /** For an embedded `.resources` file whose entries are not given, why; otherwise `null`. */
  readonly notDecoded: string | null;
}

/** A satellite assembly beside an Assembly, holding its resources for one culture. */
export interface SatelliteResources {
  /** The culture, as the satellite assembly records it: `fr`, `zh-Hans`. */
  readonly culture: string;
  /** The satellite assembly, as an absolute path: `<folder>/fr/App.resources.dll`. */
  readonly path: string;
  readonly resources: readonly ManifestResource[];
}

/** The resources of an Assembly, and of each of its satellite assemblies. */
export interface AssemblyResources {
  readonly resources: readonly ManifestResource[];
  /** In order of their culture. */
  readonly satellites: readonly SatelliteResources[];
}

/** An Assembly with no resources, and no satellite assemblies. */
export const NO_RESOURCES: AssemblyResources = {
  resources: [],
  satellites: [],
};

/** What became of a resource of the original. */
export interface RecoveredResource {
  /** Its logical name, which the rebuilt Assembly's manifest gives it too. */
  readonly name: string;
  /** The culture of the satellite assembly it is in, e.g. `fr`; `null` for the Assembly's own. */
  readonly culture: string | null;
  /** Whether it is public, rather than private to its Assembly, as it was. */
  readonly public: boolean;
  /**
   * `resx`: a `.resources` file written as a `.resx`, which the build
   * compiles back to it. `file`: embedded as it is, byte for byte.
   * `not-recovered`: a linked resource, in a file or an assembly other than
   * the original's, which the rebuilt Assembly does not have. `xaml`: the
   * WPF resources, split back into the XAML files their BAML was compiled
   * from and the `Resource` files they held, which the build compiles back
   * to them (see recovered-xaml.ts).
   */
  readonly recoveredAs: "resx" | "file" | "not-recovered" | "xaml";
  /** The file it is embedded from, relative to the project's folder with `/` between segments; `null` if it is not recovered, or is recovered as XAML. */
  readonly path: string | null;
  /**
   * Why a `.resources` file was embedded as it is rather than written as a
   * `.resx`, or why a resource was not recovered; otherwise `null`.
   */
  readonly reason: string | null;
}

/** An `EmbeddedResource` of a project. */
export interface EmbeddedResourceItem {
  /** The file, relative to the project's folder with `/` between segments. */
  readonly include: string;
  /** The `LogicalName`: the resource's name, as the original's manifest gives it. */
  readonly logicalName: string;
  /** Whether it is public; a private one is `Access="Private"`. */
  readonly public: boolean;
  /** `resx`, compiled by the build; or `file`, embedded as it is. */
  readonly kind: "resx" | "file";
}

/** The resources of a project, planned. */
export interface PlannedResources {
  /** Each file to write, relative to the project's folder: `.resx` files as text, the rest as bytes. */
  readonly files: readonly {
    readonly path: string;
    readonly contents: string | Uint8Array;
  }[];
  /** Its `EmbeddedResource` items, the Assembly's own, then each satellite assembly's. */
  readonly items: readonly EmbeddedResourceItem[];
  /** What became of each resource, in the same order, with those not recovered. */
  readonly resources: readonly RecoveredResource[];
  /**
   * Whether a `.resources` file embedded as it is names
   * `System.Resources.Extensions`' reader as the one to read it with, as the
   * .NET SDK writes one holding anything but strings, `byte[]`s and streams
   * (a form's icon), so the rebuilt program needs it to read it.
   */
  readonly readByResourcesExtensions: boolean;
}

/** Where a project's types are, for resources named after them to go beside them. */
export interface TypeLayout {
  /** The project's root namespace. */
  readonly rootNamespace: string;
  /** Every namespace a type is declared in. */
  readonly namespaces: readonly string[];
  /**
   * The file each top-level type is declared in, relative to the project's
   * folder, by its full metadata name: `App.Phrases.Menu` → `Phrases/Menu.cs`.
   */
  readonly files: ReadonlyMap<string, string>;
}

const RESOURCES_EXTENSION = ".resources";

/**
 * Lays out an Assembly's resources in its project, claiming each path from
 * `layout`, which already holds its sources: a resource named after a type
 * (`App.MainForm.resources`), as Visual Studio's are, beside that type's
 * file, named after it (`MainForm.resx` beside `MainForm.cs`); any other in
 * the folder of the longest namespace its name starts with, named by the rest
 * of it (`App.Assets.logo.png` → `Assets.logo.png`, where only `App` has
 * types), as ILSpy lays them out, since a name does not say which of its dots
 * were folders. A satellite assembly's resource is beside the Assembly's own
 * of the same name, its culture before its extension (`Strings.fr.resx`), as
 * the build tells which satellite assembly a file goes to. A file name the
 * build would mistake for a culture's (`jquery.min.js`, `min` being a
 * language's code) has that dot made a `_`.
 */
export function planResources(
  resources: AssemblyResources,
  layout: SourceLayout,
  types: TypeLayout,
): PlannedResources {
  const files: { path: string; contents: string | Uint8Array }[] = [];
  const items: EmbeddedResourceItem[] = [];
  const recovered: RecoveredResource[] = [];
  let readByResourcesExtensions = false;
  // Each logical name, without its culture and extension, by where its files go.
  const stems = new Map<string, readonly string[]>();
  const namespaces = [
    ...new Set([...types.namespaces, types.rootNamespace]),
  ].sort((a, b) => b.length - a.length);

  /** Where the files of a name go, without its extension, as segments. */
  function place(base: string): readonly string[] {
    const typeFile = types.files.get(base);
    if (typeFile !== undefined) {
      return typeFile.replace(/\.cs$/i, "").split("/");
    }
    const namespace = namespaces.find(
      (candidate) =>
        candidate !== "" &&
        base.startsWith(`${candidate}.`) &&
        base.length > candidate.length + 1,
    );
    return namespace === undefined
      ? [base]
      : [...layout.folders(namespace), base.slice(namespace.length + 1)];
  }

  const all = [
    ...resources.resources.map((resource) => ({ resource, culture: null })),
    ...resources.satellites.flatMap(({ culture, resources }) =>
      resources.map((resource) => ({ resource, culture })),
    ),
  ];
  for (const { resource, culture } of all) {
    const { name } = resource;
    if (resource.location !== "embedded") {
      recovered.push({
        name,
        culture,
        public: resource.public,
        recoveredAs: "not-recovered",
        path: null,
        reason: `It is not embedded in the Assembly, but in ${resource.location === "file" ? "the file" : "the assembly"} ${resource.linkedTo ?? "it names"}, which Xray does not recover, so the rebuilt Assembly has no resource of that name.`,
      });
      continue;
    }
    const { entries } = resource;
    const { base, extension } = splitName(name, culture, entries !== null);
    const key = base.toLowerCase();
    const stem = stems.get(key) ?? place(base);
    const folders = stem.slice(0, -1);
    const fileStem = stem[stem.length - 1] as string;
    const file =
      culture === null
        ? notCultured(`${fileStem}${extension}`)
        : // The build needs an extension to find a culture before it.
          `${fileStem}.${culture}${extension === "" ? ".bin" : extension}`;
    const path = layout.claimPath([...folders, file]);
    if (!stems.has(key)) {
      // Where the Assembly's own went, made safe and kept apart, its
      // satellite assemblies' go too.
      stems.set(
        key,
        culture === null
          ? path
              .slice(0, path.length - extensionIn(path, extension).length)
              .split("/")
          : stem,
      );
    }
    if (entries === null) {
      readByResourcesExtensions ||=
        extension === RESOURCES_EXTENSION &&
        resource.data !== null &&
        RESOURCES_EXTENSIONS_READER.test(resourceReaderOf(resource.data) ?? "");
      files.push({ path, contents: resource.data ?? new Uint8Array() });
      items.push({
        include: path,
        logicalName: name,
        public: resource.public,
        kind: "file",
      });
      recovered.push({
        name,
        culture,
        public: resource.public,
        recoveredAs: "file",
        path,
        reason: resource.notDecoded,
      });
      continue;
    }

    // A byte[] or a stream is in a file of its own, in a folder named after
    // the .resx beside it, as the .resx refers to it.
    const resxFolder = path.slice(0, path.lastIndexOf("/") + 1);
    const holder = path.slice(resxFolder.length, -".resx".length);
    const data: ResxData[] = [];
    for (const entry of [...entries].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (entry.kind === "string") {
        data.push({ name: entry.name, text: entry.value as string });
        continue;
      }
      const bytes = entry.value as Uint8Array;
      const referenced = layout.claimPath([
        ...path.split("/").slice(0, -1),
        holder,
        `${entry.name.replaceAll(";", "_")}${extensionOf(bytes)}`,
      ]);
      files.push({ path: referenced, contents: bytes });
      data.push({
        name: entry.name,
        file: referenced.slice(resxFolder.length),
        kind: entry.kind,
      });
    }
    files.push({ path, contents: resxFile(data) });
    items.push({
      include: path,
      logicalName: name,
      public: resource.public,
      kind: "resx",
    });
    recovered.push({
      name,
      culture,
      public: resource.public,
      recoveredAs: "resx",
      path,
      reason: null,
    });
  }
  return { files, items, resources: recovered, readByResourcesExtensions };
}

// The reader System.Resources.Extensions writes into a .resources file's
// header, by its assembly-qualified name, whichever version it names.
const RESOURCES_EXTENSIONS_READER =
  /^System\.Resources\.Extensions\.DeserializingResourceReader\s*,\s*System\.Resources\.Extensions\s*(,|$)/;
// What a .resources file starts with.
const RESOURCES_MAGIC = 0xbeefcace;

/**
 * The type a `.resources` file's header names to read it with, as its
 * resource manager reads it: after the magic number and the header's version,
 * the length of the rest of the header, then the reader's assembly-qualified
 * name (`System.Resources.ResourceReader, mscorlib, …`), a string of UTF-8
 * prefixed with its length, 7 bits to a byte. `null` if it is not a
 * `.resources` file, or names none.
 */
export function resourceReaderOf(bytes: Uint8Array): string | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || view.getUint32(0, true) !== RESOURCES_MAGIC) {
    return null;
  }
  let offset = 12;
  let length = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    if (offset >= bytes.length) {
      return null;
    }
    const byte = bytes[offset++] as number;
    length |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
  }
  if (length <= 0 || offset + length > bytes.length) {
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      bytes.subarray(offset, offset + length),
    );
  } catch {
    return null;
  }
}

/**
 * A logical name, without its culture, if it ends with it, and the extension
 * its file takes: `.resx` for a `.resources` file written as one,
 * `.resources` for one embedded as it is, and the name's own for any other
 * file (`.png`), if it has one.
 */
function splitName(
  name: string,
  culture: string | null,
  asResx: boolean,
): { base: string; extension: string } {
  let base: string;
  let extension: string;
  if (
    name.toLowerCase().endsWith(RESOURCES_EXTENSION) &&
    name.length > RESOURCES_EXTENSION.length
  ) {
    base = name.slice(0, -RESOURCES_EXTENSION.length);
    extension = asResx ? ".resx" : RESOURCES_EXTENSION;
  } else {
    const dot = name.lastIndexOf(".");
    [base, extension] =
      dot <= 0 ? [name, ""] : [name.slice(0, dot), name.slice(dot)];
  }
  if (
    culture !== null &&
    base.toLowerCase().endsWith(`.${culture.toLowerCase()}`) &&
    base.length > culture.length + 1
  ) {
    base = base.slice(0, -(culture.length + 1));
  }
  return { base, extension };
}

/** `extension`, if `path` ends with it, ignoring case; otherwise `""`. */
function extensionIn(path: string, extension: string): string {
  return extension !== "" &&
    path.toLowerCase().endsWith(extension.toLowerCase())
    ? extension
    : "";
}

// What the build might take for a culture's name, between the last two dots
// of a file's name (`Strings.fr.resx`): it makes a file of that culture's
// satellite assembly.
const CULTURE_LIKE = /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i;

/**
 * A neutral resource's file name, with the dot before anything the build
 * might take for a culture's name made a `_`: `jquery.min.js` →
 * `jquery_min.js`, so it is not put in a satellite assembly.
 */
function notCultured(file: string): string {
  const extension = file.lastIndexOf(".");
  const stem = extension <= 0 ? file : file.slice(0, extension);
  const dot = stem.lastIndexOf(".");
  return dot > 0 && CULTURE_LIKE.test(stem.slice(dot + 1))
    ? `${stem.slice(0, dot)}_${file.slice(dot + 1)}`
    : file;
}

/** The extension a file of these bytes is given: an image's own, `.txt` for text, else `.bin`. */
export function extensionOf(bytes: Uint8Array): string {
  const starts = (...prefix: number[]) =>
    prefix.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return ".png";
  }
  if (starts(0xff, 0xd8, 0xff)) {
    return ".jpg";
  }
  if (starts(0x47, 0x49, 0x46, 0x38)) {
    return ".gif";
  }
  if (starts(0x42, 0x4d) && bytes.length >= 14) {
    return ".bmp";
  }
  if (starts(0x00, 0x00, 0x01, 0x00) && bytes.length >= 6) {
    return ".ico";
  }
  return isText(bytes) ? ".txt" : ".bin";
}

/** Whether bytes are UTF-8 text, without control characters but tabs and line endings. */
function isText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) {
    return false;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  // eslint-disable-next-line no-control-regex
  return !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text);
}

/** An entry of a `.resx`: a string it holds, or a file it refers to. */
type ResxData =
  | { readonly name: string; readonly text: string }
  | {
      readonly name: string;
      /** Relative to the `.resx`'s folder, with `/` between segments. */
      readonly file: string;
      readonly kind: "bytes" | "stream";
    };

const WINFORMS =
  "System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089";
const MSCORLIB =
  "mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089";

/**
 * A `.resx` as Visual Studio writes one, without the schema it repeats in
 * each: its strings inline, and each byte[] or stream a `ResXFileRef` to its
 * file, which the .NET SDK reads as it builds it, without
 * `System.Resources.Extensions`. Line breaks in a string are kept as they
 * are, a `\r` written as `&#xD;`, which XML would otherwise read as a `\n`.
 */
export function resxFile(data: readonly ResxData[]): string {
  const header = (name: string, value: string) => [
    `  <resheader name="${name}">`,
    `    <value>${value}</value>`,
    "  </resheader>",
  ];
  const refers = data.some((entry) => "file" in entry);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<root>",
    ...header("resmimetype", "text/microsoft-resx"),
    ...header("version", "2.0"),
    ...header("reader", `System.Resources.ResXResourceReader, ${WINFORMS}`),
    ...header("writer", `System.Resources.ResXResourceWriter, ${WINFORMS}`),
    ...(refers
      ? [`  <assembly alias="System.Windows.Forms" name="${WINFORMS}" />`]
      : []),
    ...data.flatMap((entry) =>
      "text" in entry
        ? [
            `  <data name="${xmlAttribute(entry.name)}" xml:space="preserve">`,
            `    <value>${xmlText(entry.text)}</value>`,
            "  </data>",
          ]
        : [
            `  <data name="${xmlAttribute(entry.name)}" type="System.Resources.ResXFileRef, System.Windows.Forms">`,
            `    <value>${xmlText(entry.file)};${entry.kind === "bytes" ? "System.Byte[]" : "System.IO.MemoryStream"}, ${MSCORLIB}</value>`,
            "  </data>",
          ],
    ),
    "</root>",
    "",
  ].join("\n");
}

function xmlText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\r", "&#xD;");
}

function xmlAttribute(text: string): string {
  return xmlText(text)
    .replaceAll('"', "&quot;")
    .replaceAll("\n", "&#xA;")
    .replaceAll("\t", "&#x9;");
}
