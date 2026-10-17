// The metadata summary of a Managed Assembly (FR-5), and how it is derived
// from what the engine reads (engine/Xray.Engine/AssemblyInspector.cs).

import { basename } from "node:path";

/** An assembly's name, as its definition or a reference to it records it. */
export interface AssemblyIdentity {
  readonly name: string;
  /** Four-part, e.g. `1.0.0.0`. */
  readonly version: string;
  /** `null` for the neutral culture. */
  readonly culture: string | null;
  /** Lower-case hex, or `null` when the assembly is not strong-named. */
  readonly publicKeyToken: string | null;
}

export interface TargetFramework {
  /** The target framework moniker, e.g. `net8.0` or `net472`; `null` when it cannot be told. */
  readonly moniker: string | null;
  /** The `TargetFrameworkAttribute`, e.g. `.NETCoreApp,Version=v8.0`; `null` when absent. */
  readonly frameworkName: string | null;
  /** The CLR version the metadata was written for, e.g. `v4.0.30319`. */
  readonly runtimeVersion: string;
  /**
   * How the moniker was told, for people, when the Assembly has no
   * `TargetFrameworkAttribute` to say, as before .NET Framework 4.0: e.g.
   * `CLR v2.0.50727 and its reference to System.Core 3.5.0.0`; `null` when
   * the attribute says, or the moniker cannot be told.
   */
  readonly inferredFrom: string | null;
  /** How far Xray supports reconstructing an Assembly for it (FR-8). */
  readonly support: TargetFrameworkSupport;
}

/**
 * `full`: a framework FR-8 fully supports, .NET Framework 4.0–4.8.1, .NET
 * Core 3.1 or .NET 5 and later. `best-effort`: one a project can target, but
 * that FR-8 supports only as far as it can, such as .NET Framework 2.0 and
 * 3.5 and `netstandard`. `none`: none a project can target, so no moniker.
 */
export type TargetFrameworkSupport = "full" | "best-effort" | "none";

/** MSBuild's `PlatformTarget`. */
export type PlatformTarget =
  "AnyCPU" | "x86" | "x64" | "ARM" | "ARM64" | "Itanium";

/** Whether the Assembly runs as a 32-bit process, a 64-bit one, or whichever the OS is. */
export type Bitness = "any" | "32-bit" | "64-bit";

export interface Architecture {
  /** `null` when the machine type is not one .NET compilers target. */
  readonly platformTarget: PlatformTarget | null;
  /** AnyCPU, but run as a 32-bit process where the OS allows it. */
  readonly prefer32Bit: boolean;
  readonly bitness: Bitness;
  /** The PE header's machine type, as the engine names it (e.g. `I386`, `Amd64`). */
  readonly machine: string;
}

/** The method the runtime starts a program at. */
export interface EntryPoint {
  /** The declaring type's full name, nested types joined with `+`. */
  readonly type: string;
  readonly method: string;
}

/**
 * What kind of program the Assembly is: a `library` has no entry point; a
 * program for the Windows console subsystem is `console`; a GUI program is
 * `wpf` or `winforms` by what it references, else `windows`.
 */
export type OutputKind = "console" | "winforms" | "wpf" | "windows" | "library";

export interface AssemblyCounts {
  /** Every type defined, nested and compiler-generated ones included. */
  readonly types: number;
  /** Every method defined, constructors and property accessors included. */
  readonly methods: number;
  /** Every manifest resource, embedded or linked. */
  readonly resources: number;
}

/**
 * The two formats a PDB can be in: the portable one the .NET SDK writes by
 * default, and the older Windows (MSF) one, written only on Windows.
 */
export type PdbFormat = "portable" | "windows";

/**
 * Whether a PDB sits beside the Assembly, named after it (`App.pdb` beside
 * `App.dll`), and whether it is the Assembly's own (FR-4, FR-5): only then is
 * it used, for local variable names and to lay files out by their original
 * source paths. One that is not, or cannot be read, is ignored.
 */
