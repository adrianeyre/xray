import { describe, expect, it } from "vitest";

import {
  targetFrameworkMoniker,
  type AssemblySummary,
} from "../inspect/assembly-summary.js";
import type { ManifestResource } from "./recovered-resources.js";
import {
  forWindows,
  isNetFramework,
  NET_FRAMEWORK_REFERENCE_ASSEMBLIES,
  planRecoveredSolution,
  planSolution,
  projectFile,
  recordedSourcePaths,
  recoverRootNamespace,
  safeSegment,
  solutionFile,
  SourceLayout,
  SYSTEM_RESOURCES_EXTENSIONS,
  usesWindowsForms,
  usesWpf,
  type DecompiledAssembly,
  type DecompiledType,
  type DeclaredType,
  type ProjectProperties,
} from "./recovered-solution.js";
import { ReconstructionError } from "./reconstruction-error.js";

const summary: AssemblySummary = {
  path: "/abs/Shop.dll",
  assembly: {
    name: "Shop",
    version: "1.0.0.0",
    culture: null,
    publicKeyToken: null,
  },
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
  entryPoint: { type: "Shop.Program", method: "Main" },
  outputKind: "console",
  references: [],
  counts: { types: 2, methods: 2, resources: 0 },
  pdb: { status: "none" },
  obfuscation: { status: "clean", indicators: [] },
};

function type(
  namespace: string,
  name: string,
  sourceFile: string | null = null,
  sourcePath: string | null = null,
  declares: readonly DeclaredType[] = [{ namespace, name }],
): DecompiledType {
  return {
    namespace,
    name,
    code: `// ${namespace}.${name}\n`,
    sourceFile,
    sourcePath,
    declares,
  };
}

/** An Assembly with no types, no unsafe code and no nullable annotations. */
const nothing: DecompiledAssembly = {
  assemblyAttributes: "",
  unsafeCode: false,
  nullableAnnotations: false,
  types: [],
};

/** The project of a .NET 8 console program, Shop, with nothing more to it. */
const shop: ProjectProperties = {
  assemblyName: "Shop",
  rootNamespace: "Shop",
  targetFramework: "net8.0",
  outputType: "Exe",
  allowUnsafeBlocks: false,
  nullable: null,
};

