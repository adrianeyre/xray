import { basename, dirname } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { serve } from "./serve.mjs";

// Answers "classify", "inspect", "decompile" and "resources" by the file's name
// alone (a satellite assembly's by its culture's folder too, `fr/app.resources.dll`),
// never reading it or the PDB beside it, with C# that the real `dotnet build`
// compiles. Like the real engine, "decompile" sends a progress line before
// each type it answers with. A file with no "resources" of its own has none.

const managed = { result: { kind: "managed-assembly", machine: "I386" } };

const RUNTIME = {
  version: "8.0.0.0",
  culture: null,
  publicKeyToken: "b03f5f7f11d50a3a",
};

/** What the real engine reads from a .NET 8 console program named App. */
const app = {
  assembly: {
    name: "App",
    version: "1.2.3.4",
    culture: null,
    publicKeyToken: null,
  },
  references: [
    { name: "System.Console", ...RUNTIME },
    { name: "System.Runtime", ...RUNTIME },
  ],
  targetFramework: ".NETCoreApp,Version=v8.0",
  targetPlatform: null,
  runtimeVersion: "v4.0.30319",
  machine: "I386",
  pe32Plus: false,
  corFlags: { ilOnly: true, requires32Bit: false, prefers32Bit: false },
  subsystem: "windows-cui",
  entryPoint: { type: "App.Program", method: "Main" },
  typeCount: 5,
  methodCount: 6,
  resourceCount: 0, // Nothing an obfuscator leaves: its names and strings are its source's.
  obfuscation: {
    attributes: [
      "System.Runtime.CompilerServices.CompilationRelaxationsAttribute",
      "System.Runtime.Versioning.TargetFrameworkAttribute",
    ],
    names: {
      count: 5,
      unprintable: 0,
      short: 0,
      unprintableExamples: [],
      shortExamples: [],
    },
    strings: { literals: 3, decoderCalls: 0, decoderTypes: [] },
  },
};

/** Types in the root namespace, below it, outside it and in none, and two that share a name. */
const types = [
  {
    namespace: "App",
    name: "Program",
    code: "using System;\nusing App.Models;\nusing Tools.Text;\n\nnamespace App;\n\ninternal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\tConsole.WriteLine(Shouter.Shout(new Point(1, 2).ToString() + new Point<int>(3).Value + GlobalHelper.Answer()));\n\t\treturn 0;\n\t}\n}\n",
  },
  {
    namespace: "App.Models",
    name: "Point",
    code: "namespace App.Models;\n\ninternal record Point(int X, int Y);\n",
  },
  {
    namespace: "App.Models",
    name: "Point`1",
    code: "namespace App.Models;\n\ninternal sealed class Point<T>\n{\n\tpublic T Value { get; }\n\n\tpublic Point(T value)\n\t{\n\t\tValue = value;\n\t}\n}\n",
  },
  {
    namespace: "Tools.Text",
    name: "Shouter",
    code: 'namespace Tools.Text;\n\ninternal static class Shouter\n{\n\tpublic static string Shout(string text)\n\t{\n\t\treturn text.ToUpperInvariant() + "!";\n\t}\n}\n',
  },
  {
    namespace: "",
    name: "GlobalHelper",
    code: "internal static class GlobalHelper\n{\n\tpublic static int Answer()\n\t{\n\t\treturn 42;\n\t}\n}\n",
  },
];

const decompiled = {
  assemblyAttributes:
    'using System.Reflection;\n\n[assembly: AssemblyVersion("1.2.3.4")]\n[assembly: AssemblyTitle("App")]\n',
  unsafeCode: false,
  nullableAnnotations: false,
  types,
};

/** A type, as decompiled with a PDB recording it was declared at `sourcePath`. */
function withSource(type, sourcePath) {
  return {
    ...type,
    sourcePath,
    declares: [{ namespace: type.namespace, name: type.name }],
  };
}

/** The decompiled App, with `body` as the whole of `Main`. */
function withMain(body) {
  return {
    ...decompiled,
    types: types.map((type) =>
      type.name === "Program"
        ? {
            ...type,
            code: `using System;\n\nnamespace App;\n\ninternal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\t${body}\n\t}\n}\n`,
          }
        : type,
    ),
  };
}