export type PdbCheck =
  | {
      /** No PDB beside it. */
      readonly status: "none";
    }
  | {
      /** The Assembly's own PDB: its ID is the one the Assembly records. */
      readonly status: "matching";
      /** The PDB, as an absolute path. */
      readonly path: string;
      readonly format: PdbFormat;
    }
  | {
      /**
       * `mismatched`: a PDB, but not the Assembly's own, being another build's
       * or the Assembly recording none; `unreadable`: not a PDB of either
       * format, or one that could not be read.
       */
      readonly status: "mismatched" | "unreadable";
      readonly path: string;
      /** `null` when it is a PDB of neither format. */
      readonly format: PdbFormat | null;
      /** Why it is not used. */
      readonly reason: string;
    };

/**
 * A sign that an Assembly is obfuscated (FR-3), found in what the engine
 * counted of it.
 */
export interface ObfuscationIndicator {
  /**
   * `obfuscator-attribute`: it bears an attribute a known obfuscator marks
   * its output with. `mangled-identifiers`: its types and members are named
   * as an obfuscator renames them: one or more of their names hold
   * characters no source file shows, or at least half of
   * {@link SHORT_NAMES_COUNTED} or more are one or two characters long.
   * `encrypted-strings`: its strings are hidden: as many of them, or more,
   * come from calls to string decoders, methods that decode them from bytes,
   * as are written as literals.
   */
  readonly kind:
    "obfuscator-attribute" | "mangled-identifiers" | "encrypted-strings";
  /**
   * What was found, as it is: the attribute's full name; the first few
   * names, unprintable ones if any are, else short ones; or the full name of
   * each type holding the string decoders called.
   */
  readonly evidence: readonly string[];
  /** What was found, and how much of it, for people. */
  readonly message: string;
}

/**
 * Whether the Assembly shows signs of obfuscation (FR-3, FR-5): `obfuscated`
 * with each sign found, or `clean`, with none. Xray only reports it: an
 * obfuscated Assembly is reconstructed as it is, never deobfuscated.
 */
export interface ObfuscationCheck {
  readonly status: "clean" | "obfuscated";
  /** Empty when it is `clean`. */
  readonly indicators: readonly ObfuscationIndicator[];
}

/** The metadata summary of a Managed Assembly (FR-5). */
export interface AssemblySummary {
  /** The Assembly, as an absolute path. */
  readonly path: string;
  readonly assembly: AssemblyIdentity;
  readonly targetFramework: TargetFramework;
  readonly architecture: Architecture;
  /** `null` for a library. */
  readonly entryPoint: EntryPoint | null;
  readonly outputKind: OutputKind;
  /** Every assembly it references, sorted by name. */
  readonly references: readonly AssemblyIdentity[];
  readonly counts: AssemblyCounts;
  readonly pdb: PdbCheck;
  readonly obfuscation: ObfuscationCheck;
}

/** The engine's answer to `inspect` (engine/Xray.Engine/Session.cs). */
export interface EngineInspection {
  readonly assembly: AssemblyIdentity;
  readonly references: readonly AssemblyIdentity[];
  readonly targetFramework: string | null;
  readonly targetPlatform: string | null;
  readonly runtimeVersion: string;
  /** The `AssemblyInformationalVersionAttribute`'s; absent from an engine that does not read it. */
  readonly informationalVersion?: string | null;
  readonly machine: string;
  readonly pe32Plus: boolean;
  readonly corFlags: {
    readonly ilOnly: boolean;
    readonly requires32Bit: boolean;
    readonly prefers32Bit: boolean;
  };
  readonly subsystem: string;
  readonly entryPoint: EntryPoint | null;
  readonly typeCount: number;
  readonly methodCount: number;
  readonly resourceCount: number;
  /**
   * Whether the PDB it was asked to check is the Assembly's own: `null`, or
   * absent from an engine that does not check, when it was asked of none.
   */
  readonly pdb?: EnginePdbCheck | null;
  /** The marks of obfuscation it holds, as counted. */
  readonly obfuscation: EngineObfuscationEvidence;
}

