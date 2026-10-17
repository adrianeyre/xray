import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  listDotnetSdks,
  newestFirst,
  parseSdkList,
  sdkMajor,
} from "./dotnet-sdks.js";

describe("parseSdkList", () => {
  it("reads each `<version> [<path>]` line", () => {
    expect(
      parseSdkList(
        "6.0.428 [/usr/share/dotnet/sdk]\n8.0.425 [/usr/share/dotnet/sdk]\n",
      ),
    ).toEqual([
      { version: "6.0.428", path: "/usr/share/dotnet/sdk" },
      { version: "8.0.425", path: "/usr/share/dotnet/sdk" },
    ]);
  });

  it("reads Windows output, with CRLF line endings and spaces in the path", () => {
    expect(
      parseSdkList(
        "8.0.425 [C:\\Program Files\\dotnet\\sdk]\r\n10.0.100-rc.2.25502.107 [C:\\Program Files\\dotnet\\sdk]\r\n",
      ),
    ).toEqual([
      { version: "8.0.425", path: "C:\\Program Files\\dotnet\\sdk" },
      {
        version: "10.0.100-rc.2.25502.107",
        path: "C:\\Program Files\\dotnet\\sdk",
      },
    ]);
  });

  it("finds no SDKs in empty output or lines that are not SDKs", () => {
    expect(parseSdkList("")).toEqual([]);
    expect(parseSdkList("Welcome to .NET!\nA fatal error occurred.\n")).toEqual(
      [],
    );
  });
});

describe("newestFirst", () => {
  it("orders by major, minor and patch numerically, previews below their release", () => {
    const sdks = [
      "8.0.100",
      "10.0.100-rc.2.25502.107",
      "8.0.425",
      "9.0.100",
      "10.0.100",
      "10.0.100-rc.1.25451.107",
      "8.0.99",
    ].map((version) => ({ version, path: "" }));

    expect(newestFirst(sdks).map((sdk) => sdk.version)).toEqual([
      "10.0.100",
      "10.0.100-rc.2.25502.107",
      "10.0.100-rc.1.25451.107",
      "9.0.100",
      "8.0.425",
      "8.0.100",
      "8.0.99",
    ]);
  });
});

describe("sdkMajor", () => {
  it("is the leading version number", () => {
    expect(sdkMajor({ version: "8.0.425", path: "" })).toBe(8);
    expect(sdkMajor({ version: "10.0.100-rc.2", path: "" })).toBe(10);
  });
});

describe("listDotnetSdks (against the real dotnet)", () => {
  it("lists the .NET SDK 8 or later this repository builds with", async () => {
    const sdks = await listDotnetSdks("dotnet");

    expect(sdks).toBeDefined();
    expect(sdks?.some((sdk) => sdkMajor(sdk) >= 8)).toBe(true);
  });

  it("resolves undefined when dotnet is not there", async () => {
    await expect(
      listDotnetSdks(join(tmpdir(), "no-such-dir", "dotnet")),
    ).resolves.toBeUndefined();
  });
});