const files = {
  "app.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: { result: decompiled },
  },
  // Decompiles to C# that does not compile.
  "broken.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: {
        ...decompiled,
        types: types.map((type) =>
          type.name === "Shouter"
            ? { ...type, code: type.code.replace('+ "!";', '+ "!"') }
            : type,
        ),
      },
    },
  },
  // Takes 600 ms over each type, so decompiling takes 3 s.
  "slow.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: { result: decompiled },
    msPerType: 600,
  },
  "native.exe": {
    classify: { result: { kind: "native-executable", machine: "Amd64" } },
  },
  "missing.dll": {
    classify: {
      error: { code: "file-not-found", message: "There is no file." },
    },
  },
  // A .NET Framework 3.5 library, from before TargetFrameworkAttribute: its
  // CLR and its reference to System.Core 3.5 tell its framework.
  "legacy.dll": {
    classify: managed,
    inspect: {
      result: {
        ...app,
        assembly: { ...app.assembly, name: "Legacy" },
        references: [
          {
            name: "mscorlib",
            version: "2.0.0.0",
            culture: null,
            publicKeyToken: "b77a5c561934e089",
          },
          {
            name: "System.Core",
            version: "3.5.0.0",
            culture: null,
            publicKeyToken: "b77a5c561934e089",
          },
        ],
        targetFramework: null,
        runtimeVersion: "v2.0.50727",
        subsystem: "windows-gui",
        entryPoint: null,
        typeCount: 1,
        methodCount: 1,
      },
    },
    decompile: {
      result: {
        assemblyAttributes:
          'using System.Reflection;\n\n[assembly: AssemblyVersion("1.0.0.0")]\n',
        unsafeCode: false,
        nullableAnnotations: false,
        types: [
          {
            namespace: "Legacy",
            name: "Evens",
            code: "using System.Collections.Generic;\nusing System.Linq;\n\nnamespace Legacy;\n\npublic static class Evens\n{\n\tpublic static int Count(this IEnumerable<int> values)\n\t{\n\t\treturn values.Where((int value) => value % 2 == 0).Count();\n\t}\n}\n",
          },
        ],
      },
    },
  },
  "no-framework.dll": {
    classify: managed,
    inspect: { result: { ...app, targetFramework: null } },
    decompile: { result: decompiled },
  },
  "undecompilable.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      error: {
        code: "decompilation-failed",
        message: "Could not decompile App.Program: boom",
      },
    },
  },
  // Shouter uses a file-scoped type, declared in Shouting.cs.
  "file-scoped.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: {
        ...decompiled,
        types: types.map((type) =>
          type.name === "Shouter"
            ? {
                ...type,
                code: type.code
                  .replace(
                    'return text.ToUpperInvariant() + "!";',
                    "return Bang.After(text.ToUpperInvariant());",
                  )
                  .concat(
                    'file static class Bang\n{\n\tpublic static string After(string text)\n\t{\n\t\treturn text + "!";\n\t}\n}\n',
                  ),
                sourceFile: "Shouting",
              }
            : type,
        ),
      },
    },
  },
  "odd-source-file.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: {
        ...decompiled,
        types: types.map((type) => ({ ...type, sourceFile: "" })),
      },
    },
  },
  "odd.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: { result: { ...decompiled, types: [{ namespace: "App" }] } },
  },
  // A WinForms program, as its subsystem and references say, whose code is
  // the console program's, so it builds anywhere.
  "winforms.dll": {
    classify: managed,
    inspect: {
      result: {
        ...app,
        subsystem: "windows-gui",
        references: [
          ...app.references,
          { name: "System.Windows.Forms", ...RUNTIME },
        ],
      },
    },
    decompile: { result: decompiled },
  },
  // Throws, so the program it rebuilds to crashes when run.
  "crashes.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: withMain('throw new InvalidOperationException("boom");'),
    },
  },
  // Never exits, so the program it rebuilds to must be stopped.
  "hangs.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: withMain(
        "System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);\n\t\treturn 0;",
      ),
    },
  },
  // Has its own PDB beside it: decompiled with it, its types are laid out as
  // the original's source files were, both Points in one.
  "pdb.dll": {
    classify: managed,
    inspect: { result: app },
    pdb: { format: "portable", mismatch: null },
    decompile: { result: decompiled },
    decompileWithPdb: {
      result: {
        ...decompiled,
        types: [
          withSource(types[0], "/src/App/Program.cs"),
          {
            ...withSource(types[1], "/src/App/Geometry/Points.cs"),
            code: `${types[1].code}\n${types[2].code.replace("namespace App.Models;\n\n", "")}`,
            declares: [
              { namespace: "App.Models", name: "Point" },
              { namespace: "App.Models", name: "Point`1" },
            ],
          },
          withSource(types[3], "/src/App/Text/Shouter.cs"),
          withSource(types[4], "/src/App/GlobalHelper.cs"),
        ],
      },
    },
  },
  // Has another build's PDB beside it, which must not be decompiled with.
  "stale-pdb.dll": {
    classify: managed,
    inspect: { result: app },
    pdb: { format: "portable", mismatch: "other-build" },
    decompile: { result: decompiled },
    decompileWithPdb: {
      error: { code: "internal-error", message: "Given another build's PDB." },
    },
  },
  // Does not say whether the Assembly has unsafe code or nullable annotations.
  "unsaid.dll": {
    classify: managed,
    inspect: { result: app },
    decompile: {
      result: { assemblyAttributes: decompiled.assemblyAttributes, types },
    },
  },
};