describe("planRecoveredSolution", () => {
  it("lays out <Name>.sln, <Name>/<Name>.csproj, the assembly attributes and a file per type", () => {
    const plan = planRecoveredSolution(summary, {
      ...nothing,
      assemblyAttributes: '[assembly: AssemblyVersion("1.0.0.0")]\n',
      types: [type("Shop", "Program"), type("Shop.Orders", "Order")],
    });

    expect(plan).toMatchObject({
      name: "Shop",
      solutionPath: "Shop.sln",
      projectPath: "Shop/Shop.csproj",
      project: shop,
    });
    expect(plan.files).toEqual([
      {
        path: "Shop.sln",
        contents: solutionFile([
          { name: "Shop", projectPath: "Shop/Shop.csproj" },
        ]),
      },
      { path: "Shop/Shop.csproj", contents: projectFile(shop) },
      {
        path: "Shop/Properties/AssemblyInfo.cs",
        contents: '[assembly: AssemblyVersion("1.0.0.0")]\n',
      },
      { path: "Shop/Program.cs", contents: "// Shop.Program\n" },
      { path: "Shop/Orders/Order.cs", contents: "// Shop.Orders.Order\n" },
    ]);
  });

  it.each([
    ["console", "Exe"],
    ["library", "Library"],
    ["winforms", "WinExe"],
    ["wpf", "WinExe"],
    ["windows", "WinExe"],
  ] as const)(
    "gives a %s Assembly the output type %s",
    (outputKind, outputType) => {
      const plan = planRecoveredSolution({ ...summary, outputKind }, nothing);

      expect(plan.project.outputType).toBe(outputType);
      expect(plan.files[1]?.contents).toContain(
        `<OutputType>${outputType}</OutputType>`,
      );
    },
  );

  it("keeps the original's target framework", () => {
    const plan = planRecoveredSolution(
      {
        ...summary,
        targetFramework: {
          moniker: "net6.0-windows7.0",
          frameworkName: ".NETCoreApp,Version=v6.0",
          runtimeVersion: "v4.0.30319",
          inferredFrom: null,
          support: "full",
        },
      },
      nothing,
    );

    expect(plan.project.targetFramework).toBe("net6.0-windows7.0");
    expect(plan.files[1]?.contents).toContain(
      "<TargetFramework>net6.0-windows7.0</TargetFramework>",
    );
  });

  it.each([
    [".NETFramework,Version=v4.0", "net40"],
    [".NETFramework,Version=v4.0,Profile=Client", "net40-client"],
    [".NETFramework,Version=v4.5", "net45"],
    [".NETFramework,Version=v4.5.1", "net451"],
    [".NETFramework,Version=v4.5.2", "net452"],
    [".NETFramework,Version=v4.6", "net46"],
    [".NETFramework,Version=v4.6.1", "net461"],
    [".NETFramework,Version=v4.6.2", "net462"],
    [".NETFramework,Version=v4.7", "net47"],
    [".NETFramework,Version=v4.7.1", "net471"],
    [".NETFramework,Version=v4.7.2", "net472"],
    [".NETFramework,Version=v4.8", "net48"],
    [".NETFramework,Version=v4.8.1", "net481"],
  ])(
    "keeps %s as %s, referencing the framework's reference assemblies",
    (frameworkName, moniker) => {
      const plan = planRecoveredSolution(
        {
          ...summary,
          targetFramework: {
            moniker: targetFrameworkMoniker(frameworkName, null),
            frameworkName,
            runtimeVersion: "v4.0.30319",
            inferredFrom: null,
            support: "full",
          },
        },
        nothing,
      );

      expect(plan.project.targetFramework).toBe(moniker);
      expect(plan.files[1]).toEqual({
        path: "Shop/Shop.csproj",
        contents: projectFile({ ...shop, targetFramework: moniker }),
      });
      expect(plan.files[1]?.contents).toContain(
        `<TargetFramework>${moniker}</TargetFramework>`,
      );
      expect(plan.files[1]?.contents).toContain(
        '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies"',
      );
    },
  );

  it.each([["net20"], ["net35"]])(
    "keeps an Assembly with no TargetFrameworkAttribute as %s, as its CLR and references tell it, referencing the framework's reference assemblies",
    (moniker) => {
      const plan = planRecoveredSolution(
        {
          ...summary,
          targetFramework: {
            moniker,
            frameworkName: null,
            runtimeVersion: "v2.0.50727",
            inferredFrom: "CLR v2.0.50727",
            support: "best-effort",
          },
        },
        nothing,
      );

      expect(plan.project.targetFramework).toBe(moniker);
      expect(plan.files[1]).toEqual({
        path: "Shop/Shop.csproj",
        contents: projectFile({ ...shop, targetFramework: moniker }),
      });
      expect(plan.files[1]?.contents).toContain(
        '<PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies"',
      );
    },
  );

  it("keeps .NET Standard 2.0 as netstandard2.0, which needs no package to build", () => {
    const frameworkName = ".NETStandard,Version=v2.0";
    const plan = planRecoveredSolution(
      {
        ...summary,
        targetFramework: {
          moniker: targetFrameworkMoniker(frameworkName, null),
          frameworkName,
          runtimeVersion: "v4.0.30319",
          inferredFrom: null,
          support: "best-effort",
        },
      },
      nothing,
    );

    expect(plan.project.targetFramework).toBe("netstandard2.0");
    expect(plan.files[1]?.contents).not.toContain("PackageReference");
  });

  it("keeps .NET Core 3.1 as netcoreapp3.1, which needs no package to build", () => {
    const frameworkName = ".NETCoreApp,Version=v3.1";
    const plan = planRecoveredSolution(
      {
        ...summary,
        targetFramework: {
          moniker: targetFrameworkMoniker(frameworkName, null),
          frameworkName,
          runtimeVersion: "v4.0.30319",
          inferredFrom: null,
          support: "full",
        },
      },
      nothing,
    );

    expect(plan.project.targetFramework).toBe("netcoreapp3.1");
    expect(plan.files[1]?.contents).toContain(
      "<TargetFramework>netcoreapp3.1</TargetFramework>",
    );
    expect(plan.files[1]?.contents).not.toContain("PackageReference");
  });

  it("allows unsafe code, and gives a nullable annotations context, only where the original had them", () => {
    const plain = planRecoveredSolution(summary, nothing);
    const unsafe = planRecoveredSolution(summary, {
      ...nothing,
      unsafeCode: true,
    });
    const annotated = planRecoveredSolution(summary, {
      ...nothing,
      nullableAnnotations: true,
    });

    expect(plain.project).toMatchObject({
      allowUnsafeBlocks: false,
      nullable: null,
    });
    expect(unsafe.project).toMatchObject({
      allowUnsafeBlocks: true,
      nullable: null,
    });
    expect(annotated.project).toMatchObject({
      allowUnsafeBlocks: false,
      nullable: "annotations",
    });
    expect(unsafe.files[1]?.contents).toBe(
      projectFile({ ...shop, allowUnsafeBlocks: true }),
    );
    expect(annotated.files[1]?.contents).toBe(
      projectFile({ ...shop, nullable: "annotations" }),
    );
  });

  it("recovers the root namespace from the types' namespaces, and lays the files out below it", () => {
    const plan = planRecoveredSolution(
      { ...summary, assembly: { ...summary.assembly, name: "Shop.App" } },
      {
        ...nothing,
        types: [
          type("Retail.Shop", "Program"),
          type("Retail.Shop.Orders", "Order"),
          type("", "Global"),
        ],
      },
    );

    expect(plan.project).toMatchObject({
      assemblyName: "Shop.App",
      rootNamespace: "Retail.Shop",
    });
    expect(plan.files.map((file) => file.path)).toEqual([
      "Shop.App.sln",
      "Shop.App/Shop.App.csproj",
      "Shop.App/Properties/AssemblyInfo.cs",
      "Shop.App/Program.cs",
      "Shop.App/Orders/Order.cs",
      "Shop.App/Global.cs",
    ]);
  });

  it("names the file of a type that declares file-scoped types after the file they were declared in", () => {
    // A file-scoped type's name records its file's: <Helpers>F1A2B…__Format.
    const plan = planRecoveredSolution(summary, {
      ...nothing,
      types: [
        type("Shop", "Program"),
        type("Shop.Text", "Formatting", "Helpers"),
        type("Shop.Text", "Helpers"),
      ],
    });

    expect(plan.files.map((file) => file.path).slice(3)).toEqual([
      "Shop/Program.cs",
      "Shop/Text/Helpers.cs",
      "Shop/Text/Helpers-2.cs",
    ]);
    expect(plan.files[4]?.contents).toBe("// Shop.Text.Formatting\n");
  });

  it("lays each file out at its original path, below the folder holding them all, where its PDB records one", () => {
    const plan = planRecoveredSolution(summary, {
      ...nothing,
      types: [
        type("Shop", "Program", null, "/src/Shop/Program.cs"),
        // Declared in one file, in a folder unlike their namespace.
        type("Shop.Orders", "Order", null, "/src/Shop/Model/Orders.cs", [
          { namespace: "Shop.Orders", name: "Order" },
          { namespace: "Shop.Orders", name: "OrderLine" },
        ]),
        // The PDB records no file for it.
        type("Shop.Orders", "IOrderSource"),
        // Not C#, so laid out by namespace.
        type("Shop.Views", "Index", null, "/src/Shop/Views/Index.cshtml"),
      ],
    });

    expect(plan.files.map((file) => file.path).slice(3)).toEqual([
      "Shop/Program.cs",
      "Shop/Model/Orders.cs",
      "Shop/Orders/IOrderSource.cs",
      "Shop/Views/Index.cs",
    ]);
    expect(plan.files[4]?.contents).toBe("// Shop.Orders.Order\n");
    expect(plan.projects[0]).toMatchObject({
      typeCount: 5,
      sourceFileCount: 4,
    });
  });

  it("recovers the root namespace from every type a file declares, not only the first", () => {
    const plan = planRecoveredSolution(summary, {
      ...nothing,
      types: [
        type("Vendor.Tools", "Helper", null, "/src/Helpers.cs", [
          { namespace: "Vendor.Tools", name: "Helper" },
          { namespace: "Vendor.Other", name: "Neighbour" },
        ]),
      ],
    });

    expect(plan.project.rootNamespace).toBe("Vendor");
  });

  it.each([
    [null, "v4.0.30319", "it has no TargetFrameworkAttribute"],
    [
      "Silverlight,Version=v5.0",
      "v4.0.30319",
      'its TargetFrameworkAttribute, "Silverlight,Version=v5.0", names no framework a project can target',
    ],
    [
      null,
      "v1.1.4322",
      "it has no TargetFrameworkAttribute, and its CLR, v1.1.4322, is .NET Framework 1.x's, which no SDK-style project can target, as no reference assemblies of it are published",
    ],
  ])(
    "refuses an Assembly whose framework name is %j, for CLR %s",
    (frameworkName, runtimeVersion, why) => {
      const plan = () =>
        planRecoveredSolution(
          {
            ...summary,
            targetFramework: {
              moniker: null,
              frameworkName,
              runtimeVersion,
              inferredFrom: null,
              support: "none",
            },
          },
          nothing,
        );

      expect(plan).toThrow(ReconstructionError);
      expect(plan).toThrow(
        `Cannot tell which framework /abs/Shop.dll targets: ${why}.`,
      );
    },
  );
});

