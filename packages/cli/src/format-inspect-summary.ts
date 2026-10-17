import type {
  Architecture,
  AssemblyIdentity,
  AssemblySummary,
  ObfuscationCheck,
  OutputKind,
  PdbCheck,
  PdbFormat,
  TargetFramework,
} from "@xray/core";

const OUTPUT_KINDS: Readonly<Record<OutputKind, string>> = {
  console: "Console",
  winforms: "WinForms",
  wpf: "WPF",
  windows: "Windows GUI, neither WinForms nor WPF",
  library: "Library",
};

const PDB_FORMATS: Readonly<Record<PdbFormat, string>> = {
  portable: "portable",
  windows: "Windows",
};

/**
 * Whether there is a PDB beside the Assembly, and whether it is the
 * Assembly's own, which a Reconstruction uses: `none beside it`, or the PDB
 * and its format, then whether it would be used, and why not.
 */
export function formatPdbCheck(pdb: PdbCheck): string {
  switch (pdb.status) {
    case "none":
      return "none beside it";
    case "matching":
      return `${pdb.path} (${PDB_FORMATS[pdb.format]}), its own: used for local names and source layout`;
    default:
      return `${pdb.path}${pdb.format === null ? "" : ` (${PDB_FORMATS[pdb.format]})`}, ignored: ${pdb.reason}`;
  }
}

/**
 * Whether the Assembly shows signs of obfuscation: `clean`, with none found, or that it is
 * likely obfuscated, and so would be reconstructed as it is, then each sign
 * found, a line each.
 */
export function formatObfuscationCheck(
  obfuscation: ObfuscationCheck,
): string[] {
  return obfuscation.status === "clean"
    ? ["clean: no sign of it found"]
    : [
        "likely obfuscated, so reconstructed as it is, not deobfuscated:",
        ...obfuscation.indicators.map(({ message }) => message),
      ];
}

/**
 * One line per field of the summary, its label padded so the values line up;
 * a field with several values (the signs of obfuscation, the references)
 * continues on lines of its own.
 */
export function formatInspectSummary(summary: AssemblySummary): string {
  const rows: [string, string[]][] = [
    ["File", [summary.path]],
    ["Assembly", [displayName(summary.assembly)]],
    ["Target framework", [targetFramework(summary.targetFramework)]],
    ["Architecture", [architecture(summary.architecture)]],
    [
      "Entry point",
      [
        summary.entryPoint === null
          ? "none"
          : `${summary.entryPoint.type}.${summary.entryPoint.method}`,
      ],
    ],
    ["Output kind", [OUTPUT_KINDS[summary.outputKind]]],
    ["Types", [String(summary.counts.types)]],
    ["Methods", [String(summary.counts.methods)]],
    ["Resources", [String(summary.counts.resources)]],
    ["PDB", [formatPdbCheck(summary.pdb)]],
    ["Obfuscation", formatObfuscationCheck(summary.obfuscation)],
    [
      "References",
      summary.references.length === 0
        ? ["none"]
        : summary.references.map(displayName),
    ],
  ];

  const width = Math.max(...rows.map(([label]) => label.length));
  const indent = " ".repeat(width + 2);
  const lines = rows.flatMap(([label, [first = "", ...rest]]) => [
    `${label.padEnd(width)}  ${first}`,
    ...rest.map((value) => `${indent}${value}`),
  ]);
  return `${lines.join("\n")}\n`;
}

/** As .NET writes an assembly's name: `Name, Version=…, Culture=…, PublicKeyToken=…`. */
function displayName(identity: AssemblyIdentity): string {
  return `${identity.name}, Version=${identity.version}, Culture=${identity.culture ?? "neutral"}, PublicKeyToken=${identity.publicKeyToken ?? "null"}`;
}

function targetFramework(framework: TargetFramework): string {
  const { moniker, frameworkName, runtimeVersion, inferredFrom, support } =
    framework;
  const supported =
    support === "best-effort" ? ", supported on a best-effort basis" : "";
  if (moniker === null) {
    return (
      frameworkName ??
      `unknown (no TargetFrameworkAttribute; CLR ${runtimeVersion})`
    );
  }
  if (frameworkName === null) {
    return `${moniker} (no TargetFrameworkAttribute; told from ${inferredFrom ?? `CLR ${runtimeVersion}`})${supported}`;
  }
  return `${moniker} (${frameworkName})${supported}`;
}

function architecture(architecture: Architecture): string {
  const { platformTarget, prefer32Bit, bitness, machine } = architecture;
  if (platformTarget === null) {
    return `unknown (${bitness}, PE machine type ${machine})`;
  }
  if (platformTarget !== "AnyCPU") {
    return `${platformTarget} (${bitness})`;
  }
  return prefer32Bit
    ? "AnyCPU, 32-bit preferred (runs as 32-bit wherever the OS can)"
    : "AnyCPU (runs as 64-bit on a 64-bit OS, otherwise 32-bit)";
}
