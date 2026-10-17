import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  inferTargetFramework,
  targetFrameworkMoniker,
  targetFrameworkSupport,
} from "../inspect/assembly-summary.js";
import { projectFile } from "./recovered-solution.js";

// Holds what the `xray reconstruct` reference says about target frameworks to
// the monikers Xray picks and the project it writes for them.

const REFERENCE = fileURLToPath(
  new URL("../../../../docs/reference/xray-reconstruct.md", import.meta.url),
);

let section: string;
let bestEffort: string;
beforeAll(async () => {
  const reference = await readFile(REFERENCE, "utf8");
  bestEffort = reference.slice(
    reference.indexOf("## Target frameworks supported on a best-effort basis"),
    reference.indexOf("## Build diagnostics"),
  );
  section = reference.slice(
    reference.indexOf("## The Recovered Solution"),
    reference.indexOf("## Build diagnostics"),
  );
});

/** The rows of the table of target frameworks below its header, as each cell's `code` spans. */
function rows(): [string[], string[]][] {
  const start = section.indexOf(
    "  | The original's `TargetFrameworkAttribute`",
  );
  const table = section.slice(start, section.indexOf("\n\n", start));
  return [...table.matchAll(/^ {2}\| (.+) \| (.+) \|$/gm)]
    .slice(1)
    .map((match) => [codeIn(match[1] as string), codeIn(match[2] as string)]);
}

function codeIn(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1] as string);
}

describe("the xray reconstruct reference", () => {
  it("gives each target framework the moniker Xray keeps", () => {
    const [netFramework, ...others] = rows();

    // `v4.0` … `v4.8.1`: every 4.x release, in order.
    const versions = [
      "4.0",
      "4.5",
      "4.5.1",
      "4.5.2",
      "4.6",
      "4.6.1",
      "4.6.2",
      "4.7",
      "4.7.1",
      "4.7.2",
      "4.8",
      "4.8.1",
    ];
    expect(netFramework?.[1]).toEqual(
      versions.map((version) =>
        targetFrameworkMoniker(`.NETFramework,Version=v${version}`, null),
      ),
    );
    // The Client Profile, .NET Core 3.1 and .NET 8: the first of each cell.
    expect(others.map(([names]) => names[0])).toEqual([
      ".NETFramework,Version=v4.0,Profile=Client",
      ".NETCoreApp,Version=v3.1",
      ".NETCoreApp,Version=v8.0",
    ]);
    for (const [[name = ""], [moniker]] of others) {
      expect(targetFrameworkMoniker(name, null)).toBe(moniker);
    }
    expect(others.at(-1)?.[1][1]).toBe(
      targetFrameworkMoniker(".NETCoreApp,Version=v6.0", "Windows7.0"),
    );
  });

  it("shows the reference a .NET Framework project gets, and only such a project", () => {
    // Indented as in the project, inside the list item; the fence's own indent dropped.
    const xml = /```xml\n([\s\S]*?)\n *```/.exec(section)?.[1] ?? "";
    const snippet = `${xml}\n`;

    expect(snippet).toContain("Microsoft.NETFramework.ReferenceAssemblies");
    const shop = {
      assemblyName: "Shop",
      rootNamespace: "Shop",
      outputType: "Exe",
      allowUnsafeBlocks: false,
      nullable: null,
    } as const;
    expect(projectFile({ ...shop, targetFramework: "net48" })).toContain(
      snippet,
    );
    expect(
      projectFile({ ...shop, targetFramework: "netcoreapp3.1" }),
    ).not.toContain("<ItemGroup>");
  });

  it("gives each target framework supported on a best-effort basis the moniker Xray tells, and calls it best effort", () => {
    const start = bestEffort.indexOf("| The original |");
    const table = bestEffort.slice(start, bestEffort.indexOf("\n\n", start));
    const [net35, net20, netStandard, other] = [
      ...table.matchAll(/^\| (.+) \| (.+) \|$/gm),
    ]
      .slice(1)
      .map((match): [string[], string[]] => [
        codeIn(match[1] as string),
        codeIn(match[2] as string),
      ]);
    const mscorlib = {
      name: "mscorlib",
      version: "2.0.0.0",
      culture: null,
      publicKeyToken: "b77a5c561934e089",
    };

    // No TargetFrameworkAttribute; the CLR, then each reference named.
    const [, runtime, ...named] = net35?.[0] ?? [];
    expect(named).toEqual(["System.Core 3.5.0.0", "WindowsBase 3.0.0.0"]);
    for (const reference of named) {
      const [name = "", version = ""] = reference.split(" ");
      expect(
        inferTargetFramework(runtime as string, [
          mscorlib,
          {
            name,
            version,
            culture: null,
            publicKeyToken:
              name === "WindowsBase" ? "31bf3856ad364e35" : "b77a5c561934e089",
          },
        ])?.moniker,
      ).toBe(net35?.[1][0]);
    }
    expect(
      inferTargetFramework(net20?.[0][1] as string, [mscorlib])?.moniker,
    ).toBe(net20?.[1][0]);
    for (const [[name = ""], [moniker]] of [netStandard, other].filter(
      (row) => row !== undefined,
    )) {
      expect(targetFrameworkMoniker(name, null)).toBe(moniker);
    }
    const monikers = [net35, net20, netStandard, other].map(
      (row) => row?.[1][0],
    );
    expect(monikers).toEqual([
      "net35",
      "net20",
      "netstandard2.0",
      "netcoreapp2.1",
    ]);
    for (const moniker of monikers) {
      expect(targetFrameworkSupport(moniker ?? null)).toBe("best-effort");
    }
  });
});