describe("planRecoveredSolution, of an Assembly using Windows Forms", () => {
  const forms = {
    name: "System.Windows.Forms",
    version: "4.0.0.0",
    culture: null,
    publicKeyToken: "b77a5c561934e089",
  };
  /** A Windows Forms app, Greeter, for `moniker`. */
  function greeter(moniker: string, frameworkName: string): AssemblySummary {
    return {
      ...summary,
      path: "/abs/Greeter.exe",
      assembly: { ...summary.assembly, name: "Greeter" },
      targetFramework: { ...summary.targetFramework, moniker, frameworkName },
      outputKind: "winforms",
      references: [forms],
    };
  }
  const net8 = greeter("net8.0-windows7.0", ".NETCoreApp,Version=v8.0");
  const net48 = greeter("net48", ".NETFramework,Version=v4.8");
  /** The ApplicationConfiguration the Windows Forms source generator writes, as decompiled. */
  const generated: DecompiledAssembly = {
    ...nothing,
    types: [type("Greeter", "Program"), type("", "ApplicationConfiguration")],
  };
  /** A .resources file whose header names the reader `reader`, embedded as it is. */
  function keptAsIs(name: string, reader: string): ManifestResource {
    const type = Buffer.from(reader);
    // Its length, 7 bits to a byte, as a BinaryWriter writes it.
    const length: number[] = [];
    for (let rest = type.length; ; rest >>= 7) {
      length.push(rest > 0x7f ? (rest & 0x7f) | 0x80 : rest);
      if (rest <= 0x7f) {
        break;
      }
    }
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0xbeefcace, 0);
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(length.length + type.length, 8);
    return {
      name,
      public: true,
      location: "embedded",
      linkedTo: null,
      data: Buffer.concat([header, Buffer.from(length), type]),
      entries: null,
      notDecoded: 'Its entry "$this.Icon" is a serialized System.Drawing.Icon.',
    };
  }
  const deserializing =
    "System.Resources.Extensions.DeserializingResourceReader, System.Resources.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=cc7b13ffcd2ddd51";
  const ordinary =
    "System.Resources.ResourceReader, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089";

  it("uses Windows Forms, for the Windows target framework the original names, which builds on any OS", () => {
    const plan = planRecoveredSolution(net8, nothing);

    expect(plan.project).toMatchObject({
      targetFramework: "net8.0-windows7.0",
      outputType: "WinExe",
      useWindowsForms: true,
    });
    const project = plan.files[1]?.contents as string;
    expect(project).toContain(
      [
        "    <OutputType>WinExe</OutputType>",
        "    <TargetFramework>net8.0-windows7.0</TargetFramework>",
        "    <UseWindowsForms>true</UseWindowsForms>",
        "    <!-- A Windows app builds on any OS, though it runs only on Windows. -->",
        "    <EnableWindowsTargeting>true</EnableWindowsTargeting>",
      ].join("\n"),
    );
  });

  it("makes the target framework of a .NET 5 or later Assembly naming no platform a Windows one, as Windows Forms needs", () => {
    const plan = planRecoveredSolution(
      greeter("net8.0", ".NETCoreApp,Version=v8.0"),
      nothing,
    );

    expect(plan.project.targetFramework).toBe("net8.0-windows");
    expect(plan.files[1]?.contents).toContain(
      "<EnableWindowsTargeting>true</EnableWindowsTargeting>",
    );
  });

  it("uses Windows Forms for .NET Framework as it is, which needs no Windows target framework", () => {
    const plan = planRecoveredSolution(net48, generated);

    expect(plan.project).toMatchObject({
      targetFramework: "net48",
      useWindowsForms: true,
    });
    expect(plan.project.decompiledApplicationConfiguration).toBeUndefined();
    const project = plan.files[1]?.contents as string;
    expect(project).toContain("<UseWindowsForms>true</UseWindowsForms>");
    expect(project).not.toContain("EnableWindowsTargeting");
    expect(project).toContain(NET_FRAMEWORK_REFERENCE_ASSEMBLIES.id);
  });

  it("does not use Windows Forms for an Assembly that does not reference it", () => {
    const plan = planRecoveredSolution(summary, generated);

    expect(plan.project.useWindowsForms).toBeUndefined();
    expect(plan.project.decompiledApplicationConfiguration).toBeUndefined();
    expect(plan.files[1]?.contents).not.toMatch(
      /UseWindowsForms|EnableWindowsTargeting|KeepDecompiledApplicationConfiguration/,
    );
  });

  it("keeps the Windows Forms source generator from writing again the ApplicationConfiguration decompiled from what it wrote", () => {
    const plan = planRecoveredSolution(net8, generated);

    expect(plan.project.decompiledApplicationConfiguration).toBe(true);
    expect(plan.files[1]?.contents).toContain(
      [
        '  <Target Name="KeepDecompiledApplicationConfiguration" AfterTargets="ResolveTargetingPackAssets">',
        "    <ItemGroup>",
        "      <Analyzer Remove=\"@(Analyzer)\" Condition=\"'%(Filename)' == 'System.Windows.Forms.Analyzers.CSharp'\" />",
        "    </ItemGroup>",
        "  </Target>",
        "",
        "</Project>",
      ].join("\n"),
    );
    // One of the app's own, in a namespace, is not the generator's.
    expect(
      planRecoveredSolution(net8, {
        ...nothing,
        types: [type("Greeter", "ApplicationConfiguration")],
      }).project.decompiledApplicationConfiguration,
    ).toBeUndefined();
  });

  it("references System.Resources.Extensions for .NET Framework, where a form's resources embedded as they are need it to be read", () => {
    const plan = planSolution([
      {
        summary: net48,
        decompiled: nothing,
        references: [],
        resources: {
          resources: [keptAsIs("Greeter.MainForm.resources", deserializing)],
          satellites: [],
        },
      },
    ]);

    expect(plan.project.resourcesExtensions).toBe(true);
    expect(plan.files[1]?.contents).toContain(
      [
        "  <ItemGroup>",
        "    <!-- Reads the resources embedded as they are that hold more than strings, byte[]s and streams. -->",
        `    <PackageReference Include="System.Resources.Extensions" Version="${SYSTEM_RESOURCES_EXTENSIONS.version}" />`,
        "  </ItemGroup>",
      ].join("\n"),
    );
  });

  it("references no System.Resources.Extensions where the Windows Desktop framework holds it, or no resource needs it", () => {
    const withResource = (assembly: AssemblySummary, reader: string) =>
      planSolution([
        {
          summary: assembly,
          decompiled: nothing,
          references: [],
          resources: {
            resources: [keptAsIs("Greeter.MainForm.resources", reader)],
            satellites: [],
          },
        },
      ]).project.resourcesExtensions;

    expect(withResource(net8, deserializing)).toBeUndefined();
    expect(withResource(net48, ordinary)).toBeUndefined();
    // A .NET 8 console program's framework does not hold it.
    expect(withResource(summary, deserializing)).toBe(true);
  });
});

