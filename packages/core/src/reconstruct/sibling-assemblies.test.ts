import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type {
  AssemblyIdentity,
  AssemblySummary,
} from "../inspect/assembly-summary.js";
import type { CheckFramework } from "./framework-assemblies.js";
import type {
  CopyBeside,
  FindPackage,
  PackageLookup,
} from "./nuget-packages.js";
import {
  findSiblingAssemblies,
  isMicrosoftAssembly,
  type InspectedAssembly,
} from "./sibling-assemblies.js";

/** A reference to the application's own assembly `name`, not strong-named. */
function own(name: string): AssemblyIdentity {
  return { name, version: "1.0.0.0", culture: null, publicKeyToken: null };
}

/** A reference to a third party's assembly `name`, strong-named with its vendor's key. */
function vendors(name: string): AssemblyIdentity {
  return { ...own(name), publicKeyToken: "51ca75d1f3633191" };
}

const runtime: AssemblyIdentity = {
  name: "System.Runtime",
  version: "8.0.0.0",
  culture: null,
  publicKeyToken: "b03f5f7f11d50a3a",
};

/** The Assembly `name` at `/app/<file>`, referencing `references`; strong-named if given its identity. */
function assembly(
  name: string,
  references: readonly AssemblyIdentity[] = [],
  file = `${name}.dll`,
  identity: AssemblyIdentity = own(name),
): InspectedAssembly {
  const summary: AssemblySummary = {
    path: `/app/${file}`,
    assembly: identity,
    targetFramework: {
      moniker: "net8.0",
      frameworkName: ".NETCoreApp,Version=v8.0",
      runtimeVersion: "v4.0.30319",
      inferredFrom: null,
      support: "full",
    },
    architecture: {
      platformTarget: "AnyCPU",
      prefer32Bit: false,
      bitness: "any",
      machine: "I386",
    },
    entryPoint: null,
    outputKind: "library",
    references: [runtime, ...references],
    counts: { types: 1, methods: 1, resources: 0 },
    pdb: { status: "none" },
    obfuscation: { status: "clean", indicators: [] },
  };
  return { path: summary.path, summary };
}

/** Finds the Assemblies given by name, ignoring case, recording each name it is asked for. */
function finder(...assemblies: InspectedAssembly[]) {
  const asked: string[] = [];
  return {
    asked,
    find: (name: string) => {
      asked.push(name);
      return Promise.resolve(
        assemblies.filter(
          ({ summary }) =>
            summary.assembly.name.toLowerCase() === name.toLowerCase(),
        ),
      );
    },
  };
}

/** The graph's references by name, for reading. */
function edges(graph: {
  readonly assemblies: readonly InspectedAssembly[];
  readonly references: readonly (readonly number[])[];
}): string[] {
  return graph.assemblies.flatMap(({ summary }, i) =>
    (graph.references[i] ?? []).map(
      (to) =>
        `${summary.assembly.name} -> ${graph.assemblies[to]?.summary.assembly.name}`,
    ),
  );
}