/** The engine's count of the marks of obfuscation in an Assembly (engine/Xray.Engine/ObfuscationScanner.cs). */
export interface EngineObfuscationEvidence {
  /** The full name of every attribute type applied to the assembly or its module. */
  readonly attributes: readonly string[];
  /** The names its source would have given its types and members. */
  readonly names: {
    readonly count: number;
    readonly unprintable: number;
    readonly short: number;
    readonly unprintableExamples: readonly string[];
    readonly shortExamples: readonly string[];
  };
  readonly strings: {
    readonly literals: number;
    readonly decoderCalls: number;
    readonly decoderTypes: readonly string[];
  };
}

/** The engine's check of a PDB (engine/Xray.Engine/DebugSymbols.cs). */
export interface EnginePdbCheck {
  /** `null` when it is a PDB of neither format. */
  readonly format: PdbFormat | null;
  /**
   * Why it is not the Assembly's own: the Assembly records no PDB
   * (`unrecorded`), or another (`other-build`), or it could not be read
   * (`unreadable`); `null` when it is.
   */
  readonly mismatch: "unrecorded" | "other-build" | "unreadable" | null;
}

/**
 * Turns what the engine read from the Assembly at `path` into its summary,
 * with what it found of the PDB at `pdbPath`, the one beside it, if any.
 */
export function summarizeAssembly(
  path: string,
  inspection: EngineInspection,
  pdbPath: string | null = null,
): AssemblySummary {
  const references = inspection.references.map(identity).sort(byName);
  const inferred =
    inspection.targetFramework === null
      ? inferTargetFramework(inspection.runtimeVersion, references)
      : null;
  const moniker =
    inferred?.moniker ??
    targetFrameworkMoniker(
      inspection.targetFramework,
      inspection.targetPlatform,
    );
  return {
    path,
    assembly: identity(inspection.assembly),
    targetFramework: {
      moniker,
      frameworkName: inspection.targetFramework,
      runtimeVersion: inspection.runtimeVersion,
      inferredFrom: inferred?.inferredFrom ?? null,
      support: targetFrameworkSupport(moniker),
    },
    architecture: architecture(inspection),
    entryPoint:
      inspection.entryPoint === null
        ? null
        : {
            type: inspection.entryPoint.type,
            method: inspection.entryPoint.method,
          },
    outputKind: outputKind(inspection),
    references,
    counts: {
      types: inspection.typeCount,
      methods: inspection.methodCount,
      resources: inspection.resourceCount,
    },
    pdb: pdbCheck(path, pdbPath, inspection.pdb ?? null),
    obfuscation: obfuscationCheck(inspection.obfuscation),
  };
}

/**
 * Attributes known obfuscators mark their output with, by the type's full
 * name, and the obfuscator each is the mark of. Not
 * `System.Reflection.ObfuscationAttribute` or `ObfuscateAssemblyAttribute`:
 * those ask an obfuscator to obfuscate, and are removed once one has.
 */
export const OBFUSCATOR_ATTRIBUTES: ReadonlyMap<string, string> = new Map([
  ["ConfusedByAttribute", "ConfuserEx"],
  ["DotfuscatorAttribute", "Dotfuscator"],
  ["SmartAssembly.Attributes.PoweredByAttribute", "SmartAssembly"],
  [
    "CryptoObfuscator.ProtectedWithCryptoObfuscatorAttribute",
    "Crypto Obfuscator",
  ],
  ["SecureTeam.Attributes.ObfuscatedByAgileDotNetAttribute", "Agile.NET"],
  ["SecureTeam.Attributes.ObfuscatedByCliSecureAttribute", "CliSecure"],
  ["ObfuscatedByGoliath", "Goliath.NET"],
  ["BabelAttribute", "Babel Obfuscator"],
  ["BabelObfuscatorAttribute", "Babel Obfuscator"],
  ["YanoAttribute", "Yano"],
  [
    "Xenocode.Client.Attributes.AssemblyAttributes.ProcessedByXenocode",
    "Xenocode",
  ],
]);

