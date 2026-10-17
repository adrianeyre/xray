import { describe, expect, it } from "vitest";

import {
  extensionOf,
  planResources,
  resourceReaderOf,
  resxFile,
  type ManifestResource,
  type TypeLayout,
} from "./recovered-resources.js";
import { projectFile, SourceLayout } from "./recovered-solution.js";

const text = (value: string) => new TextEncoder().encode(value);

/** An embedded resource, as the engine reads it: a file, or a `.resources` file of `entries`. */
function embedded(
  name: string,
  contents: Partial<ManifestResource> = {},
): ManifestResource {
  return {
    name,
    public: true,
    location: "embedded",
    linkedTo: null,
    data: text(name),
    entries: null,
    notDecoded: null,
    ...contents,
  };
}

/** A `.resources` file of strings, which becomes a `.resx`. */
function strings(
  name: string,
  ...values: [string, string][]
): ManifestResource {
  return embedded(name, {
    data: null,
    entries: values.map(([entry, value]) => ({
      name: entry,
      kind: "string",
      value,
    })),
  });
}

const types: TypeLayout = {
  rootNamespace: "App",
  namespaces: ["App", "App.Forms"],
  files: new Map([
    ["App.Program", "Program.cs"],
    ["App.Forms.Main", "Windows/MainWindow.cs"],
  ]),
};

/** Where each resource goes, in a project whose sources are already laid out. */
function paths(
  resources: readonly ManifestResource[],
  satellites: { culture: string; resources: ManifestResource[] }[] = [],
  claimed: readonly string[] = ["Program.cs", "Windows/MainWindow.cs"],
) {
  const planned = planResources(
    {
      resources,
      satellites: satellites.map((satellite) => ({
        ...satellite,
        path: `/abs/${satellite.culture}/App.resources.dll`,
      })),
    },
    new SourceLayout("App", claimed),
    types,
  );
  return planned.resources.map(({ name, path }) => [name, path]);
}