describe("findSiblingAssemblies", () => {
  it("finds the Sibling Assemblies the input references, and those they reference in turn, each once", async () => {
    const app = assembly("App", [own("Pricing"), own("Inventory")]);
    const pricing = assembly("Pricing", [own("Inventory")]);
    const inventory = assembly("Inventory", [own("Logging")]);
    const logging = assembly("Logging");
    const { find, asked } = finder(pricing, inventory, logging);
    const looked: string[] = [];

    const graph = await findSiblingAssemblies(app, find, (name) =>
      looked.push(name),
    );

    expect(graph.assemblies).toEqual([app, pricing, inventory, logging]);
    expect(edges(graph)).toEqual([
      "App -> Pricing",
      "App -> Inventory",
      "Pricing -> Inventory",
      "Inventory -> Logging",
    ]);
    expect(graph.problems).toEqual([]);
    // Microsoft's System.Runtime is never looked for.
    expect(asked).toEqual(["Pricing", "Inventory", "Logging"]);
    expect(looked).toEqual(asked);
  });

  it("finds none where nothing beside the input is referenced, or there is nothing beside it", async () => {
    const app = assembly("App", [own("Missing")]);
    const { find, asked } = finder(assembly("Unreferenced"));

    const graph = await findSiblingAssemblies(app, find);

    expect(graph).toEqual({
      assemblies: [app],
      references: [[]],
      problems: [],
      packageReferences: [[]],
      packages: [],
      binaries: [],
      binaryReferences: [[]],
      dependencies: [
        {
          reference: runtime,
          referencedBy: ["App"],
          resolution: "framework",
          package: null,
          assembly: null,
          binary: null,
          reason:
            "System.Runtime is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), so it is the framework's, or one of Microsoft's own packages, and is left to the target framework.",
        },
        {
          reference: own("Missing"),
          referencedBy: ["App"],
          resolution: "unresolved",
          package: null,
          assembly: null,
          binary: null,
          reason:
            "No Managed Assembly named Missing is beside the input to reconstruct or copy, so nothing satisfies it.",
        },
      ],
    });
    expect(asked).toEqual(["Missing"]);
  });

  it("never looks for an assembly Microsoft signed, even beside the input, as in a self-contained app", async () => {
    const references = [
      { ...own("mscorlib"), publicKeyToken: "b77a5c561934e089" },
      { ...own("System.Runtime"), publicKeyToken: "B03F5F7F11D50A3A" },
      { ...own("PresentationFramework"), publicKeyToken: "31bf3856ad364e35" },
      { ...own("netstandard"), publicKeyToken: "cc7b13ffcd2ddd51" },
      { ...own("System.Private.CoreLib"), publicKeyToken: "7cec85d7bea7798e" },
      {
        ...own("Microsoft.Extensions.Logging"),
        publicKeyToken: "adb9793829ddae60",
      },
    ];
    const { find, asked } = finder(
      ...references.map((reference) => assembly(reference.name)),
    );

    const graph = await findSiblingAssemblies(
      assembly("App", references),
      find,
    );

    expect(graph.assemblies).toHaveLength(1);
    expect(asked).toEqual([]);
    for (const reference of references) {
      expect(isMicrosoftAssembly(reference)).toBe(true);
    }
  });

  it("looks for an assembly signed by anyone else", () => {
    expect(
      isMicrosoftAssembly({
        ...own("Newtonsoft.Json"),
        publicKeyToken: "30ad4fe6b2a6aeed",
      }),
    ).toBe(false);
    expect(isMicrosoftAssembly(own("Inventory"))).toBe(false);
  });

  it("matches names ignoring case, as .NET does, so two references that differ only in case are one Sibling Assembly", async () => {
    const app = assembly("App", [own("inventory"), own("Pricing")]);
    const pricing = assembly("Pricing", [own("INVENTORY")]);
    const inventory = assembly("Inventory");
    const { find, asked } = finder(pricing, inventory);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.assemblies).toEqual([app, inventory, pricing]);
    expect(edges(graph)).toEqual([
      "App -> Inventory",
      "App -> Pricing",
      "Pricing -> Inventory",
    ]);
    expect(asked).toEqual(["inventory", "Pricing"]);
  });

  it("reports a cycle back to the input, leaving out the reference that closes it", async () => {
    const app = assembly("App", [own("Plugins")]);
    const plugins = assembly("Plugins", [own("App")]);
    const { find, asked } = finder(plugins);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.assemblies).toEqual([app, plugins]);
    expect(edges(graph)).toEqual(["App -> Plugins"]);
    expect(graph.problems).toEqual([
      {
        kind: "cyclic-reference",
        cycle: ["App", "Plugins", "App"],
        omitted: { from: "Plugins", to: "App" },
        message:
          "App references Plugins references App, a cycle projects cannot have. The reference from Plugins to App is left out, so Plugins does not build.",
      },
    ]);
    // The input is never looked for: it is already known.
    expect(asked).toEqual(["Plugins"]);
  });

  it("reports a cycle among Sibling Assemblies, and one of an Assembly that references itself, leaving the rest", async () => {
    const app = assembly("App", [own("A"), own("D")]);
    const a = assembly("A", [own("B")]);
    const b = assembly("B", [own("C")]);
    const c = assembly("C", [own("A"), own("D")]);
    const d = assembly("D", [own("D")]);
    const { find } = finder(a, b, c, d);

    const graph = await findSiblingAssemblies(app, find);

    expect(
      graph.assemblies.map(({ summary }) => summary.assembly.name),
    ).toEqual(["App", "A", "D", "B", "C"]);
    expect(edges(graph)).toEqual([
      "App -> A",
      "App -> D",
      "A -> B",
      "B -> C",
      "C -> D",
    ]);
    expect(graph.problems).toMatchObject([
      {
        kind: "cyclic-reference",
        cycle: ["A", "B", "C", "A"],
        omitted: { from: "C", to: "A" },
      },
      {
        kind: "cyclic-reference",
        cycle: ["D", "D"],
        omitted: { from: "D", to: "D" },
      },
    ]);
  });

  it("chooses the .dll, then the first by path, of the Assemblies a name could be, and reports the duplicate", async () => {
    const app = assembly("App", [own("Inventory")]);
    const exe = assembly("Inventory", [], "Inventory.exe");
    const dll = assembly("Inventory", [], "inventory.DLL");
    const { find } = finder(exe, dll);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.assemblies).toEqual([app, dll]);
    expect(graph.problems).toEqual([
      {
        kind: "duplicate-assembly-name",
        name: "Inventory",
        paths: ["/app/inventory.DLL", "/app/Inventory.exe"],
        chosen: "/app/inventory.DLL",
        message:
          "2 Assemblies beside the input are named Inventory: /app/inventory.DLL, /app/Inventory.exe. Only /app/inventory.DLL is reconstructed, as the runtime would load it.",
      },
    ]);
  });
});