describe("planRecoveredSolution, of an Assembly using WPF", () => {
  const presentation = {
    name: "PresentationFramework",
    version: "8.0.0.0",
    culture: null,
    publicKeyToken: "31bf3856ad364e35",
  };
  const tints: AssemblySummary = {
    ...summary,
    path: "/abs/Tints.dll",
    assembly: { ...summary.assembly, name: "Tints" },
    targetFramework: {
      ...summary.targetFramework,
      moniker: "net8.0",
      frameworkName: ".NETCoreApp,Version=v8.0",
    },
    outputKind: "wpf",
    references: [presentation],
  };

  it("uses WPF, for a Windows target framework, which builds on any OS, without listing XAML where it has none", () => {
    const plan = planRecoveredSolution(tints, nothing);

    expect(plan.project).toMatchObject({
      targetFramework: "net8.0-windows",
      outputType: "WinExe",
      useWpf: true,
    });
    expect(plan.project.useWindowsForms).toBeUndefined();
    const project = plan.files[1]?.contents as string;
    expect(project).toContain(
      [
        "    <TargetFramework>net8.0-windows</TargetFramework>",
        "    <UseWPF>true</UseWPF>",
        "    <!-- A Windows app builds on any OS, though it runs only on Windows. -->",
        "    <EnableWindowsTargeting>true</EnableWindowsTargeting>",
      ].join("\n"),
    );
    expect(project).not.toMatch(/EnableDefaultPageItems|<Page |<Resource /);
  });

  it("uses WPF for an Assembly holding BAML, whatever it references", () => {
    const plan = planRecoveredSolution(
      { ...tints, references: [] },
      {
        ...nothing,
        xaml: {
          resource: "Tints.g.resources",
          documents: [],
          notDecompiled: null,
        },
      },
    );

    expect(plan.project.useWpf).toBe(true);
  });

  it("does not use WPF for an Assembly that neither references it nor holds BAML", () => {
    expect(
      planRecoveredSolution(summary, nothing).project.useWpf,
    ).toBeUndefined();
  });
});

describe("usesWpf", () => {
  it("is whether an Assembly references PresentationFramework or PresentationCore, ignoring case", () => {
    const reference = (name: string) => ({
      ...summary,
      references: [
        { name, version: "4.0.0.0", culture: null, publicKeyToken: null },
      ],
    });

    expect(usesWpf(reference("PresentationFramework"))).toBe(true);
    expect(usesWpf(reference("presentationcore"))).toBe(true);
    // .NET's own framework holds a WindowsBase too, for System.IO.Packaging.
    expect(usesWpf(reference("WindowsBase"))).toBe(false);
    expect(usesWpf(summary)).toBe(false);
  });
});

describe("usesWindowsForms", () => {
  it("is whether an Assembly references System.Windows.Forms, ignoring case", () => {
    const reference = (name: string) => ({
      ...summary,
      references: [
        { name, version: "4.0.0.0", culture: null, publicKeyToken: null },
      ],
    });

    expect(usesWindowsForms(reference("System.Windows.Forms"))).toBe(true);
    expect(usesWindowsForms(reference("system.windows.forms"))).toBe(true);
    expect(usesWindowsForms(reference("System.Windows.Forms.Primitives"))).toBe(
      false,
    );
    expect(usesWindowsForms(summary)).toBe(false);
  });
});

describe("forWindows", () => {
  it.each([
    ["net8.0", "net8.0-windows"],
    ["net5.0", "net5.0-windows"],
    ["net8.0-windows7.0", "net8.0-windows7.0"],
    ["net8.0-windows", "net8.0-windows"],
    ["netcoreapp3.1", "netcoreapp3.1"],
    ["net48", "net48"],
    ["net40-client", "net40-client"],
  ])("makes %s %s", (moniker, windows) => {
    expect(forWindows(moniker)).toBe(windows);
  });
});

describe("recoverRootNamespace", () => {
  it("is the Assembly's name when every type is in it or below it, as by default", () => {
    expect(recoverRootNamespace("Shop", ["Shop", "Shop.Orders"])).toBe("Shop");
    expect(recoverRootNamespace("Shop", ["Shop.Orders", "Shop.Tills"])).toBe(
      "Shop",
    );
    expect(recoverRootNamespace("Shop", ["Shop.Orders"])).toBe("Shop");
  });

  it("is the longest namespace every type is in or below, when that is not the Assembly's name", () => {
    expect(
      recoverRootNamespace("Shop", ["Retail.Shop", "Retail.Shop.Orders"]),
    ).toBe("Retail.Shop");
    expect(
      recoverRootNamespace("Shop", ["Retail.Shop.Orders", "Retail.Shop.Tills"]),
    ).toBe("Retail.Shop");
    expect(recoverRootNamespace("Shop", ["Retail.Shop.Orders"])).toBe(
      "Retail.Shop.Orders",
    );
  });

  it("compares whole namespace segments, not characters", () => {
    expect(
      recoverRootNamespace("Shop", ["Retail.Shops", "Retail.Shopping"]),
    ).toBe("Retail");
    expect(recoverRootNamespace("Shop", ["Shopping", "Shop"])).toBe("Shop");
  });

  it("falls back to the Assembly's name when the types share no namespace", () => {
    expect(recoverRootNamespace("Shop", ["Shop", "Vendor.Tools"])).toBe("Shop");
    expect(recoverRootNamespace("Shop", ["Retail", "Vendor"])).toBe("Shop");
  });

  it("ignores the global namespace, and falls back to the Assembly's name with nothing else", () => {
    expect(recoverRootNamespace("Shop", ["", "Retail.Shop", ""])).toBe(
      "Retail.Shop",
    );
    expect(recoverRootNamespace("Shop", [""])).toBe("Shop");
    expect(recoverRootNamespace("Shop", [])).toBe("Shop");
  });
});