/** Base64, as the engine sends bytes. */
function base64(text) {
  return Buffer.from(text).toString("base64");
}

// A PNG's signature and a little more, an image to the layout.
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]).toString("base64");

// App, with resources of every kind, and a French and a German satellite
// assembly beside it. App.Program has a .resx of its own.
files["resources.dll"] = {
  classify: managed,
  inspect: { result: app },
  decompile: { result: decompiled },
  resources: {
    result: {
      assembly: app.assembly,
      resources: [
        {
          name: "App.Strings.resources",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: null,
          entries: [
            { name: "Greeting", kind: "string", value: "Hello" },
            { name: "Lines", kind: "string", value: 'a\r\n<b> & "c"' },
          ],
          notDecoded: null,
        },
        {
          name: "App.Program.resources",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: null,
          entries: [
            { name: "Logo", kind: "bytes", value: PNG },
            { name: "Note", kind: "stream", value: base64("A note.\n") },
          ],
          notDecoded: null,
        },
        {
          name: "App.Limits.resources",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: base64("not really a .resources file"),
          entries: null,
          notDecoded:
            'Its entry "Max" is a System.Int32, not a string, a byte[] or a stream.',
        },
        {
          name: "App.Models.logo.png",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: PNG,
          entries: null,
          notDecoded: null,
        },
        {
          name: "secret",
          public: false,
          location: "embedded",
          linkedTo: null,
          data: base64("swordfish"),
          entries: null,
          notDecoded: null,
        },
        {
          name: "jquery.min.js",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: base64("var $;"),
          entries: null,
          notDecoded: null,
        },
        {
          name: "App.Template.cs",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: base64("class Template {}"),
          entries: null,
          notDecoded: null,
        },
        {
          name: "App.Linked.txt",
          public: true,
          location: "file",
          linkedTo: "Linked.txt",
          data: null,
          entries: null,
          notDecoded: null,
        },
      ],
    },
  },
};
files["fr/App.resources.dll"] = {
  classify: managed,
  resources: {
    result: {
      assembly: { ...app.assembly, name: "App.resources", culture: "fr" },
      resources: [
        {
          name: "App.Strings.fr.resources",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: null,
          entries: [{ name: "Greeting", kind: "string", value: "Bonjour" }],
          notDecoded: null,
        },
        {
          name: "App.notes.txt",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: base64("Notes"),
          entries: null,
          notDecoded: null,
        },
      ],
    },
  },
};
files["de/App.resources.dll"] = {
  classify: managed,
  resources: {
    result: {
      assembly: { ...app.assembly, name: "App.resources", culture: "de" },
      resources: [
        {
          name: "App.Strings.de.resources",
          public: true,
          location: "embedded",
          linkedTo: null,
          data: null,
          entries: [{ name: "Greeting", kind: "string", value: "Hallo" }],
          notDecoded: null,
        },
      ],
    },
  },
};
// In a culture's folder, but another culture's, so no satellite assembly of App's.
files["es/App.resources.dll"] = {
  classify: managed,
  resources: {
    result: {
      assembly: { ...app.assembly, name: "App.resources", culture: "it" },
      resources: [],
    },
  },
};

