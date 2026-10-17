import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSolution } from "./build-solution.js";

// These run the real `dotnet build` on a solution of two projects, one
// referencing the other, as a Recovered Solution with a Sibling Assembly is.

const BUILD_TIMEOUT_MS = 5 * 60_000;

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5 })),
  );
});

const FILES: Record<string, string> = {
  "Shop.sln": [
    "",
    "Microsoft Visual Studio Solution File, Format Version 12.00",
    "# Visual Studio Version 17",
    'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Shop", "Shop\\Shop.csproj", "{0F6D4F4E-8B1A-4C55-9A9E-1B2F0D6A0001}"',
    "EndProject",
    'Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "Shop.Core", "Shop.Core\\Shop.Core.csproj", "{0F6D4F4E-8B1A-4C55-9A9E-1B2F0D6A0002}"',
    "EndProject",
    "Global",
    "\tGlobalSection(SolutionConfigurationPlatforms) = preSolution",
    "\t\tDebug|Any CPU = Debug|Any CPU",
    "\tEndGlobalSection",
    "\tGlobalSection(ProjectConfigurationPlatforms) = postSolution",
    ...["0001", "0002"].flatMap((id) => [
      `\t\t{0F6D4F4E-8B1A-4C55-9A9E-1B2F0D6A${id}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU`,
      `\t\t{0F6D4F4E-8B1A-4C55-9A9E-1B2F0D6A${id}}.Debug|Any CPU.Build.0 = Debug|Any CPU`,
    ]),
    "\tEndGlobalSection",
    "EndGlobal",
    "",
  ].join("\r\n"),
  "Shop/Shop.csproj": [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup>",
    "    <OutputType>Exe</OutputType>",
    "    <TargetFramework>net8.0</TargetFramework>",
    "  </PropertyGroup>",
    "  <ItemGroup>",
    '    <ProjectReference Include="..\\Shop.Core\\Shop.Core.csproj" />',
    "  </ItemGroup>",
    "</Project>",
    "",
  ].join("\n"),
  "Shop/Program.cs":
    "internal static class Program\n{\n\tprivate static int Main() => Shop.Core.Basket.Count;\n}\n",
  "Shop.Core/Shop.Core.csproj": [
    '<Project Sdk="Microsoft.NET.Sdk">',
    "  <PropertyGroup>",
    "    <TargetFramework>net8.0</TargetFramework>",
    "  </PropertyGroup>",
    "</Project>",
    "",
  ].join("\n"),
  "Shop.Core/Basket.cs":
    "namespace Shop.Core;\n\npublic static class Basket\n{\n\tpublic const int Count = 0;\n}\n",
};

describe("buildSolution", () => {
  it(
    "builds a solution reached through a link, as macOS's temporary folder is",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "xray-build-solution-"));
      temporary.push(folder);
      const real = join(folder, "real");
      for (const [path, contents] of Object.entries(FILES)) {
        const target = join(real, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents);
      }
      // `/var` is a link to `/private/var` on macOS. A junction on Windows,
      // which needs no privilege to make.
      const link = join(folder, "link");
      await symlink(real, link, "junction");

      const build = await buildSolution(join(link, "Shop.sln"));

      expect(build.succeeded, build.output).toBe(true);
      expect(build.diagnostics).toEqual([]);
    },
    BUILD_TIMEOUT_MS,
  );
});