/**
 * At least this many names must be counted before short ones can be a sign:
 * in a handful, a few short names are no more than chance.
 */
export const SHORT_NAMES_COUNTED = 10;

/** How many examples a message gives. */
const EXAMPLES = 5;

/**
 * Whether the marks the engine counted make the Assembly likely obfuscated,
 * and by which signs. Short names are a sign when at least half of
 * {@link SHORT_NAMES_COUNTED} or more names are; ordinary code names few so
 * (6% at most, across the .NET 8 shared framework and every Fixture).
 */
function obfuscationCheck(
  evidence: EngineObfuscationEvidence,
): ObfuscationCheck {
  const indicators: ObfuscationIndicator[] = [];
  for (const attribute of evidence.attributes) {
    const obfuscator = OBFUSCATOR_ATTRIBUTES.get(attribute);
    if (obfuscator !== undefined) {
      indicators.push({
        kind: "obfuscator-attribute",
        evidence: [attribute],
        message: `It bears ${attribute}, the attribute ${obfuscator} marks what it has obfuscated with.`,
      });
    }
  }

  const { names, strings } = evidence;
  const unprintable = names.unprintable > 0;
  const short =
    names.count >= SHORT_NAMES_COUNTED && names.short * 2 >= names.count;
  if (unprintable || short) {
    const examples = unprintable
      ? names.unprintableExamples
      : names.shortExamples;
    const found = [
      ...(unprintable
        ? [
            `${names.unprintable} of its ${names.count} names ${names.unprintable === 1 ? "holds" : "hold"} characters no source file shows, such as ${examples.slice(0, EXAMPLES).map(shown).join(", ")}`,
          ]
        : []),
      ...(short
        ? [
            `${names.short} of its ${names.count} names (${percent(names.short, names.count)}) are one or two characters long${unprintable ? "" : `, such as ${examples.slice(0, EXAMPLES).join(", ")}`}`,
          ]
        : []),
    ];
    indicators.push({
      kind: "mangled-identifiers",
      evidence: examples,
      message: `${capitalize(found.join("; and "))}: names an obfuscator gives, not a programmer.`,
    });
  }

  if (strings.decoderCalls > 0 && strings.decoderCalls >= strings.literals) {
    indicators.push({
      kind: "encrypted-strings",
      evidence: strings.decoderTypes,
      message: `Its strings are hidden: ${plural(strings.decoderCalls, "call")} fetch them from string decoders, which decode them from bytes (in ${strings.decoderTypes.join(", ")}), against ${plural(strings.literals, "literal")}.`,
    });
  }

  return {
    status: indicators.length === 0 ? "clean" : "obfuscated",
    indicators,
  };
}

/** A name as text can show it: each character no source file shows as its `\uXXXX` escape. */
function shown(name: string): string {
  return [...name]
    .map((character) =>
      /^[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\p{Zl}\p{Zp}]$/u.test(character) ||
      (/^\p{Zs}$/u.test(character) && character !== " ")
        ? [...character]
            .map(
              (unit) =>
                `\\u${unit.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`,
            )
            .join("")
        : character,
    )
    .join("");
}

