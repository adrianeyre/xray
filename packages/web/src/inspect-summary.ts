// What the web app shows of an Assembly's metadata summary, the
// `xray inspect --json` document (docs/reference/xray-inspect-json.md).
// Nothing here needs a page, so @xray/server's tests hold it to what the CLI
// prints.

import type { InspectJson, ObfuscationCheck, PdbCheck } from "./events.js";

const OUTPUT_KINDS: Readonly<Record<string, string>> = {
  console: "Console",
  winforms: "WinForms",
  wpf: "WPF",
  windows: "Windows GUI, neither WinForms nor WPF",
  library: "Library",
};

const PDB_FORMATS: Readonly<Record<string, string>> = {
  portable: "portable",
  windows: "Windows",
};

/**
 * The PDB beside the Assembly, as `xray inspect` prints it: `none beside it`,
 * or the PDB and its format, then whether it would be used, and why not.
 */
export function pdbText(pdb: PdbCheck): string {
  if (pdb.status === "none") {
    return "none beside it";
  }
  if (pdb.path === undefined) {
    // A status added since, shown as it is.
    return pdb.status;
  }
  const format =
    pdb.format === null || pdb.format === undefined
      ? ""
      : ` (${named(PDB_FORMATS, pdb.format)})`;
  return pdb.status === "matching"
    ? `${pdb.path}${format}, its own: used for local names and source layout`
    : `${pdb.path}${format}, ignored: ${pdb.reason ?? pdb.status}`;
}

/**
 * Whether the Assembly shows signs of obfuscation, as `xray inspect` prints
 * it: `clean`, with none found, or that it is likely obfuscated, and so reconstructed as
 * it is, then each sign found.
 */
export function obfuscationText(obfuscation: ObfuscationCheck): string {
  switch (obfuscation.status) {
    case "clean":
      return "clean: no sign of it found";
    case "obfuscated":
      return [
        "likely obfuscated, so reconstructed as it is, not deobfuscated:",
        ...obfuscation.indicators.map(({ message }) => message),
      ].join(" ");
    default:
      // A status added since, shown as it is.
      return obfuscation.status;
  }
}

const SUPPORT: Readonly<Record<string, string>> = {
  "best-effort":
    "best effort: not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later",
  none: "none: no project can target it",
};

const BITNESSES: Readonly<Record<string, string>> = {
  any: "any: whatever the OS is",
};

/** Text for `value` from `names`, or `value` itself, for a value added to its enumeration since. */
function named(names: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(names, value) ? (names[value] as string) : value;
}

/**
 * Every field of `inspection`, as a label and the text shown for it, in the
 * order `xray inspect --json` gives them; the references are listed apart.
 */
export function inspectFacts(inspection: InspectJson): [string, string][] {
  const { assembly, targetFramework, architecture, entryPoint, counts } =
    inspection;
  return [
    ["File", inspection.path],
    ["Assembly", assembly.name],
    ["Version", assembly.version],
    ["Culture", assembly.culture ?? "neutral"],
    ["Public key token", assembly.publicKeyToken ?? "none: not strong-named"],
    ["Target framework", targetFramework.moniker ?? "unknown"],
    [
      "Framework name",
      targetFramework.frameworkName ?? "none: no TargetFrameworkAttribute",
    ],
    ["Runtime version", targetFramework.runtimeVersion],
    [
      "Told from",
      targetFramework.inferredFrom ??
        (targetFramework.frameworkName === null
          ? "nothing: it records no TargetFrameworkAttribute"
          : "its TargetFrameworkAttribute"),
    ],
    ["Support", named(SUPPORT, targetFramework.support)],
    ["Platform target", architecture.platformTarget ?? "unknown"],
    ["Prefer 32-bit", architecture.prefer32Bit ? "yes" : "no"],
    ["Bitness", named(BITNESSES, architecture.bitness)],
    ["Machine", architecture.machine],
    [
      "Entry point",
      entryPoint === null
        ? "none: a library"
        : `${entryPoint.type}.${entryPoint.method}`,
    ],
    ["Output kind", named(OUTPUT_KINDS, inspection.outputKind)],
    ["Types", String(counts.types)],
    ["Methods", String(counts.methods)],
    ["Resources", String(counts.resources)],
    ["PDB", pdbText(inspection.pdb)],
    ["Obfuscation", obfuscationText(inspection.obfuscation)],
  ];
}

/** The document as `xray inspect --json` prints it, but for its last line break. */
export function inspectJsonText(inspection: InspectJson): string {
  return JSON.stringify(inspection, null, 2);
}