// An application of three Assemblies, Shop, Stock and Prices, each beside the
// others: Shop references both libraries, and Prices references Stock.

/** A reference to the application's own Assembly `name`, not strong-named. */
function own(name) {
  return { name, version: "1.0.0.0", culture: null, publicKeyToken: null };
}

/** A reference to a third party's assembly `name`, strong-named with its vendor's key. */
function vendors(name) {
  return { ...own(name), publicKeyToken: "51ca75d1f3633191" };
}

/** What the real engine reads from a .NET 8 Assembly `name`, a library unless given an entry point. */
function inspected(name, references, entryPoint = null) {
  return {
    ...app,
    assembly: own(name),
    references: [{ name: "System.Runtime", ...RUNTIME }, ...references],
    entryPoint,
    typeCount: 2,
  };
}

/** Decompiled C# of one type, `name`, in a namespace of the same name. */
function decompiledAs(name, type, code) {
  return {
    assemblyAttributes: `using System.Reflection;\n\n[assembly: AssemblyVersion("1.0.0.0")]\n[assembly: AssemblyTitle("${name}")]\n`,
    unsafeCode: false,
    nullableAnnotations: false,
    types: [
      { namespace: name, name: type, code: `namespace ${name};\n\n${code}` },
    ],
  };
}

const shopProgram = decompiledAs(
  "Shop",
  "Program",
  'internal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\tSystem.Console.WriteLine(Prices.Pricer.Price("apple") + Stock.Shelf.Count("pear"));\n\t\treturn 0;\n\t}\n}\n',
);

const siblingFiles = {
  "shop.dll": {
    classify: managed,
    inspect: {
      result: inspected(
        "Shop",
        [own("Prices"), { name: "System.Console", ...RUNTIME }, own("Stock")],
        {
          type: "Shop.Program",
          method: "Main",
        },
      ),
    },
    decompile: { result: shopProgram },
  },
  "stock.dll": {
    classify: managed,
    inspect: { result: inspected("Stock", []) },
    decompile: {
      result: decompiledAs(
        "Stock",
        "Shelf",
        "public static class Shelf\n{\n\tpublic static int Count(string item)\n\t{\n\t\treturn item.Length;\n\t}\n}\n",
      ),
    },
  },
  "prices.dll": {
    classify: managed,
    inspect: { result: inspected("Prices", [own("Stock")]) },
    decompile: {
      result: decompiledAs(
        "Prices",
        "Pricer",
        "public static class Pricer\n{\n\tpublic static decimal Price(string item)\n\t{\n\t\treturn Stock.Shelf.Count(item) * 1.5m;\n\t}\n}\n",
      ),
    },
  },
  // Loop and Ring reference one another, as no two projects can.
  "loop.dll": {
    classify: managed,
    inspect: {
      result: inspected("Loop", [own("Ring")], {
        type: "Loop.Program",
        method: "Main",
      }),
    },
    decompile: {
      result: decompiledAs(
        "Loop",
        "Program",
        "internal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\treturn Ring.Links.Count();\n\t}\n}\n",
      ),
    },
  },
  "ring.dll": {
    classify: managed,
    inspect: { result: inspected("Ring", [own("Loop")]) },
    decompile: {
      result: decompiledAs(
        "Ring",
        "Links",
        "public static class Links\n{\n\tpublic static int Count()\n\t{\n\t\treturn 0;\n\t}\n}\n",
      ),
    },
  },
  // Twin references Pair, of which there are two, Pair.dll and Pair.exe, and
  // Helper, whose file is a Native Executable.
  "twin.dll": {
    classify: managed,
    inspect: {
      result: inspected("Twin", [own("Helper"), own("Pair")], {
        type: "Twin.Program",
        method: "Main",
      }),
    },
    decompile: {
      result: decompiledAs(
        "Twin",
        "Program",
        "internal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\treturn Pair.Halves.Count();\n\t}\n}\n",
      ),
    },
  },
  "pair.dll": {
    classify: managed,
    inspect: { result: inspected("Pair", []) },
    decompile: {
      result: decompiledAs(
        "Pair",
        "Halves",
        "public static class Halves\n{\n\tpublic static int Count()\n\t{\n\t\treturn 2;\n\t}\n}\n",
      ),
    },
  },
  "pair.exe": {
    classify: managed,
    inspect: { result: inspected("Pair", []) },
  },
  "helper.dll": {
    classify: { result: { kind: "native-executable", machine: "Amd64" } },
  },
  // Till references Stock, its own, and Receipts, a third party's, strong-named
  // with its vendor's key, which is copied, so is never decompiled.
  "till.dll": {
    classify: managed,
    inspect: {
      result: inspected("Till", [own("Stock"), vendors("Receipts")], {
        type: "Till.Program",
        method: "Main",
      }),
    },
    decompile: {
      result: decompiledAs(
        "Till",
        "Program",
        "internal static class Program\n{\n\tprivate static int Main(string[] args)\n\t{\n\t\treturn Stock.Shelf.Count(Receipts.Printer.Print());\n\t}\n}\n",
      ),
    },
  },
  "receipts.dll": {
    classify: managed,
    inspect: {
      result: { ...inspected("Receipts", []), assembly: vendors("Receipts") },
    },
  },
  // A .NET 8 Windows Forms app, whose decompiled code says which folders it
  // was asked to find its references in too.
  "greeter.dll": {
    classify: managed,
    inspect: {
      result: {
        ...inspected(
          "Greeter",
          [{ name: "System.Windows.Forms", ...RUNTIME }],
          { type: "Greeter.Program", method: "Main" },
        ),
        targetPlatform: "Windows7.0",
        subsystem: "windows-gui",
      },
    },
    decompile: {
      result: decompiledAs(
        "Greeter",
        "Program",
        "internal static class Program\n{\n\tprivate static void Main()\n\t{\n\t}\n}\n",
      ),
    },
    echoesReferenceDirectories: true,
  },
};
Object.assign(files, siblingFiles);