describe("findSiblingAssemblies, resolving every reference", () => {
  /** How the graph's dependencies were resolved, by name, for reading. */
  function resolutions(graph: {
    readonly dependencies: readonly {
      readonly reference: AssemblyIdentity;
      readonly referencedBy: readonly string[];
      readonly resolution: string;
    }[];
  }): string[] {
    return graph.dependencies.map(
      ({ reference, referencedBy, resolution }) =>
        `${reference.name} ${resolution} (${referencedBy.join(", ")})`,
    );
  }

  it("records how each reference of each Assembly was satisfied, once by name, in the order met, with the Assemblies making it", async () => {
    const app = assembly("App", [
      own("Pricing"),
      vendors("Barcodes"),
      own("Ledger"),
    ]);
    const pricing = assembly("Pricing", [own("app"), vendors("BARCODES")]);
    const barcodes = assembly(
      "Barcodes",
      [own("Fonts")],
      undefined,
      vendors("Barcodes"),
    );
    const { find, asked } = finder(pricing, barcodes, assembly("Fonts"));

    const graph = await findSiblingAssemblies(app, find);

    expect(resolutions(graph)).toEqual([
      "System.Runtime framework (App, Pricing)",
      "Pricing sibling-assembly (App)",
      "Barcodes copied-binary (App, Pricing)",
      "Ledger unresolved (App)",
      "app sibling-assembly (Pricing)",
    ]);
    expect(graph.dependencies[1]).toMatchObject({ assembly: 1, binary: null });
    expect(graph.dependencies[2]).toMatchObject({ assembly: null, binary: 0 });
    // The input itself is the solution's first project.
    expect(graph.dependencies[4]).toMatchObject({
      assembly: 0,
      reason: "It is the input Assembly itself, /app/App.dll.",
    });
    expect(graph.assemblies).toEqual([app, pricing]);
    expect(graph.binaries).toEqual([barcodes]);
    expect(graph.binaryReferences).toEqual([[0], [0]]);
    // A copied binary's own references are not looked through.
    expect(asked).toEqual(["Pricing", "Barcodes", "Ledger"]);
  });

  it("copies an Assembly strong-named with another key than the input's, a third party's, rather than reconstruct it, saying why", async () => {
    const app = assembly("App", [vendors("Barcodes")]);
    const barcodes = assembly("Barcodes", [], undefined, vendors("Barcodes"));
    const { find } = finder(barcodes);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.assemblies).toEqual([app]);
    expect(graph.references).toEqual([[]]);
    expect(graph.binaries).toEqual([barcodes]);
    expect(graph.dependencies[1]).toEqual({
      reference: vendors("Barcodes"),
      referencedBy: ["App"],
      resolution: "copied-binary",
      package: null,
      assembly: null,
      binary: 0,
      reason:
        "/app/Barcodes.dll, beside the input, is strong-named with a key (public key token 51ca75d1f3633191), so it is a third party's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath.",
    });
  });

  it("takes an Assembly strong-named with the input's own key, ignoring case, for the application's own, a Sibling Assembly", async () => {
    const signed = (name: string) => ({
      ...own(name),
      publicKeyToken: "0123456789abcdef",
    });
    const app = assembly("App", [signed("Core")], undefined, signed("App"));
    const core = assembly("Core", [vendors("Barcodes")], undefined, {
      ...signed("Core"),
      publicKeyToken: "0123456789ABCDEF",
    });
    const barcodes = assembly("Barcodes", [], undefined, vendors("Barcodes"));
    const { find } = finder(core, barcodes);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.assemblies).toEqual([app, core]);
    expect(graph.binaries).toEqual([barcodes]);
    expect(graph.binaryReferences).toEqual([[], [0]]);
    expect(graph.dependencies[1]?.reason).toBe(
      "/app/Core.dll, beside the input, is the application's own, as it is strong-named with the input's own key, so it is a Sibling Assembly, reconstructed as a project of its own.",
    );
    expect(graph.dependencies[2]?.reason).toBe(
      "/app/Barcodes.dll, beside the input, is strong-named with another key than the input's (public key token 51ca75d1f3633191), so it is a third party's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath.",
    );
  });

  it("with siblings off, copies the application's own Assemblies beside the input instead of reconstructing them", async () => {
    const app = assembly("App", [own("Pricing"), own("Missing")]);
    const pricing = assembly("Pricing", [own("Inventory")]);
    const { find, asked } = finder(pricing, assembly("Inventory"));

    const graph = await findSiblingAssemblies(app, find, undefined, {
      siblings: false,
    });

    expect(graph.assemblies).toEqual([app]);
    expect(graph.binaries).toEqual([pricing]);
    expect(graph.binaryReferences).toEqual([[0]]);
    expect(resolutions(graph)).toEqual([
      "System.Runtime framework (App)",
      "Pricing copied-binary (App)",
      "Missing unresolved (App)",
    ]);
    expect(graph.dependencies[1]?.reason).toBe(
      "Sibling Assemblies are not reconstructed (--no-siblings), so /app/Pricing.dll, beside the input, is copied into the Recovered Solution's Dependencies folder, and referenced with a HintPath.",
    );
    expect(asked).toEqual(["Pricing", "Missing"]);
  });

  it("copies the .dll of two Assemblies of a name, and says it is copied", async () => {
    const app = assembly("App", [vendors("Barcodes")]);
    const exe = assembly("Barcodes", [], "Barcodes.exe", vendors("Barcodes"));
    const dll = assembly("Barcodes", [], "Barcodes.dll", vendors("Barcodes"));
    const { find } = finder(exe, dll);

    const graph = await findSiblingAssemblies(app, find);

    expect(graph.binaries).toEqual([dll]);
    expect(graph.problems).toMatchObject([
      {
        kind: "duplicate-assembly-name",
        chosen: "/app/Barcodes.dll",
        message:
          "2 Assemblies beside the input are named Barcodes: /app/Barcodes.dll, /app/Barcodes.exe. Only /app/Barcodes.dll is copied, as the runtime would load it.",
      },
    ]);
  });
});

