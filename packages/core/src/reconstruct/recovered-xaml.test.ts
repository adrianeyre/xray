import { describe, expect, it } from "vitest";

import type { ManifestResource } from "./recovered-resources.js";
import { SourceLayout, type DecompiledType } from "./recovered-solution.js";
import {
  placeCodeBehind,
  planXaml,
  wpfResourcesToSplit,
  type WpfResources,
  type WpfXaml,
  type XamlDocument,
} from "./recovered-xaml.js";

const bytes = (text: string) => new TextEncoder().encode(text);

function document(
  entry: string,
  type: string | null = null,
  applicationDefinition = false,
): XamlDocument {
  return {
    entry,
    class: type,
    applicationDefinition,
    code: `<Page x:Class="${type ?? ""}" />\n`,
  };
}

function wpf(
  documents: readonly XamlDocument[],
  others: readonly string[] = [],
): { xaml: WpfXaml; resources: ManifestResource[] } {
  return {
    xaml: { resource: "App.g.resources", documents, notDecompiled: null },
    resources: [
      {
        name: "App.g.resources",
        public: true,
        location: "embedded",
        linkedTo: null,
        data: null,
        entries: [
          ...documents.map(({ entry }) => ({
            name: entry,
            kind: "stream" as const,
            value: bytes(`BAML of ${entry}`),
          })),
          ...others.map((name) => ({
            name,
            kind: "stream" as const,
            value: bytes(name),
          })),
        ],
        notDecoded: null,
      },
    ],
  };
}

function split(
  documents: readonly XamlDocument[],
  others: readonly string[] = [],
): WpfResources {
  const { xaml, resources } = wpf(documents, others);
  const splittable = wpfResourcesToSplit(xaml, resources);
  if (splittable === null || !("xaml" in splittable)) {
    throw new Error("Expected WPF resources to split.");
  }
  return splittable;
}

function type(namespace: string, name: string): DecompiledType {
  return {
    namespace,
    name,
    code: "",
    sourceFile: null,
    sourcePath: null,
    declares: [{ namespace, name }],
  };
}

describe("wpfResourcesToSplit", () => {
  it("is null for an Assembly without BAML", () => {
    expect(wpfResourcesToSplit(null, [])).toBeNull();
    expect(wpfResourcesToSplit(undefined, [])).toBeNull();
  });

  it("is the WPF resources, every BAML entry decompiled, and every entry read", () => {
    const { xaml, resources } = wpf(
      [document("app.baml", "App.App", true)],
      ["images/logo.png"],
    );

    expect(wpfResourcesToSplit(xaml, resources)).toEqual({
      xaml,
      resource: resources[0],
    });
  });

  it("says why not, and what comes of it, where the engine did not decompile the BAML", () => {
    const { resources } = wpf([]);

    expect(
      wpfResourcesToSplit(
        {
          resource: "App.g.resources",
          documents: [],
          notDecompiled: 'Its entry "app.baml" could not be decompiled: boom.',
        },
        resources,
      ),
    ).toEqual({
      notRecovered:
        'App.g.resources\'s BAML was not decompiled. Its entry "app.baml" could not be decompiled: boom. It is embedded as it is, and the classes it names keep the code the markup compiler generated of their XAML, which loads it; but the project has no XAML to change.',
    });
  });

  it("says why not where the WPF resources cannot be split, though their BAML was decompiled", () => {
    const { xaml, resources } = wpf([document("app.baml", "App.App", true)]);
    const [resource] = resources as [ManifestResource];
    const consequence =
      "It is kept as it is, but the classes its XAML names leave out the code the markup compiler generated of it, so the project may not build.";

    expect(
      wpfResourcesToSplit(xaml, [
        { ...resource, entries: null, notDecoded: "Its entry is odd." },
      ]),
    ).toEqual({
      notRecovered: `App.g.resources's entries could not be read. Its entry is odd. ${consequence}`,
    });
    expect(
      wpfResourcesToSplit(xaml, [
        { ...resource, location: "file", linkedTo: "App.g.resources" },
      ]),
    ).toEqual({
      notRecovered: `App.g.resources is not embedded in the Assembly. ${consequence}`,
    });
    expect(wpfResourcesToSplit({ ...xaml, documents: [] }, resources)).toEqual({
      notRecovered: `App.g.resources's entry "app.baml" was not decompiled. ${consequence}`,
    });
  });
});