// Tints, a .NET 8 WPF app, whose WPF resources hold the BAML of its App.xaml,
// Views/MainWindow.xaml and Themes/Colors.xaml, which the engine decompiled,
// and an image beside them; and a .resx of its own. The markup compiler named
// each entry after its file's path, lowercased.
const PRESENTATION = {
  version: "8.0.0.0",
  culture: null,
  publicKeyToken: "31bf3856ad364e35",
};
const wpfTypes = [
  {
    namespace: "Tints",
    name: "App",
    code: "using System.Windows;\n\nnamespace Tints;\n\npublic partial class App : Application\n{\n}\n",
    sourceFile: null,
    sourcePath: null,
    declares: [{ namespace: "Tints", name: "App" }],
  },
  {
    namespace: "Tints.Views",
    name: "MainWindow",
    code: "using System.Windows;\n\nnamespace Tints.Views;\n\npublic partial class MainWindow : Window\n{\n\tpublic MainWindow()\n\t{\n\t\tInitializeComponent();\n\t}\n}\n",
    sourceFile: null,
    sourcePath: null,
    declares: [{ namespace: "Tints.Views", name: "MainWindow" }],
  },
];
const XMLNS =
  'xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"';
const wpfXaml = {
  resource: "Tints.g.resources",
  documents: [
    {
      entry: "app.baml",
      class: "Tints.App",
      applicationDefinition: true,
      code: `<Application x:Class="Tints.App" ${XMLNS} StartupUri="Views/MainWindow.xaml">\n    <Application.Resources>\n        <ResourceDictionary Source="Themes/Colors.xaml" />\n    </Application.Resources>\n</Application>\n`,
    },
    {
      entry: "views/mainwindow.baml",
      class: "Tints.Views.MainWindow",
      applicationDefinition: false,
      code: `<Window x:Class="Tints.Views.MainWindow" ${XMLNS} Icon="/Tints;component/Images/Logo.png" />\n`,
    },
    {
      entry: "themes/colors.baml",
      class: null,
      applicationDefinition: false,
      code: `<ResourceDictionary ${XMLNS}>\n    <SolidColorBrush x:Key="Ink" Color="Navy" />\n</ResourceDictionary>\n`,
    },
  ],
  notDecompiled: null,
};
const wpfInspected = {
  ...inspected("Tints", [{ name: "PresentationFramework", ...PRESENTATION }], {
    type: "Tints.App",
    method: "Main",
  }),
  targetPlatform: "Windows7.0",
  subsystem: "windows-gui",
};
const wpfResources = {
  result: {
    assembly: wpfInspected.assembly,
    resources: [
      {
        name: "Tints.g.resources",
        public: true,
        location: "embedded",
        linkedTo: null,
        data: null,
        entries: [
          { name: "app.baml", kind: "stream", value: base64("BAML of App") },
          { name: "images/logo.png", kind: "stream", value: PNG },
          {
            name: "themes/colors.baml",
            kind: "stream",
            value: base64("BAML of Colors"),
          },
          {
            name: "views/mainwindow.baml",
            kind: "stream",
            value: base64("BAML of MainWindow"),
          },
        ],
        notDecoded: null,
      },
      {
        name: "Tints.Strings.resources",
        public: true,
        location: "embedded",
        linkedTo: null,
        data: null,
        entries: [{ name: "Greeting", kind: "string", value: "Hello" }],
        notDecoded: null,
      },
    ],
  },
};
files["tints.dll"] = {
  classify: managed,
  inspect: { result: wpfInspected },
  decompile: {
    result: {
      ...decompiledAs("Tints", "Program", ""),
      types: wpfTypes,
      xaml: wpfXaml,
    },
  },
  resources: wpfResources,
};
// Tints, whose BAML the engine could not decompile, so its classes keep what
// the markup compiler generated of them.
files["tints-undecompiled.dll"] = {
  ...files["tints.dll"],
  decompile: {
    result: {
      ...decompiledAs("Tints", "Program", ""),
      types: wpfTypes,
      xaml: {
        resource: "Tints.g.resources",
        documents: [],
        notDecompiled: 'Its entry "app.baml" could not be decompiled: boom.',
      },
    },
  },
};