describe("recordedSourcePaths", () => {
  it("gives each path below the folder holding every file", () => {
    expect(
      recordedSourcePaths([
        "/src/Shop/Program.cs",
        "/src/Shop/Orders/Order.cs",
        null,
      ]),
    ).toEqual([["Program.cs"], ["Orders", "Order.cs"], null]);
  });

  it("reads Windows paths, and compares their folders ignoring case", () => {
    expect(
      recordedSourcePaths([
        "C:\\src\\Shop\\Program.cs",
        "c:\\SRC\\shop\\Orders\\Order.cs",
      ]),
    ).toEqual([["Program.cs"], ["Orders", "Order.cs"]]);
  });

  it("lays out at the top files that all share a folder, as the PDB does not record the project's", () => {
    expect(
      recordedSourcePaths(["/src/Shop/Orders/A.cs", "/src/Shop/Orders/B.cs"]),
    ).toEqual([["A.cs"], ["B.cs"]]);
    expect(recordedSourcePaths(["/_/src/Program.cs"])).toEqual([
      ["Program.cs"],
    ]);
  });

  it("does not let files the build generated in obj decide the folder, and lays out by namespace those outside it", () => {
    expect(
      recordedSourcePaths([
        "/src/Shop/Program.cs",
        "/src/Shop/obj/Release/net8.0/Generated.g.cs",
        "/artifacts/obj/Shop/release/Other.g.cs",
      ]),
    ).toEqual([
      ["Program.cs"],
      ["obj", "Release", "net8.0", "Generated.g.cs"],
      null,
    ]);
    // Unless every file is.
    expect(
      recordedSourcePaths(["/a/obj/One.g.cs", "/a/obj/Two/Two.g.cs"]),
    ).toEqual([["One.g.cs"], ["Two", "Two.g.cs"]]);
  });

  it("leaves out what is not a C# file, or a path that climbs out of its folder", () => {
    expect(
      recordedSourcePaths([
        "/src/Shop/Program.cs",
        "/src/Shop/Views/Index.cshtml",
        "/src/Shop/../Other.cs",
        "",
      ]),
    ).toEqual([["Program.cs"], null, null, null]);
  });
});

describe("SourceLayout", () => {
  it("claims an original path, made safe, telling files that share one apart before their extension", () => {
    const layout = new SourceLayout("Shop", ["Properties/AssemblyInfo.cs"]);

    expect(layout.claimPath(["Model", "Orders.cs"])).toBe("Model/Orders.cs");
    expect(layout.claimPath(["model", "orders.cs"])).toBe("model/orders-2.cs");
    expect(layout.claimPath(["Properties", "AssemblyInfo.cs"])).toBe(
      "Properties/AssemblyInfo-2.cs",
    );
    expect(layout.claimPath(["bin", "Form1.Designer.cs"])).toBe(
      "_bin/Form1.Designer.cs",
    );
    // A type laid out by namespace cannot take a path already claimed.
    expect(layout.claim("Shop.Model", "Orders")).toBe("Model/Orders-3.cs");
  });

  it("puts types in the root namespace at the top, and others in a folder per namespace segment", () => {
    const layout = new SourceLayout("Shop");

    expect(layout.claim("Shop", "Program")).toBe("Program.cs");
    expect(layout.claim("Shop.Orders", "Order")).toBe("Orders/Order.cs");
    expect(layout.claim("Shop.Orders.Lines", "Line")).toBe(
      "Orders/Lines/Line.cs",
    );
    expect(layout.claim("Vendor.Tools", "Helper")).toBe(
      "Vendor/Tools/Helper.cs",
    );
    expect(layout.claim("", "Global")).toBe("Global.cs");
    // A namespace that only starts with the root's name is not in it.
    expect(layout.claim("Shopping", "Cart")).toBe("Shopping/Cart.cs");
  });

  it("names a generic type's file without its arity, and tells types sharing a name apart", () => {
    const layout = new SourceLayout("Shop");

    expect(layout.claim("Shop", "Pair")).toBe("Pair.cs");
    expect(layout.claim("Shop", "Pair`1")).toBe("Pair-2.cs");
    expect(layout.claim("Shop", "Pair`2")).toBe("Pair-3.cs");
    expect(layout.claim("Shop", "Result`1")).toBe("Result.cs");
  });

  it("keeps apart files whose paths differ only in case, as Windows and macOS cannot", () => {
    const layout = new SourceLayout("Shop");

    expect(layout.claim("Shop", "order")).toBe("order.cs");
    expect(layout.claim("Shop", "Order")).toBe("Order-2.cs");
    expect(layout.claim("Shop.orders", "Item")).toBe("orders/Item.cs");
    expect(layout.claim("Shop.Orders", "Item")).toBe("Orders/Item-2.cs");
  });

  it("never claims a path it was told is reserved", () => {
    const layout = new SourceLayout("Shop", ["Properties/AssemblyInfo.cs"]);

    expect(layout.claim("Shop.Properties", "AssemblyInfo")).toBe(
      "Properties/AssemblyInfo-2.cs",
    );
  });

  it("makes names the compiler generates safe as paths", () => {
    const layout = new SourceLayout("Shop");

    expect(layout.claim("", "<>z__ReadOnlyArray`1")).toBe(
      "__z__ReadOnlyArray.cs",
    );
    expect(layout.claim("", "<PrivateImplementationDetails>")).toBe(
      "_PrivateImplementationDetails_.cs",
    );
  });
});