describe("planResources", () => {
  it("lays out a resource named after a type beside that type's file, named after it, as Visual Studio does", () => {
    expect(
      paths([
        strings("App.Program.resources"),
        strings("App.Forms.Main.resources"),
        embedded("App.Forms.Main.ico"),
      ]),
    ).toEqual([
      ["App.Program.resources", "Program.resx"],
      ["App.Forms.Main.resources", "Windows/MainWindow.resx"],
      ["App.Forms.Main.ico", "Windows/MainWindow.ico"],
    ]);
  });

  it("lays out any other in the folder of the longest namespace its name starts with, and one of no namespace at the top", () => {
    expect(
      paths([
        strings("App.Strings.resources"),
        embedded("App.Forms.Images.logo.png"),
        embedded("App.Assets.data.json"),
        embedded("Vendor.License.txt"),
        embedded("motd"),
        embedded("App"),
      ]),
    ).toEqual([
      ["App.Strings.resources", "Strings.resx"],
      ["App.Forms.Images.logo.png", "Forms/Images.logo.png"],
      ["App.Assets.data.json", "Assets.data.json"],
      ["Vendor.License.txt", "Vendor.License.txt"],
      ["motd", "motd"],
      ["App", "App"],
    ]);
  });

  it("lays out a .resources file kept as it is as one, and one written as a .resx as that", () => {
    expect(
      paths([
        embedded("App.Limits.resources", { notDecoded: "Holds an int." }),
        strings("App.Strings.resources"),
      ]),
    ).toEqual([
      ["App.Limits.resources", "Limits.resources"],
      ["App.Strings.resources", "Strings.resx"],
    ]);
  });

  it("lays out each satellite assembly's resource beside the Assembly's own, its culture before its extension, however that was kept apart", () => {
    expect(
      paths(
        [strings("App.Strings.resources"), embedded("App.notes.txt")],
        [
          {
            culture: "fr",
            resources: [
              strings("App.Strings.fr.resources"),
              embedded("App.notes.txt"),
              embedded("App.Only.fr.resources", {
                notDecoded: "Holds an int.",
              }),
              embedded("readme"),
            ],
          },
          {
            culture: "zh-Hans",
            resources: [strings("App.Strings.zh-Hans.resources")],
          },
        ],
        // Another file has Strings.resx, ignoring case, so it is Strings-2.resx.
        ["strings.RESX"],
      ),
    ).toEqual([
      ["App.Strings.resources", "Strings-2.resx"],
      ["App.notes.txt", "notes.txt"],
      ["App.Strings.fr.resources", "Strings-2.fr.resx"],
      ["App.notes.txt", "notes.fr.txt"],
      ["App.Only.fr.resources", "Only.fr.resources"],
      // The build needs an extension to find the culture before.
      ["readme", "readme.fr.bin"],
      ["App.Strings.zh-Hans.resources", "Strings-2.zh-Hans.resx"],
    ]);
  });

  it("keeps the build from taking a neutral resource's file for a culture's", () => {
    expect(
      paths([
        embedded("jquery.min.js"),
        embedded("App.Strings.de.resources", { notDecoded: "Holds an int." }),
        embedded("App.logo.small.png"),
      ]),
    ).toEqual([
      ["jquery.min.js", "jquery_min.js"],
      ["App.Strings.de.resources", "Strings_de.resources"],
      ["App.logo.small.png", "logo.small.png"],
    ]);
  });

  it("makes a name safe as a file's on every OS, and keeps names apart ignoring case", () => {
    expect(
      paths([
        embedded("App.a:b.txt"),
        embedded("App.NUL.txt"),
        embedded("App.A:B.TXT"),
      ]),
    ).toEqual([
      ["App.a:b.txt", "a_b.txt"],
      ["App.NUL.txt", "_NUL.txt"],
      ["App.A:B.TXT", "a_b-2.TXT"],
    ]);
  });

  it("puts each byte[] and stream of a .resx in a file of its own, in a folder named after it, which the .resx refers to", () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const planned = planResources(
      {
        resources: [
          embedded("App.Forms.Images.resources", {
            data: null,
            entries: [
              { name: "Logo", kind: "bytes", value: png },
              { name: "a;b", kind: "stream", value: text("notes") },
              { name: "Caption", kind: "string", value: "Hi" },
            ],
          }),
        ],
        satellites: [],
      },
      new SourceLayout("App"),
      types,
    );

    expect(planned.files.map(({ path }) => path)).toEqual([
      "Forms/Images/Logo.png",
      "Forms/Images/a_b.txt",
      "Forms/Images.resx",
    ]);
    expect(planned.files[0]?.contents).toBe(png);
    expect(planned.files[2]?.contents).toContain(
      "    <value>Images/Logo.png;System.Byte[], mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>\n",
    );
    expect(planned.files[2]?.contents).toContain(
      "    <value>Images/a_b.txt;System.IO.MemoryStream, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>\n",
    );
    expect(planned.items).toEqual([
      {
        include: "Forms/Images.resx",
        logicalName: "App.Forms.Images.resources",
        public: true,
        kind: "resx",
      },
    ]);
  });

  it("embeds a file as it is, private if it was, and says why a .resources file was kept as it is", () => {
    const planned = planResources(
      {
        resources: [
          embedded("secret", { public: false, data: text("swordfish") }),
          embedded("App.Limits.resources", { notDecoded: "Holds an int." }),
        ],
        satellites: [],
      },
      new SourceLayout("App"),
      types,
    );

    expect(planned.files).toEqual([
      { path: "secret", contents: text("swordfish") },
      { path: "Limits.resources", contents: text("App.Limits.resources") },
    ]);
    expect(planned.items).toEqual([
      { include: "secret", logicalName: "secret", public: false, kind: "file" },
      {
        include: "Limits.resources",
        logicalName: "App.Limits.resources",
        public: true,
        kind: "file",
      },
    ]);
    expect(
      planned.resources.map(({ recoveredAs, reason }) => [recoveredAs, reason]),
    ).toEqual([
      ["file", null],
      ["file", "Holds an int."],
    ]);
  });

  it("does not recover a linked resource, saying where it is", () => {
    const planned = planResources(
      {
        resources: [
          embedded("App.Big.bin", {
            location: "file",
            linkedTo: "Big.bin",
            data: null,
          }),
          embedded("App.Elsewhere.txt", {
            location: "assembly",
            linkedTo: "Other",
            data: null,
          }),
        ],
        satellites: [],
      },
      new SourceLayout("App"),
      types,
    );

    expect(planned.files).toEqual([]);
    expect(planned.items).toEqual([]);
    expect(planned.resources).toEqual([
      {
        name: "App.Big.bin",
        culture: null,
        public: true,
        recoveredAs: "not-recovered",
        path: null,
        reason:
          "It is not embedded in the Assembly, but in the file Big.bin, which Xray does not recover, so the rebuilt Assembly has no resource of that name.",
      },
      {
        name: "App.Elsewhere.txt",
        culture: null,
        public: true,
        recoveredAs: "not-recovered",
        path: null,
        reason:
          "It is not embedded in the Assembly, but in the assembly Other, which Xray does not recover, so the rebuilt Assembly has no resource of that name.",
      },
    ]);
  });
});