describe("placeCodeBehind", () => {
  it("places each class's file beside its XAML file, named after it, in the case of its namespace's folders", () => {
    const layout = new SourceLayout("App");
    const types = [type("App", "App"), type("App.Views", "MainWindow")];

    const placed = placeCodeBehind(
      split([
        document("app.baml", "App.App", true),
        document("views/mainwindow.baml", "App.Views.MainWindow"),
      ]),
      types,
      [null, null],
      layout,
    );

    expect([...placed]).toEqual([
      [0, { class: "App.App", xaml: "App.xaml", source: "App.xaml.cs" }],
      [
        1,
        {
          class: "App.Views.MainWindow",
          xaml: "Views/MainWindow.xaml",
          source: "Views/MainWindow.xaml.cs",
        },
      ],
    ]);
  });

  it("takes the case of the path its PDB records", () => {
    const placed = placeCodeBehind(
      split([document("ui/shellwindow.baml", "App.Shell")]),
      [type("App", "Shell")],
      [["UI", "ShellWindow.xaml.cs"]],
      new SourceLayout("App"),
    );

    expect(placed.get(0)).toEqual({
      class: "App.Shell",
      xaml: "UI/ShellWindow.xaml",
      source: "UI/ShellWindow.xaml.cs",
    });
  });

  it("places the class where its entry says, as it names it, where neither its namespace nor its PDB does", () => {
    const placed = placeCodeBehind(
      split([document("pages/home.baml", "App.Shell")]),
      [type("App", "Shell")],
      [null],
      new SourceLayout("App"),
    );

    expect(placed.get(0)).toEqual({
      class: "App.Shell",
      xaml: "pages/home.xaml",
      source: "pages/home.xaml.cs",
    });
  });
});

describe("planXaml", () => {
  it("lists the ApplicationDefinition, then each Page, then each Resource, in the order the WPF resources hold them", () => {
    const resources = split(
      [
        document("themes/colors.baml"),
        document("mainwindow.baml", "App.MainWindow"),
        document("app.baml", "App.App", true),
      ],
      ["images/logo.png"],
    );
    const types = [type("App", "App"), type("App", "MainWindow")];
    const layout = new SourceLayout("App");
    const codeBehind = placeCodeBehind(resources, types, [null, null], layout);

    const planned = planXaml(resources, codeBehind, layout, []);

    expect(planned.items).toEqual([
      { itemType: "ApplicationDefinition", include: "App.xaml" },
      { itemType: "Page", include: "themes/colors.xaml" },
      { itemType: "Page", include: "MainWindow.xaml" },
      { itemType: "Resource", include: "images/logo.png" },
    ]);
    expect(planned.files).toContainEqual({
      path: "images/logo.png",
      contents: bytes("images/logo.png"),
    });
    expect(planned.files).toContainEqual({
      path: "MainWindow.xaml",
      contents: '<Page x:Class="App.MainWindow" />\n',
    });
    expect(planned.resource).toEqual({
      name: "App.g.resources",
      culture: null,
      public: true,
      recoveredAs: "xaml",
      path: null,
      reason: null,
    });
  });

  it("gives a second document naming a class already placed a file of its own", () => {
    const resources = split([
      document("mainwindow.baml", "App.MainWindow"),
      document("mainwindow2.baml", "App.MainWindow"),
    ]);
    const types = [type("App", "MainWindow")];
    const layout = new SourceLayout("App");
    const codeBehind = placeCodeBehind(resources, types, [null], layout);

    const planned = planXaml(resources, codeBehind, layout, []);

    expect(planned.items.map(({ include }) => include)).toEqual([
      "MainWindow.xaml",
      "mainwindow2.xaml",
    ]);
  });

  it("names each file in the case another refers to it by, in quotes, after an assembly's ;component/ or an app's ,,,/", () => {
    const resources = split(
      [document("themes/colors.baml")],
      ["images/logo.png", "assets/icon.ico", "fonts/serif.ttf"],
    );
    const layout = new SourceLayout("App");

    const planned = planXaml(resources, new Map(), layout, [
      '<ResourceDictionary Source="Themes/Colors.xaml" />',
      '<Image Source="/App;component/Images/Logo.png" />',
      'new Uri("pack://application:,,,/Assets/Icon.ico")',
      // Not a whole path: the case is not taken from it.
      '"OldFonts/Serif.ttf"',
    ]);

    expect(planned.items.map(({ include }) => include)).toEqual([
      "Themes/Colors.xaml",
      "Images/Logo.png",
      "Assets/Icon.ico",
      "fonts/serif.ttf",
    ]);
  });

  it("puts a file in the case of a folder already claimed, and its name as the entry escapes it", () => {
    const layout = new SourceLayout("App");
    layout.claimPath(["Views", "MainWindow.xaml.cs"]);

    const planned = planXaml(
      split([], ["views/my%20logo.png"]),
      new Map(),
      layout,
      [],
    );

    expect(planned.items).toEqual([
      { itemType: "Resource", include: "Views/my logo.png" },
    ]);
  });
});