describe("safeSegment", () => {
  it.each([
    ["Order", "Order"],
    ['a<b>c:d"e/f\\g|h?i*j', "a_b_c_d_e_f_g_h_i_j"],
    ["tab\there", "tab_here"],
    ["trailing.", "trailing_"],
    ["trailing ", "trailing_"],
    ["", "_"],
    // Windows device names, with or without an extension.
    ["CON", "_CON"],
    ["con.cs", "_con.cs"],
    ["Com1", "_Com1"],
    ["LPT9.cs", "_LPT9.cs"],
    ["Console", "Console"],
    // Folders the SDK does not compile sources from.
    ["bin", "_bin"],
    ["Obj", "_Obj"],
    [".hidden", "_.hidden"],
    ["Binary", "Binary"],
  ])("makes %j %j", (name, safe) => {
    expect(safeSegment(name)).toBe(safe);
  });
});

describe("projectFile", () => {
  it("references the projects of the Sibling Assemblies it references", () => {
    expect(
      projectFile({
        ...shop,
        projectReferences: [
          "..\\Pricing\\Pricing.csproj",
          "..\\R&D\\R&D.csproj",
        ],
      }),
    ).toBe(
      projectFile(shop).replace(
        "</Project>\n",
        [
          "  <ItemGroup>",
          "    <!-- Sibling Assemblies, each recovered as a project of its own. -->",
          '    <ProjectReference Include="..\\Pricing\\Pricing.csproj" />',
          '    <ProjectReference Include="..\\R&amp;D\\R&amp;D.csproj" />',
          "  </ItemGroup>",
          "",
          "</Project>",
          "",
        ].join("\n"),
      ),
    );
  });

  it("references the NuGet packages holding assemblies it references, before the projects of Sibling Assemblies", () => {
    expect(
      projectFile({
        ...shop,
        packageReferences: [
          { id: "Newtonsoft.Json", version: "13.0.3" },
          { id: "Serilog", version: "3.1.1" },
        ],
        projectReferences: ["..\\Pricing\\Pricing.csproj"],
      }),
    ).toBe(
      projectFile(shop).replace(
        "</Project>\n",
        [
          "  <ItemGroup>",
          "    <!-- NuGet packages, each holding an assembly the original references. -->",
          '    <PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
          '    <PackageReference Include="Serilog" Version="3.1.1" />',
          "  </ItemGroup>",
          "",
          "  <ItemGroup>",
          "    <!-- Sibling Assemblies, each recovered as a project of its own. -->",
          '    <ProjectReference Include="..\\Pricing\\Pricing.csproj" />',
          "  </ItemGroup>",
          "",
          "</Project>",
          "",
        ].join("\n"),
      ),
    );
  });

  it("references each binary copied into the Recovered Solution by its HintPath, after the NuGet packages and before the projects of Sibling Assemblies", () => {
    expect(
      projectFile({
        ...shop,
        packageReferences: [{ id: "Serilog", version: "3.1.1" }],
        binaryReferences: [
          {
            assemblyName: "Kestrelwood.Checksums",
            hintPath: "..\\Dependencies\\Kestrelwood.Checksums.dll",
          },
          { assemblyName: "A&B", hintPath: "..\\Dependencies\\A&B.dll" },
        ],
        projectReferences: ["..\\Pricing\\Pricing.csproj"],
      }),
    ).toBe(
      projectFile(shop).replace(
        "</Project>\n",
        [
          "  <ItemGroup>",
          "    <!-- NuGet packages, each holding an assembly the original references. -->",
          '    <PackageReference Include="Serilog" Version="3.1.1" />',
          "  </ItemGroup>",
          "",
          "  <ItemGroup>",
          "    <!-- Binaries found beside the original, copied into Dependencies and referenced as they are. -->",
          '    <Reference Include="Kestrelwood.Checksums">',
          "      <HintPath>..\\Dependencies\\Kestrelwood.Checksums.dll</HintPath>",
          "    </Reference>",
          '    <Reference Include="A&amp;B">',
          "      <HintPath>..\\Dependencies\\A&amp;B.dll</HintPath>",
          "    </Reference>",
          "  </ItemGroup>",
          "",
          "  <ItemGroup>",
          "    <!-- Sibling Assemblies, each recovered as a project of its own. -->",
          '    <ProjectReference Include="..\\Pricing\\Pricing.csproj" />',
          "  </ItemGroup>",
          "",
          "</Project>",
          "",
        ].join("\n"),
      ),
    );
  });

  it("is SDK-style, keeps the name, root namespace, target framework and output type, and generates no assembly attributes", () => {
    expect(projectFile(shop)).toBe(
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        "",
        "  <PropertyGroup>",
        "    <AssemblyName>Shop</AssemblyName>",
        "    <RootNamespace>Shop</RootNamespace>",
        "    <OutputType>Exe</OutputType>",
        "    <TargetFramework>net8.0</TargetFramework>",
        "    <LangVersion>12.0</LangVersion>",
        "    <!-- Properties/AssemblyInfo.cs declares the original's assembly attributes. -->",
        "    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>",
        "  </PropertyGroup>",
        "",
        "</Project>",
        "",
      ].join("\n"),
    );
  });

  it("allows unsafe code, and gives a nullable annotations context, when asked to", () => {
    expect(
      projectFile({
        ...shop,
        rootNamespace: "Retail.Shop",
        allowUnsafeBlocks: true,
        nullable: "annotations",
      }),
    ).toBe(
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        "",
        "  <PropertyGroup>",
        "    <AssemblyName>Shop</AssemblyName>",
        "    <RootNamespace>Retail.Shop</RootNamespace>",
        "    <OutputType>Exe</OutputType>",
        "    <TargetFramework>net8.0</TargetFramework>",
        "    <LangVersion>12.0</LangVersion>",
        "    <AllowUnsafeBlocks>true</AllowUnsafeBlocks>",
        "    <!-- The original's nullable annotations; its Assembly does not record whether its build warned. -->",
        "    <Nullable>annotations</Nullable>",
        "    <!-- Properties/AssemblyInfo.cs declares the original's assembly attributes. -->",
        "    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>",
        "  </PropertyGroup>",
        "",
        "</Project>",
        "",
      ].join("\n"),
    );
  });

  it("references .NET Framework's reference assemblies for a .NET Framework target, so it builds on any OS", () => {
    expect(projectFile({ ...shop, targetFramework: "net48" })).toBe(
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        "",
        "  <PropertyGroup>",
        "    <AssemblyName>Shop</AssemblyName>",
        "    <RootNamespace>Shop</RootNamespace>",
        "    <OutputType>Exe</OutputType>",
        "    <TargetFramework>net48</TargetFramework>",
        "    <LangVersion>12.0</LangVersion>",
        "    <!-- Properties/AssemblyInfo.cs declares the original's assembly attributes. -->",
        "    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>",
        "  </PropertyGroup>",
        "",
        "  <ItemGroup>",
        "    <!-- The framework's reference assemblies, so this builds on any OS. -->",
        '    <PackageReference Include="Microsoft.NETFramework.ReferenceAssemblies" Version="1.0.3" PrivateAssets="all" />',
        "  </ItemGroup>",
        "",
        "</Project>",
        "",
      ].join("\n"),
    );
    expect(NET_FRAMEWORK_REFERENCE_ASSEMBLIES).toEqual({
      id: "Microsoft.NETFramework.ReferenceAssemblies",
      version: "1.0.3",
    });
  });

  it("escapes what XML would misread", () => {
    const project = projectFile({
      ...shop,
      assemblyName: "A&B<C>",
      rootNamespace: "A&B<C>",
    });

    expect(project).toContain("<AssemblyName>A&amp;B&lt;C&gt;</AssemblyName>");
    expect(project).toContain(
      "<RootNamespace>A&amp;B&lt;C&gt;</RootNamespace>",
    );
  });
});