describe("findSiblingAssemblies, looking references up as NuGet packages first", () => {
  const folders: string[] = [];
  afterEach(async () => {
    await Promise.all(
      folders.splice(0).map((folder) => rm(folder, { recursive: true })),
    );
  });

  const newtonsoft: AssemblyIdentity = {
    name: "Newtonsoft.Json",
    version: "13.0.0.0",
    culture: null,
    publicKeyToken: "30ad4fe6b2a6aeed",
  };

  /** `assembly` at a real file in `folder`, holding `contents`, as the copy beside the input is read. */
  async function besideIn(
    folder: string,
    inspected: InspectedAssembly,
    identity: AssemblyIdentity,
    contents: string,
  ): Promise<InspectedAssembly> {
    const path = join(folder, `${identity.name}.dll`);
    await writeFile(path, contents);
    return {
      path,
      summary: { ...inspected.summary, path, assembly: identity },
      informationalVersion: "13.0.3+0a2e291c",
    };
  }

  /** `inspected`, at a real file in `folder`, as the copy beside the input is read. */
  async function onDisk(
    folder: string,
    inspected: InspectedAssembly,
  ): Promise<InspectedAssembly> {
    const path = join(folder, `${inspected.summary.assembly.name}.dll`);
    await writeFile(path, inspected.summary.assembly.name);
    return { path, summary: { ...inspected.summary, path } };
  }

  /** Finds a package for each name in `held`, recording what it was asked. */
  function packages(held: Readonly<Record<string, string>>) {
    const asked: [AssemblyIdentity, CopyBeside | null][] = [];
    const findPackage: FindPackage = (reference, copy) => {
      asked.push([reference, copy]);
      const version = held[reference.name];
      const lookup: PackageLookup = {
        reference,
        package:
          version === undefined
            ? null
            : {
                id: reference.name,
                version,
                source: "global-packages",
                file: `lib/net6.0/${reference.name}.dll`,
                matchesCopyBeside: false,
              },
        candidates: [],
        searched: ["global-packages"],
        reason: version === undefined ? "none" : "found",
      };
      return Promise.resolve(lookup);
    };
    return { asked, findPackage };
  }

  it("references a package for an assembly a package holds, even one beside the input, rather than make it a Sibling Assembly, and gives it the copy beside it", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-siblings-"));
    folders.push(folder);
    const app = assembly("App", [newtonsoft, own("Pricing")]);
    const pricing = await onDisk(
      folder,
      assembly("Pricing", [newtonsoft, own("Missing")]),
    );
    const copy = await besideIn(folder, assembly("x"), newtonsoft, "the copy");
    const { find, asked: lookedFor } = finder(pricing, copy);
    const { findPackage, asked } = packages({ "Newtonsoft.Json": "13.0.3" });

    const graph = await findSiblingAssemblies(app, find, undefined, {
      findPackage,
    });

    expect(graph.assemblies).toEqual([app, pricing]);
    expect(edges(graph)).toEqual(["App -> Pricing"]);
    expect(graph.packageReferences).toEqual([
      [{ id: "Newtonsoft.Json", version: "13.0.3" }],
      [{ id: "Newtonsoft.Json", version: "13.0.3" }],
    ]);
    // Each name is looked up once, whichever Assembly references it.
    expect(lookedFor).toEqual(["Newtonsoft.Json", "Pricing", "Missing"]);
    expect(asked).toEqual([
      [
        newtonsoft,
        {
          path: copy.path,
          sha256: createHash("sha256").update("the copy").digest("hex"),
          informationalVersion: "13.0.3+0a2e291c",
        },
      ],
      [
        own("Pricing"),
        {
          path: pricing.path,
          sha256: createHash("sha256").update("Pricing").digest("hex"),
          informationalVersion: null,
        },
      ],
      [own("Missing"), null],
    ]);
    expect(graph.packages).toMatchObject([
      {
        reference: newtonsoft,
        referencedBy: ["App", "Pricing"],
        package: { id: "Newtonsoft.Json", version: "13.0.3" },
      },
      { reference: own("Pricing"), referencedBy: [], package: null },
      { reference: own("Missing"), referencedBy: [], package: null },
    ]);
    expect(graph.dependencies).toMatchObject([
      { reference: runtime, resolution: "framework" },
      {
        reference: newtonsoft,
        referencedBy: ["App", "Pricing"],
        resolution: "nuget-package",
        package: { id: "Newtonsoft.Json", version: "13.0.3" },
        reason: "found",
      },
      {
        reference: own("Pricing"),
        resolution: "sibling-assembly",
        assembly: 1,
        reason: `No NuGet package was found to hold it. ${pricing.path}, beside the input, is the application's own, as it is not strong-named, so it is a Sibling Assembly, reconstructed as a project of its own.`,
      },
      {
        reference: own("Missing"),
        referencedBy: ["Pricing"],
        resolution: "unresolved",
        // Why no package holds it, then why nothing else does.
        reason:
          "none No Managed Assembly named Missing is beside the input to reconstruct or copy, so nothing satisfies it.",
      },
    ]);
  });

  it("gives no copy beside the input of another version of the assembly referenced", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-siblings-"));
    folders.push(folder);
    const app = assembly("App", [newtonsoft]);
    const other = await besideIn(
      folder,
      assembly("x"),
      { ...newtonsoft, version: "12.0.0.0" },
      "another",
    );
    const { find } = finder(other);
    const { findPackage, asked } = packages({});

    const graph = await findSiblingAssemblies(app, find, undefined, {
      findPackage,
    });

    expect(asked).toEqual([[newtonsoft, null]]);
    // No package holds it, and the copy beside it is strong-named with
    // another key than the input's, so it is copied.
    expect(graph.assemblies).toEqual([app]);
    expect(graph.binaries).toEqual([other]);
    expect(graph.packageReferences).toEqual([[]]);
    expect(graph.dependencies[1]).toMatchObject({
      resolution: "copied-binary",
      reason: expect.stringMatching(
        /^No NuGet package was found to hold it\. .* is copied, not reconstructed, /,
      ) as unknown,
    });
  });

  it("with siblings off, looks only the input's references up, as packages, then as binaries to copy", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-siblings-"));
    folders.push(folder);
    const app = assembly("App", [newtonsoft, own("Pricing")]);
    const pricing = await onDisk(folder, assembly("Pricing", [own("Logging")]));
    const { find } = finder(pricing);
    const { findPackage, asked } = packages({ "Newtonsoft.Json": "13.0.3" });

    const graph = await findSiblingAssemblies(app, find, undefined, {
      findPackage,
      siblings: false,
    });

    expect(graph.assemblies).toEqual([app]);
    expect(graph.references).toEqual([[]]);
    expect(graph.packageReferences).toEqual([
      [{ id: "Newtonsoft.Json", version: "13.0.3" }],
    ]);
    expect(graph.binaries).toEqual([pricing]);
    expect(asked.map(([reference]) => reference.name)).toEqual([
      "Newtonsoft.Json",
      "Pricing",
    ]);
  });

  it("without a framework check, never looks an assembly Microsoft signed up as a package", async () => {
    const app = assembly("App", [newtonsoft]);
    const { findPackage, asked } = packages({});

    await findSiblingAssemblies(app, finder().find, undefined, { findPackage });

    expect(asked.map(([reference]) => reference.name)).toEqual([
      "Newtonsoft.Json",
    ]);
  });
});