/** The header of a `.resources` file naming `reader`, as a ResourceWriter writes it: its length 7 bits to a byte. */
function resourcesNaming(reader: string): Uint8Array {
  const type = text(reader);
  const length: number[] = [];
  for (let rest = type.length; ; rest >>= 7) {
    length.push(rest > 0x7f ? (rest & 0x7f) | 0x80 : rest);
    if (rest <= 0x7f) {
      break;
    }
  }
  const header = new DataView(new ArrayBuffer(12));
  header.setUint32(0, 0xbeefcace, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, length.length + type.length, true);
  return new Uint8Array([...new Uint8Array(header.buffer), ...length, ...type]);
}

const DESERIALIZING_READER =
  "System.Resources.Extensions.DeserializingResourceReader, System.Resources.Extensions, Version=4.0.0.0, Culture=neutral, PublicKeyToken=cc7b13ffcd2ddd51";

describe("resourceReaderOf", () => {
  it("reads the reader a .resources file's header names, its name's length 7 bits to a byte", () => {
    expect(resourceReaderOf(resourcesNaming(DESERIALIZING_READER))).toBe(
      DESERIALIZING_READER,
    );
    expect(
      resourceReaderOf(
        resourcesNaming("System.Resources.ResourceReader, mscorlib"),
      ),
    ).toBe("System.Resources.ResourceReader, mscorlib");
  });

  it("is null for what is not a .resources file, or is cut short", () => {
    expect(resourceReaderOf(text("not a .resources file"))).toBeNull();
    expect(resourceReaderOf(new Uint8Array())).toBeNull();
    expect(
      resourceReaderOf(resourcesNaming(DESERIALIZING_READER).subarray(0, 40)),
    ).toBeNull();
  });
});

describe("planResources, of .resources files embedded as they are", () => {
  const plan = (...resources: ManifestResource[]) =>
    planResources(
      { resources, satellites: [] },
      new SourceLayout("App", ["Program.cs"]),
      types,
    ).readByResourcesExtensions;

  it("says whether one names System.Resources.Extensions' reader, as one holding a form's icon does", () => {
    expect(
      plan(
        embedded("App.Forms.Main.resources", {
          data: resourcesNaming(DESERIALIZING_READER),
          notDecoded:
            'Its entry "$this.Icon" is a serialized System.Drawing.Icon.',
        }),
      ),
    ).toBe(true);
    expect(
      plan(
        embedded("App.Limits.resources", {
          data: resourcesNaming(
            "System.Resources.ResourceReader, mscorlib, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089",
          ),
        }),
      ),
    ).toBe(false);
    // Any other file is not read by a resource manager.
    expect(
      plan(
        embedded("App.reader.bin", {
          data: resourcesNaming(DESERIALIZING_READER),
        }),
      ),
    ).toBe(false);
    expect(plan(strings("App.Strings.resources", ["Hello", "Hello"]))).toBe(
      false,
    );
  });
});

describe("resxFile", () => {
  it("writes a .resx as Visual Studio does, keeping every character of each string, a \\r too, which XML would read as \\n", () => {
    expect(
      resxFile([
        { name: 'Say "hi"\tnow', text: "<b>Fish</b> & chips\r\nline two\n  " },
        { name: "Empty", text: "" },
      ]),
    ).toBe(
      [
        '<?xml version="1.0" encoding="utf-8"?>',
        "<root>",
        '  <resheader name="resmimetype">',
        "    <value>text/microsoft-resx</value>",
        "  </resheader>",
        '  <resheader name="version">',
        "    <value>2.0</value>",
        "  </resheader>",
        '  <resheader name="reader">',
        "    <value>System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>",
        "  </resheader>",
        '  <resheader name="writer">',
        "    <value>System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089</value>",
        "  </resheader>",
        '  <data name="Say &quot;hi&quot;&#x9;now" xml:space="preserve">',
        "    <value>&lt;b&gt;Fish&lt;/b&gt; &amp; chips&#xD;\nline two\n  </value>",
        "  </data>",
        '  <data name="Empty" xml:space="preserve">',
        "    <value></value>",
        "  </data>",
        "</root>",
        "",
      ].join("\n"),
    );
  });

  it("names System.Windows.Forms, whose ResXFileRef it uses, only when it refers to a file", () => {
    const alias =
      '  <assembly alias="System.Windows.Forms" name="System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089" />';

    expect(resxFile([{ name: "A", text: "a" }])).not.toContain(alias);
    expect(
      resxFile([{ name: "A", file: "Images/A.png", kind: "bytes" }]),
    ).toContain(
      `${alias}\n  <data name="A" type="System.Resources.ResXFileRef, System.Windows.Forms">\n`,
    );
  });
});