serve(async (request) => {
  if (
    !["classify", "inspect", "decompile", "resources"].includes(request.command)
  ) {
    return undefined;
  }
  if (
    request.command === "decompile" &&
    request.params.languageVersion !== "12.0"
  ) {
    return {
      id: request.id,
      error: { code: "invalid-params", message: "Expected C# 12.0." },
    };
  }
  const file =
    files[
      `${basename(dirname(request.params.path))}/${basename(request.params.path)}`
    ] ?? files[basename(request.params.path)];
  const withPdb = request.params.pdbPath !== undefined;
  // Asked to check a PDB, it says what the file's entry does of it, or that it
  // is the Assembly's own; asked to decompile with one, it answers as its
  // entry does with a PDB, if it says.
  const answer =
    request.command === "inspect" && withPdb && file?.inspect?.result
      ? {
          result: {
            ...file.inspect.result,
            pdb: file.pdb ?? { format: "portable", mismatch: null },
          },
        }
      : request.command === "decompile" && withPdb && file?.decompileWithPdb
        ? file.decompileWithPdb
        : request.command === "resources" &&
            file?.resources === undefined &&
            file?.inspect?.result
          ? {
              result: { assembly: file.inspect.result.assembly, resources: [] },
            }
          : file?.[request.command];
  const echoed =
    request.command === "decompile" && file?.echoesReferenceDirectories
      ? {
          result: {
            ...answer.result,
            types: answer.result.types.map((type) => ({
              ...type,
              code: `// referenceDirectories: ${JSON.stringify(request.params.referenceDirectories ?? null)}\n${type.code}`,
            })),
          },
        }
      : answer;
  const reply = echoed ?? {
    error: {
      code: "internal-error",
      message: `The fake engine has no answer to "${request.command}" for this file.`,
    },
  };
  const types =
    request.command === "decompile" && Array.isArray(reply.result?.types)
      ? reply.result.types.flatMap((type) => type.declares ?? [type])
      : [];
  for (const [done, type] of types.entries()) {
    const current =
      type.namespace === "" ? type.name : `${type.namespace}.${type.name}`;
    process.stdout.write(
      `${JSON.stringify({ id: request.id, progress: { done, total: types.length, current } })}\n`,
    );
    await sleep(file.msPerType ?? 0);
  }
  return { id: request.id, ...reply };
});