describe("findSiblingAssemblies, telling the framework's assemblies from Microsoft's packages", () => {
  const folders: string[] = [];
  afterEach(async () => {
    await Promise.all(
      folders.splice(0).map((folder) => rm(folder, { recursive: true })),
    );
  });

  const commandLine: AssemblyIdentity = {
    name: "System.CommandLine",
    version: "2.0.5.0",
    culture: null,
    publicKeyToken: "31bf3856ad364e35",
  };
  const immutable: AssemblyIdentity = {
    name: "System.Collections.Immutable",
    version: "9.0.0.0",
    culture: null,
    publicKeyToken: "b03f5f7f11d50a3a",
  };

  /**
   * A framework that provides `System.Runtime` and nothing else, and cannot
   * tell for `net6.0`, recording what it is asked.
   */
  function net8() {
    const asked: string[] = [];
    const checkFramework: CheckFramework = (summary, reference) => {
      asked.push(
        `${summary.assembly.name} (${summary.targetFramework.moniker ?? ""}): ${reference.name}`,
      );
      return Promise.resolve(
        summary.targetFramework.moniker === "net6.0"
          ? { provided: null, reason: "net6.0's are nowhere" }
          : reference.name === "System.Runtime"
            ? {
                provided: true,
                reason: "the pack holds System.Runtime 8.0.0.0",
              }
            : {
                provided: false,
                reason: `the pack holds no assembly named ${reference.name}`,
              },
      );
    };
    return { asked, checkFramework };
  }

  /** Finds a package for each of `held`, by name, recording each name asked for. */
  function packages(held: readonly string[]) {
    const asked: string[] = [];
    const findPackage: FindPackage = (reference) => {
      asked.push(reference.name);
      const found = held.includes(reference.name);
      return Promise.resolve({
        reference,
        package: found
          ? {
              id: reference.name,
              version: "2.0.5",
              source: "nuget.org",
              file: `lib/net8.0/${reference.name}.dll`,
              matchesCopyBeside: true,
            }
          : null,
        candidates: [],
        searched: ["global-packages", "nuget.org"],
        reason: found ? "Found on nuget.org." : "No package holds it.",
      });
    };
    return { asked, findPackage };
  }

  it("leaves a reference the target framework provides to it, looking it up nowhere, and says why", async () => {
    const app = assembly("App");
    const { find, asked: lookedFor } = finder(assembly("System.Runtime"));
    const { findPackage, asked } = packages(["System.Runtime"]);
    const framework = net8();
    const looked: string[] = [];

    const graph = await findSiblingAssemblies(
      app,
      find,
      (name) => looked.push(name),
      { findPackage, checkFramework: framework.checkFramework },
    );

    expect(graph.dependencies).toEqual([
      {
        reference: runtime,
        referencedBy: ["App"],
        resolution: "framework",
        package: null,
        assembly: null,
        binary: null,
        reason:
          "System.Runtime 8.0.0.0 is signed with one of Microsoft's keys (public key token b03f5f7f11d50a3a), and net8.0, the target framework of App, provides it: the pack holds System.Runtime 8.0.0.0. It is left to the target framework.",
      },
    ]);
    expect(framework.asked).toEqual(["App (net8.0): System.Runtime"]);
    expect([lookedFor, asked, looked]).toEqual([[], [], []]);
    expect(graph.packages).toEqual([]);
  });

  it("looks a reference to one of Microsoft's assemblies the target framework does not provide up as a NuGet package, as any other", async () => {
    const app = assembly("App", [commandLine, immutable]);
    const { find } = finder();
    const { findPackage, asked } = packages([
      "System.CommandLine",
      "System.Collections.Immutable",
    ]);
    const looked: string[] = [];

    const graph = await findSiblingAssemblies(
      app,
      find,
      (name) => looked.push(name),
      { findPackage, checkFramework: net8().checkFramework },
    );

    expect(asked).toEqual([
      "System.CommandLine",
      "System.Collections.Immutable",
    ]);
    expect(looked).toEqual(asked);
    expect(graph.packageReferences).toEqual([
      [
        { id: "System.CommandLine", version: "2.0.5" },
        { id: "System.Collections.Immutable", version: "2.0.5" },
      ],
    ]);
    expect(graph.dependencies).toMatchObject([
      { reference: runtime, resolution: "framework" },
      {
        reference: commandLine,
        resolution: "nuget-package",
        package: { id: "System.CommandLine", version: "2.0.5" },
        reason:
          "System.CommandLine 2.0.5.0 is signed with one of Microsoft's keys (public key token 31bf3856ad364e35), but net8.0, the target framework of App, does not provide it: the pack holds no assembly named System.CommandLine. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly. Found on nuget.org.",
      },
      {
        reference: immutable,
        resolution: "nuget-package",
        package: { id: "System.Collections.Immutable" },
      },
    ]);
  });

  it("copies one no package holds rather than reconstruct it, even strong-named with the input's own key, or makes it unresolved", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-siblings-"));
    folders.push(folder);
    // A tool of Microsoft's own, signed with the key it signs its packages with.
    const app = assembly("Tool", [commandLine, immutable], "Tool.dll", {
      ...own("Tool"),
      publicKeyToken: "31bf3856ad364e35",
    });
    const beside = assembly(
      "System.CommandLine",
      [],
      "System.CommandLine.dll",
      commandLine,
    );
    const copy = {
      ...beside,
      path: join(folder, "System.CommandLine.dll"),
      summary: {
        ...beside.summary,
        path: join(folder, "System.CommandLine.dll"),
      },
    };
    await writeFile(copy.path, "System.CommandLine");
    const { find } = finder(copy);
    const { findPackage } = packages([]);

    const graph = await findSiblingAssemblies(app, find, undefined, {
      findPackage,
      checkFramework: net8().checkFramework,
    });

    expect(graph.assemblies).toEqual([app]);
    expect(graph.binaries).toEqual([copy]);
    expect(graph.dependencies).toMatchObject([
      { reference: runtime, resolution: "framework" },
      {
        reference: commandLine,
        resolution: "copied-binary",
        binary: 0,
        reason: `System.CommandLine 2.0.5.0 is signed with one of Microsoft's keys (public key token 31bf3856ad364e35), but net8.0, the target framework of Tool, does not provide it: the pack holds no assembly named System.CommandLine. So it is one of Microsoft's packages, looked up as any other, though never reconstructed as a Sibling Assembly. No NuGet package was found to hold it. ${copy.path}, beside the input, is Microsoft's, not the application's own: it is copied, not reconstructed, into the Recovered Solution's Dependencies folder, and referenced with a HintPath.`,
      },
      {
        reference: immutable,
        resolution: "unresolved",
        reason: expect.stringMatching(
          /does not provide it: the pack holds no assembly named System\.Collections\.Immutable\. .* No package holds it\. No Managed Assembly named System\.Collections\.Immutable is beside the input/,
        ) as unknown,
      },
    ]);
  });

  it("asks of the target framework of the Assembly making the reference, and leaves it to it where that cannot tell", async () => {
    const folder = await mkdtemp(join(tmpdir(), "xray-siblings-"));
    folders.push(folder);
    const app = assembly("App", [own("Legacy")]);
    const legacy = assembly("Legacy", [commandLine]);
    const path = join(folder, "Legacy.dll");
    await writeFile(path, "Legacy");
    const old = {
      path,
      summary: {
        ...legacy.summary,
        path,
        targetFramework: {
          ...legacy.summary.targetFramework,
          moniker: "net6.0",
        },
      },
    };
    const { find } = finder(old);
    const { findPackage, asked } = packages(["System.CommandLine"]);
    const framework = net8();

    const graph = await findSiblingAssemblies(app, find, undefined, {
      findPackage,
      checkFramework: framework.checkFramework,
    });

    expect(framework.asked).toEqual([
      "App (net8.0): System.Runtime",
      "Legacy (net6.0): System.CommandLine",
    ]);
    expect(asked).toEqual(["Legacy"]);
    expect(graph.dependencies[2]).toEqual({
      reference: commandLine,
      referencedBy: ["Legacy"],
      resolution: "framework",
      package: null,
      assembly: null,
      binary: null,
      reason:
        "System.CommandLine 2.0.5.0 is signed with one of Microsoft's keys (public key token 31bf3856ad364e35), so it is taken to be the framework's, and left to the target framework, as Xray could not tell whether net6.0, the target framework of Legacy, provides it: net6.0's are nowhere.",
    });
  });
});