/** The summary of a .NET 8 library `name`, at `/abs/<name>.dll`. */
function library(name: string): AssemblySummary {
  return {
    ...summary,
    path: `/abs/${name}.dll`,
    assembly: { ...summary.assembly, name },
    entryPoint: null,
    outputKind: "library",
  };
}

describe("planSolution", () => {
  it("lays out a project per Assembly, the input's first, each referencing those its Assembly does, in one solution", () => {
    const plan = planSolution([
      {
        summary,
        decompiled: { ...nothing, types: [type("Shop", "Program")] },
        references: [1, 2],
      },
      {
        summary: library("Pricing"),
        decompiled: {
          ...nothing,
          nullableAnnotations: true,
          types: [type("Shop.Pricing", "PriceList")],
        },
        references: [2],
      },
      {
        summary: library("Inventory"),
        decompiled: { ...nothing, types: [type("Inventory", "Item")] },
        references: [],
      },
    ]);

    const pricing: ProjectProperties = {
      ...shop,
      assemblyName: "Pricing",
      rootNamespace: "Shop.Pricing",
      outputType: "Library",
      nullable: "annotations",
      projectReferences: ["..\\Inventory\\Inventory.csproj"],
    };
    const inventory: ProjectProperties = {
      ...shop,
      assemblyName: "Inventory",
      rootNamespace: "Inventory",
      outputType: "Library",
    };
    const main: ProjectProperties = {
      ...shop,
      projectReferences: [
        "..\\Pricing\\Pricing.csproj",
        "..\\Inventory\\Inventory.csproj",
      ],
    };
    expect(plan).toMatchObject({
      name: "Shop",
      solutionPath: "Shop.sln",
      projectPath: "Shop/Shop.csproj",
      project: main,
    });
    expect(plan.projects).toEqual([
      {
        assemblyPath: "/abs/Shop.dll",
        projectPath: "Shop/Shop.csproj",
        project: main,
        typeCount: 1,
        sourceFileCount: 1,
        resources: [],
      },
      {
        assemblyPath: "/abs/Pricing.dll",
        projectPath: "Pricing/Pricing.csproj",
        project: pricing,
        typeCount: 1,
        sourceFileCount: 1,
        resources: [],
      },
      {
        assemblyPath: "/abs/Inventory.dll",
        projectPath: "Inventory/Inventory.csproj",
        project: inventory,
        typeCount: 1,
        sourceFileCount: 1,
        resources: [],
      },
    ]);
    expect(plan.files.map(({ path }) => path)).toEqual([
      "Shop.sln",
      "Shop/Shop.csproj",
      "Shop/Properties/AssemblyInfo.cs",
      "Shop/Program.cs",
      "Pricing/Pricing.csproj",
      "Pricing/Properties/AssemblyInfo.cs",
      "Pricing/PriceList.cs",
      "Inventory/Inventory.csproj",
      "Inventory/Properties/AssemblyInfo.cs",
      "Inventory/Item.cs",
    ]);
    expect(plan.files[0]?.contents).toBe(
      solutionFile([
        { name: "Shop", projectPath: "Shop/Shop.csproj" },
        { name: "Pricing", projectPath: "Pricing/Pricing.csproj" },
        { name: "Inventory", projectPath: "Inventory/Inventory.csproj" },
      ]),
    );
    expect(plan.files[4]?.contents).toBe(projectFile(pricing));
  });

  it("gives each project the NuGet packages its Assembly references", () => {
    const plan = planSolution([
      {
        summary,
        decompiled: { ...nothing, types: [type("Shop", "Program")] },
        references: [1],
        packages: [{ id: "Newtonsoft.Json", version: "13.0.3" }],
      },
      {
        summary: library("Pricing"),
        decompiled: { ...nothing, types: [type("Pricing", "PriceList")] },
        references: [],
      },
    ]);

    expect(
      plan.projects.map(({ project }) => project.packageReferences),
    ).toEqual([[{ id: "Newtonsoft.Json", version: "13.0.3" }], undefined]);
    expect(
      plan.files.find(({ path }) => path === "Shop/Shop.csproj")?.contents,
    ).toContain(
      '<PackageReference Include="Newtonsoft.Json" Version="13.0.3" />',
    );
  });

  it("copies each binary into Dependencies, keeping its file name, and references it from the projects of the Assemblies that reference it", () => {
    const plan = planSolution(
      [
        {
          summary,
          decompiled: { ...nothing, types: [type("Shop", "Program")] },
          references: [1],
          binaries: [1, 0],
        },
        {
          summary: library("Pricing"),
          decompiled: { ...nothing, types: [type("Pricing", "PriceList")] },
          references: [],
          binaries: [1],
        },
      ],
      [
        { assemblyName: "Barcodes", sourcePath: "/abs/Barcodes.dll" },
        { assemblyName: "Fonts", sourcePath: "/abs/fonts.EXE" },
      ],
    );

    expect(plan.binaries).toEqual([
      {
        assemblyName: "Barcodes",
        sourcePath: "/abs/Barcodes.dll",
        path: "Dependencies/Barcodes.dll",
      },
      {
        assemblyName: "Fonts",
        sourcePath: "/abs/fonts.EXE",
        path: "Dependencies/fonts.EXE",
      },
    ]);
    expect(
      plan.projects.map(({ project }) => project.binaryReferences),
    ).toEqual([
      [
        { assemblyName: "Fonts", hintPath: "..\\Dependencies\\fonts.EXE" },
        {
          assemblyName: "Barcodes",
          hintPath: "..\\Dependencies\\Barcodes.dll",
        },
      ],
      [{ assemblyName: "Fonts", hintPath: "..\\Dependencies\\fonts.EXE" }],
    ]);
    // The binaries are copied, not written, so are not among the files.
    expect(plan.files.map(({ path }) => path)).not.toContain(
      "Dependencies/Barcodes.dll",
    );
    expect(
      plan.files.find(({ path }) => path === "Pricing/Pricing.csproj")
        ?.contents,
    ).toBe(projectFile(plan.projects[1]?.project as ProjectProperties));
  });

  it("keeps Dependencies apart from the projects' folders, ignoring case, and the binaries' names apart from one another", () => {
    const plan = planSolution(
      [
        { summary, decompiled: nothing, references: [], binaries: [0, 1] },
        {
          summary: library("DEPENDENCIES"),
          decompiled: nothing,
          references: [],
        },
      ],
      [
        { assemblyName: "Fonts", sourcePath: "/abs/Fonts.dll" },
        { assemblyName: "fonts", sourcePath: "/other/fonts.dll" },
      ],
    );

    expect(plan.projects.map(({ projectPath }) => projectPath)).toEqual([
      "Shop/Shop.csproj",
      "DEPENDENCIES-2/DEPENDENCIES.csproj",
    ]);
    expect(plan.binaries.map(({ path }) => path)).toEqual([
      "Dependencies/Fonts.dll",
      "Dependencies/fonts-2.dll",
    ]);
  });

  it("claims no Dependencies folder when there is no binary to copy", () => {
    const plan = planSolution([
      { summary, decompiled: nothing, references: [] },
      { summary: library("Dependencies"), decompiled: nothing, references: [] },
    ]);

    expect(plan.binaries).toEqual([]);
    expect(plan.projects[1]?.projectPath).toBe(
      "Dependencies/Dependencies.csproj",
    );
  });

  it("keeps the projects' folders apart, ignoring case, and apart from the solution and the report", () => {
    const plan = planSolution([
      { summary, decompiled: nothing, references: [] },
      { summary: library("A<B"), decompiled: nothing, references: [] },
      { summary: library("A>B"), decompiled: nothing, references: [] },
      { summary: library("SHOP.SLN"), decompiled: nothing, references: [] },
      {
        summary: library("Xray-Report.json"),
        decompiled: nothing,
        references: [],
      },
    ]);

    expect(plan.projects.map(({ projectPath }) => projectPath)).toEqual([
      "Shop/Shop.csproj",
      "A_B/A_B.csproj",
      "A_B-2/A_B.csproj",
      "SHOP.SLN-2/SHOP.SLN.csproj",
      "Xray-Report.json-2/Xray-Report.json.csproj",
    ]);
  });

  it("throws a ReconstructionError when a Sibling Assembly's target framework cannot be told", () => {
    expect(() =>
      planSolution([
        { summary, decompiled: nothing, references: [1] },
        {
          summary: {
            ...library("Odd"),
            targetFramework: {
              moniker: null,
              frameworkName: null,
              runtimeVersion: "v4.0.30319",
              inferredFrom: null,
              support: "none",
            },
          },
          decompiled: nothing,
          references: [],
        },
      ]),
    ).toThrow(
      new ReconstructionError(
        "unknown-target-framework",
        "Cannot tell which framework /abs/Odd.dll targets: it has no TargetFrameworkAttribute.",
      ),
    );
  });
});