describe("extensionOf", () => {
  it.each([
    [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0], ".png"],
    [[0xff, 0xd8, 0xff, 0xe0], ".jpg"],
    [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], ".gif"],
    [[0x42, 0x4d, ...new Array<number>(12).fill(0)], ".bmp"],
    [[0, 0, 1, 0, 1, 0], ".ico"],
    [[...text("café\r\n\tnotes")], ".txt"],
    [[0x00, 0x01, 0x02], ".bin"],
    [[0xc3, 0x28], ".bin"],
    [[], ".bin"],
  ])("gives %j the extension %s", (bytes, extension) => {
    expect(extensionOf(new Uint8Array(bytes))).toBe(extension);
  });
});

describe("projectFile, with resources", () => {
  const project = {
    assemblyName: "App",
    rootNamespace: "App",
    targetFramework: "net8.0",
    outputType: "Exe",
    allowUnsafeBlocks: false,
    nullable: null,
  } as const;

  it("lists each resource under its logical name, private ones private, and keeps the SDK from compiling a file embedded as it is", () => {
    expect(
      projectFile({
        ...project,
        embeddedResources: [
          {
            include: "Phrases/Menu.resx",
            logicalName: "App.Phrases.Menu.resources",
            public: true,
            kind: "resx",
          },
          {
            include: "secret",
            logicalName: "secret",
            public: false,
            kind: "file",
          },
          {
            include: "Template.cs",
            logicalName: "App.Template.cs",
            public: true,
            kind: "file",
          },
          {
            include: "Form.resx",
            logicalName: "App.Form.resx",
            public: true,
            kind: "file",
          },
          {
            include: "100%;$(x)@'s*.txt",
            logicalName: 'a "<&>" b',
            public: true,
            kind: "file",
          },
        ],
      }),
    ).toBe(
      [
        '<Project Sdk="Microsoft.NET.Sdk">',
        "",
        "  <PropertyGroup>",
        "    <AssemblyName>App</AssemblyName>",
        "    <RootNamespace>App</RootNamespace>",
        "    <OutputType>Exe</OutputType>",
        "    <TargetFramework>net8.0</TargetFramework>",
        "    <LangVersion>12.0</LangVersion>",
        "    <!-- Properties/AssemblyInfo.cs declares the original's assembly attributes. -->",
        "    <GenerateAssemblyInfo>false</GenerateAssemblyInfo>",
        "    <!-- Each resource is listed below, under the name the original gives it. -->",
        "    <EnableDefaultEmbeddedResourceItems>false</EnableDefaultEmbeddedResourceItems>",
        "  </PropertyGroup>",
        "",
        "  <ItemGroup>",
        "    <!-- The original's resources: each .resx compiles back to the .resources file it was; any other file is embedded as it is. -->",
        '    <EmbeddedResource Include="Phrases\\Menu.resx" LogicalName="App.Phrases.Menu.resources" />',
        '    <EmbeddedResource Include="secret" LogicalName="secret" Access="Private" />',
        '    <EmbeddedResource Include="Template.cs" LogicalName="App.Template.cs" />',
        '    <EmbeddedResource Include="Form.resx" LogicalName="App.Form.resx" Type="Non-Resx" />',
        '    <EmbeddedResource Include="100%25%3B%24(x)%40%27s%2A.txt" LogicalName="a &quot;&lt;&amp;&gt;&quot; b" />',
        "  </ItemGroup>",
        "",
        "  <ItemGroup>",
        "    <!-- Resources, not sources. -->",
        '    <Compile Remove="Template.cs" />',
        "  </ItemGroup>",
        "",
        "</Project>",
        "",
      ].join("\n"),
    );
  });

  it("leaves the SDK's own resources be in a project with none", () => {
    expect(projectFile(project)).not.toContain("EmbeddedResource");
    expect(projectFile({ ...project, embeddedResources: [] })).not.toContain(
      "EmbeddedResource",
    );
  });
});