function percent(part: number, whole: number): string {
  return `${Math.floor((part * 100) / whole)}%`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const PDB_FORMATS: Readonly<Record<PdbFormat, string>> = {
  portable: "a portable PDB",
  windows: "a Windows PDB",
};

/** What the PDB at `pdbPath` is to the Assembly at `path`, as the engine found. */
function pdbCheck(
  path: string,
  pdbPath: string | null,
  check: EnginePdbCheck | null,
): PdbCheck {
  if (pdbPath === null || check === null) {
    return { status: "none" };
  }
  const { format, mismatch } = check;
  if (mismatch === null && format !== null) {
    return { status: "matching", path: pdbPath, format };
  }
  const assembly = basename(path);
  const pdb = basename(pdbPath);
  const what = format === null ? "" : `, ${PDB_FORMATS[format]},`;
  switch (mismatch) {
    case "unrecorded":
      return {
        status: "mismatched",
        path: pdbPath,
        format,
        reason: `${pdb}${what} is not ${assembly}'s own: ${assembly} records no PDB, as it was built without debug information.`,
      };
    case "other-build":
      return {
        status: "mismatched",
        path: pdbPath,
        format,
        reason: `${pdb}${what} is not ${assembly}'s own: its ID is not the one ${assembly} records, so it is another build's.`,
      };
    default:
      return {
        status: "unreadable",
        path: pdbPath,
        format,
        reason:
          format === null
            ? `${pdb} is not a PDB: it is neither a portable nor a Windows one.`
            : `${pdb} could not be read as ${PDB_FORMATS[format]}.`,
      };
  }
}

/**
 * The moniker a project would use for the framework named by a
 * `TargetFrameworkAttribute` (and, from .NET 5, a `TargetPlatformAttribute`):
 * `.NETCoreApp,Version=v8.0` → `net8.0`, `.NETFramework,Version=v4.7.2` →
 * `net472`, `.NETStandard,Version=v2.0` → `netstandard2.0`.
 */
export function targetFrameworkMoniker(
  frameworkName: string | null,
  targetPlatform: string | null,
): string | null {
  const parsed =
    frameworkName === null ? undefined : parseFrameworkName(frameworkName);
  if (parsed === undefined) {
    return null;
  }
  const { identifier, version, profile } = parsed;
  const [major = 0, minor = 0] = version;
  switch (identifier.toLowerCase()) {
    case ".netcoreapp": {
      if (profile !== undefined) {
        return null;
      }
      if (major < 5) {
        return `netcoreapp${major}.${minor}`;
      }
      const platform =
        targetPlatform === null ? "" : platformSuffix(targetPlatform);
      return platform === undefined ? null : `net${major}.${minor}${platform}`;
    }
    case ".netframework": {
      // Only the Client Profile has a moniker of its own.
      const suffix =
        profile === undefined
          ? ""
          : profile.toLowerCase() === "client"
            ? "-client"
            : undefined;
      return suffix === undefined ? null : `net${version.join("")}${suffix}`;
    }
    case ".netstandard":
      return profile === undefined ? `netstandard${major}.${minor}` : null;
    default:
      return null;
  }
}

// The keys .NET Framework's own assemblies are signed with: the ECMA key
// (`mscorlib`, `System.Core`), Microsoft's (`System.Drawing`) and the shared
// one (`WindowsBase`, `System.Web.Extensions`).
const NET_FRAMEWORK_PUBLIC_KEY_TOKENS: ReadonlySet<string> = new Set([
  "b77a5c561934e089",
  "b03f5f7f11d50a3a",
  "31bf3856ad364e35",
]);

/**
 * The moniker of the .NET Framework an Assembly with no
 * `TargetFrameworkAttribute`, which compilers wrote only from .NET Framework
 * 4.0, was most likely built for, and how that was told; `null` when it
 * cannot be told. .NET Framework 2.0, 3.0 and 3.5 share CLR 2.0
 * (`v2.0.50727`): an Assembly for it is `net35` if it references one of the
 * framework's assemblies at version 3.0 or 3.5 (`System.Core 3.5.0.0`,
 * `WindowsBase 3.0.0.0`), and `net20` if not. No reference assemblies of
 * .NET Framework 3.0 alone are published, so it is `net35`, which holds them.
 * .NET Framework 1.x, or a later CLR without the attribute, is not told.
 */
export function inferTargetFramework(
  runtimeVersion: string,
  references: readonly AssemblyIdentity[],
): { readonly moniker: string; readonly inferredFrom: string } | null {
  if (!/^v2\.0(\.|$)/.test(runtimeVersion)) {
    return null;
  }
  const v3 = references.find(
    ({ version, publicKeyToken }) =>
      publicKeyToken !== null &&
      NET_FRAMEWORK_PUBLIC_KEY_TOKENS.has(publicKeyToken.toLowerCase()) &&
      /^3\.[05]\./.test(version),
  );
  return v3 === undefined
    ? {
        moniker: "net20",
        inferredFrom: `CLR ${runtimeVersion}, and no reference to an assembly of .NET Framework 3.0 or 3.5`,
      }
    : {
        moniker: "net35",
        inferredFrom: `CLR ${runtimeVersion} and its reference to ${v3.name} ${v3.version}`,
      };
}

/** How far Xray supports reconstructing an Assembly for the framework of a moniker, or of none (FR-8). */
export function targetFrameworkSupport(
  moniker: string | null,
): TargetFrameworkSupport {
  if (moniker === null) {
    return "none";
  }
  const framework = /^net(4\d*)(-client)?$/i.exec(moniker);
  if (framework !== null) {
    return "full";
  }
  const core = /^net(?:coreapp)?(\d+)\.(\d+)/i.exec(moniker);
  if (core !== null) {
    const major = Number(core[1]);
    const minor = Number(core[2]);
    return major >= 5 || (major === 3 && minor === 1) ? "full" : "best-effort";
  }
  return "best-effort";
}

interface FrameworkName {
  readonly identifier: string;
  readonly version: readonly number[];
  readonly profile: string | undefined;
}

/** `Identifier,Version=v1.2[.3][,Profile=Name]`, as `System.Runtime.Versioning.FrameworkName` reads it. */
function parseFrameworkName(name: string): FrameworkName | undefined {
  const [identifier = "", ...parts] = name
    .split(",")
    .map((part) => part.trim());
  const pairs = new Map<string, string>();
  for (const part of parts) {
    const match = /^(\w+)=(.*)$/.exec(part);
    if (match === null) {
      return undefined;
    }
    pairs.set((match[1] as string).toLowerCase(), match[2] as string);
  }
  const version = /^v?(\d+(?:\.\d+){1,3})$/i.exec(pairs.get("version") ?? "");
  if (identifier === "" || version === null) {
    return undefined;
  }
  return {
    identifier,
    version: (version[1] as string).split(".").map(Number),
    profile: pairs.get("profile") || undefined,
  };
}

/** `Windows7.0` → `-windows7.0`. */
function platformSuffix(platform: string): string | undefined {
  const match = /^([A-Za-z]+)(\d+(?:\.\d+)*)?$/.exec(platform);
  return match === null
    ? undefined
    : `-${(match[1] as string).toLowerCase()}${match[2] ?? ""}`;
}

const MACHINES: Readonly<
  Record<
    string,
    { readonly platformTarget: PlatformTarget; readonly bitness: Bitness }
  >
> = {
  Amd64: { platformTarget: "x64", bitness: "64-bit" },
  Arm64: { platformTarget: "ARM64", bitness: "64-bit" },
  Arm: { platformTarget: "ARM", bitness: "32-bit" },
  ArmThumb2: { platformTarget: "ARM", bitness: "32-bit" },
  Thumb: { platformTarget: "ARM", bitness: "32-bit" },
  IA64: { platformTarget: "Itanium", bitness: "64-bit" },
};

/**
 * AnyCPU and x86 Assemblies are both marked I386; the CLI header's flags tell
 * them apart. AnyCPU is IL only and does not require 32-bit; "AnyCPU, 32-bit
 * preferred" sets both 32-bit flags; x86 requires 32-bit alone, or holds
 * machine code beside its IL.
 */
function architecture(inspection: EngineInspection): Architecture {
  const { machine, corFlags } = inspection;
  if (machine === "I386") {
    const anyCpu =
      corFlags.ilOnly && (!corFlags.requires32Bit || corFlags.prefers32Bit);
    return anyCpu
      ? {
          platformTarget: "AnyCPU",
          prefer32Bit: corFlags.requires32Bit,
          bitness: "any",
          machine,
        }
      : {
          platformTarget: "x86",
          prefer32Bit: false,
          bitness: "32-bit",
          machine,
        };
  }
  const known = MACHINES[machine];
  return known === undefined
    ? {
        platformTarget: null,
        prefer32Bit: false,
        bitness: inspection.pe32Plus ? "64-bit" : "32-bit",
        machine,
      }
    : { ...known, prefer32Bit: false, machine };
}

function outputKind(inspection: EngineInspection): OutputKind {
  if (inspection.entryPoint === null) {
    return "library";
  }
  if (inspection.subsystem !== "windows-gui") {
    return "console";
  }
  const references = new Set(
    inspection.references.map((reference) => reference.name.toLowerCase()),
  );
  if (references.has("presentationframework")) {
    return "wpf";
  }
  if (references.has("system.windows.forms")) {
    return "winforms";
  }
  return "windows";
}

/** Copied field by field, so nothing else the engine sends reaches the summary. */
function identity({
  name,
  version,
  culture,
  publicKeyToken,
}: AssemblyIdentity): AssemblyIdentity {
  return { name, version, culture, publicKeyToken };
}

function byName(a: AssemblyIdentity, b: AssemblyIdentity): number {
  return (
    compareOrdinal(a.name.toLowerCase(), b.name.toLowerCase()) ||
    compareOrdinal(a.name, b.name) ||
    compareOrdinal(a.version, b.version)
  );
}

/** Not `localeCompare`, whose order depends on the ICU data Node was built with. */
function compareOrdinal(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Narrows the engine's answer to `inspect` to an {@link EngineInspection}, or returns `undefined`. */
export function asEngineInspection(
  value: Record<string, unknown>,
): EngineInspection | undefined {
  const { assembly, references, corFlags, entryPoint } = value;
  return isIdentity(assembly) &&
    Array.isArray(references) &&
    references.every(isIdentity) &&
    isStringOrNull(value["targetFramework"]) &&
    isStringOrNull(value["targetPlatform"]) &&
    typeof value["runtimeVersion"] === "string" &&
    (value["informationalVersion"] === undefined ||
      isStringOrNull(value["informationalVersion"])) &&
    typeof value["machine"] === "string" &&
    typeof value["pe32Plus"] === "boolean" &&
    isRecord(corFlags) &&
    typeof corFlags["ilOnly"] === "boolean" &&
    typeof corFlags["requires32Bit"] === "boolean" &&
    typeof corFlags["prefers32Bit"] === "boolean" &&
    typeof value["subsystem"] === "string" &&
    (entryPoint === null ||
      (isRecord(entryPoint) &&
        typeof entryPoint["type"] === "string" &&
        typeof entryPoint["method"] === "string")) &&
    isCount(value["typeCount"]) &&
    isCount(value["methodCount"]) &&
    isCount(value["resourceCount"]) &&
    (value["pdb"] === undefined ||
      value["pdb"] === null ||
      isEnginePdbCheck(value["pdb"])) &&
    isEngineObfuscationEvidence(value["obfuscation"])
    ? (value as unknown as EngineInspection)
    : undefined;
}

function isEngineObfuscationEvidence(
  value: unknown,
): value is EngineObfuscationEvidence {
  if (!isRecord(value)) {
    return false;
  }
  const { attributes, names, strings } = value;
  return (
    isStrings(attributes) &&
    isRecord(names) &&
    isCount(names["count"]) &&
    isCount(names["unprintable"]) &&
    isCount(names["short"]) &&
    isStrings(names["unprintableExamples"]) &&
    isStrings(names["shortExamples"]) &&
    isRecord(strings) &&
    isCount(strings["literals"]) &&
    isCount(strings["decoderCalls"]) &&
    isStrings(strings["decoderTypes"])
  );
}

function isStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isEnginePdbCheck(value: unknown): value is EnginePdbCheck {
  return (
    isRecord(value) &&
    (value["format"] === null ||
      value["format"] === "portable" ||
      value["format"] === "windows") &&
    (value["mismatch"] === null ||
      value["mismatch"] === "unrecorded" ||
      value["mismatch"] === "other-build" ||
      value["mismatch"] === "unreadable")
  );
}

function isIdentity(value: unknown): value is AssemblyIdentity {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["version"] === "string" &&
    isStringOrNull(value["culture"]) &&
    isStringOrNull(value["publicKeyToken"])
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