describe("isNetFramework", () => {
  it.each(["net40", "net40-client", "net45", "net462", "net48", "net481"])(
    "says %s is .NET Framework",
    (moniker) => {
      expect(isNetFramework(moniker)).toBe(true);
    },
  );

  it.each([
    "net5.0",
    "net8.0",
    "net6.0-windows7.0",
    "netcoreapp3.1",
    "netstandard2.0",
  ])("says %s is not", (moniker) => {
    expect(isNetFramework(moniker)).toBe(false);
  });
});

describe("solutionFile", () => {
  it("holds each project in turn, each in Debug and Release", () => {
    const solution = solutionFile([
      { name: "Shop", projectPath: "Shop/Shop.csproj" },
      { name: "Inventory", projectPath: "Inventory/Inventory.csproj" },
    ]);
    const ids = [
      ...solution.matchAll(
        /^Project\("\{[^}]+\}"\) = "(\w+)", "([^"]+)", "(\{[^}]+\})"\nEndProject$/gm,
      ),
    ].map(([, name, path, id]) => ({ name, path, id }));

    expect(ids.map(({ name, path }) => `${name} ${path}`)).toEqual([
      "Shop Shop\\Shop.csproj",
      "Inventory Inventory\\Inventory.csproj",
    ]);
    expect(ids[0]?.id).not.toBe(ids[1]?.id);
    for (const { id } of ids) {
      expect(solution).toContain(
        `\t\t${id}.Release|Any CPU.Build.0 = Release|Any CPU\n`,
      );
    }
  });

  it("holds the project, in Debug and Release, under an ID that depends only on its name", () => {
    const solution = solutionFile([
      { name: "Shop", projectPath: "Shop/Shop.csproj" },
    ]);
    const id = /"Shop", "Shop\\Shop\.csproj", "(\{[0-9A-F-]{36}\})"/.exec(
      solution,
    )?.[1];

    expect(solution).toMatch(
      /^Microsoft Visual Studio Solution File, Format Version 12\.00\n/,
    );
    expect(id).toMatch(
      /^\{[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}\}$/,
    );
    for (const configuration of ["Debug|Any CPU", "Release|Any CPU"]) {
      expect(solution).toContain(
        `\t\t${id}.${configuration}.ActiveCfg = ${configuration}\n`,
      );
      expect(solution).toContain(
        `\t\t${id}.${configuration}.Build.0 = ${configuration}\n`,
      );
    }
    expect(
      solutionFile([{ name: "Shop", projectPath: "Shop/Shop.csproj" }]),
    ).toBe(solution);
    expect(
      solutionFile([{ name: "Till", projectPath: "Till/Till.csproj" }]),
    ).not.toContain(id);
  });
});
