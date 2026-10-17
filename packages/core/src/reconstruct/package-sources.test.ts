import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { zip } from "./fakes/zip.js";
import { nupkgEntries, readNupkgEntry, type NupkgEntry } from "./nupkg.js";
import {
  defaultGlobalPackagesFolder,
  globalPackagesFolder,
  nugetOrg,
  type NuGetOrg,
} from "./package-sources.js";

const cleanUp: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  await Promise.all(cleanUp.splice(0).map((clean) => clean()));
});

async function scratch(): Promise<string> {
  const folder = await mkdtemp(join(tmpdir(), "xray-package-sources-"));
  cleanUp.push(() => rm(folder, { recursive: true, force: true }));
  return folder;
}

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

describe("nupkgEntries and readNupkgEntry", () => {
  it("read every file of a .nupkg, stored or deflated, unescaping its path", () => {
    const archive = zip({
      "Newtonsoft.Json.nuspec": "<package />",
      "lib/net6.0/Newtonsoft.Json.dll": "the assembly",
      "content/a%20b%2Bc.txt": "escaped",
    });

    const entries = nupkgEntries(archive);

    expect(entries.map(({ path }) => path)).toEqual([
      "Newtonsoft.Json.nuspec",
      "lib/net6.0/Newtonsoft.Json.dll",
      "content/a b+c.txt",
    ]);
    expect(
      entries.map((entry) => readNupkgEntry(archive, entry).toString()),
    ).toEqual(["<package />", "the assembly", "escaped"]);
  });

  it("refuses what is not a zip, or is cut short", () => {
    expect(() => nupkgEntries(Buffer.from("not a zip"))).toThrow(
      "It is not a zip archive.",
    );
    const archive = zip({ "lib/net6.0/A.dll": "the assembly" });
    const [entry] = nupkgEntries(archive) as [NupkgEntry];
    expect(() => readNupkgEntry(archive.subarray(0, 40), entry)).toThrow(
      "lib/net6.0/A.dll is cut short.",
    );
  });
});

describe("defaultGlobalPackagesFolder", () => {
  it("is NUGET_PACKAGES if set, else .nuget/packages in the home folder", () => {
    expect(defaultGlobalPackagesFolder({ NUGET_PACKAGES: "/cache" })).toBe(
      "/cache",
    );
    expect(defaultGlobalPackagesFolder({})).toBe(
      join(homedir(), ".nuget", "packages"),
    );
  });
});

describe("globalPackagesFolder", () => {
  /** Lays a version of a package out as NuGet restores it; `complete` once its .nupkg.metadata is written. */
  async function restore(
    root: string,
    id: string,
    version: string,
    files: Readonly<Record<string, string>>,
    complete = true,
  ): Promise<void> {
    const folder = join(root, id.toLowerCase(), version);
    await mkdir(folder, { recursive: true });
    if (complete) {
      await writeFile(join(folder, ".nupkg.metadata"), "{}");
    }
    for (const [path, contents] of Object.entries(files)) {
      await mkdir(join(folder, path, ".."), { recursive: true });
      await writeFile(join(folder, path), contents);
    }
  }

  it("lists the versions of a package NuGet has finished extracting", async () => {
    const root = await scratch();
    await restore(root, "Newtonsoft.Json", "13.0.3", {});
    await restore(root, "Newtonsoft.Json", "13.0.1", {});
    await restore(root, "Newtonsoft.Json", "13.0.2", {}, false);
    const cache = globalPackagesFolder(root);

    expect(await cache.versions("Newtonsoft.Json")).toEqual([
      "13.0.1",
      "13.0.3",
    ]);
    expect(await cache.versions("Serilog")).toEqual([]);
  });

  it("finds the files of a name, ignoring case, in each of a version's lib folders", async () => {
    const root = await scratch();
    await restore(root, "Newtonsoft.Json", "13.0.3", {
      "lib/net6.0/Newtonsoft.Json.dll": "for net6.0",
      "lib/netstandard2.0/newtonsoft.json.DLL": "for netstandard2.0",
      "lib/net6.0/Newtonsoft.Json.xml": "docs",
      "ref/net6.0/Newtonsoft.Json.dll": "a reference assembly",
    });
    const cache = globalPackagesFolder(root);

    expect(
      await cache.assemblies(
        "newtonsoft.json",
        "13.0.3",
        "Newtonsoft.Json.dll",
      ),
    ).toEqual([
      {
        path: "lib/net6.0/Newtonsoft.Json.dll",
        localPath: join(
          root,
          "newtonsoft.json",
          "13.0.3",
          "lib",
          "net6.0",
          "Newtonsoft.Json.dll",
        ),
        sha256: sha256("for net6.0"),
      },
      {
        path: "lib/netstandard2.0/newtonsoft.json.DLL",
        localPath: join(
          root,
          "newtonsoft.json",
          "13.0.3",
          "lib",
          "netstandard2.0",
          "newtonsoft.json.DLL",
        ),
        sha256: sha256("for netstandard2.0"),
      },
    ]);
  });

  it("finds a folder of a version where it is, ignoring the case of the package's id and version", async () => {
    const root = await scratch();
    await restore(root, "Microsoft.WindowsDesktop.App.Ref", "8.0.31", {
      "ref/net8.0/System.Windows.Forms.dll": "a reference assembly",
    });
    const cache = globalPackagesFolder(root);

    expect(
      await cache.folder(
        "Microsoft.WindowsDesktop.App.Ref",
        "8.0.31",
        "ref/net8.0",
      ),
    ).toBe(
      join(root, "microsoft.windowsdesktop.app.ref", "8.0.31", "ref", "net8.0"),
    );
    expect(
      await cache.folder(
        "Microsoft.WindowsDesktop.App.Ref",
        "8.0.31",
        "ref/net9.0",
      ),
    ).toBeNull();
    expect(
      await cache.folder(
        "Microsoft.WindowsDesktop.App.Ref",
        "8.0.30",
        "ref/net8.0",
      ),
    ).toBeNull();
  });
});

/** A request the fake feed was sent. */
interface Sent {
  readonly method: string;
  readonly url: string;
  readonly body: string;
  readonly headers: IncomingMessage["headers"];
}

/** A NuGet V3 feed on 127.0.0.1 holding `packages`, recording every request. */
async function feed(
  packages: Readonly<Record<string, Readonly<Record<string, Buffer>>>>,
): Promise<{ readonly index: string; readonly sent: Sent[] }> {
  const sent: Sent[] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const url = request.url ?? "";
      sent.push({
        method: request.method ?? "",
        url,
        body,
        headers: request.headers,
      });
      const json = (value: unknown) => {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify(value));
      };
      if (url === "/v3/index.json") {
        json({
          version: "3.0.0",
          resources: [
            { "@id": "https://elsewhere/query", "@type": "SearchQueryService" },
            { "@id": `${base}/flat`, "@type": "PackageBaseAddress/3.0.0" },
          ],
        });
        return;
      }
      const [, listed = ""] = /^\/flat\/([^/]+)\/index\.json$/.exec(url) ?? [];
      const [, id = "", version = ""] =
        /^\/flat\/([^/]+)\/([^/]+)\/\1\.\2\.nupkg$/.exec(url) ?? [];
      const versions = packages[listed];
      const nupkg = packages[id]?.[version];
      if (versions !== undefined) {
        json({ versions: Object.keys(versions) });
      } else if (nupkg !== undefined) {
        response.end(nupkg);
      } else {
        response.statusCode = 404;
        response.end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanUp.push(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { index: `${base}/v3/index.json`, sent };
}

describe("nugetOrg", () => {
  function asked(index: string): NuGetOrg {
    const source = nugetOrg({ serviceIndex: index });
    cleanUp.push(() => source.dispose());
    return source;
  }

  it("lists a package's versions, from the package base address its service index names", async () => {
    const { index } = await feed({
      "newtonsoft.json": { "13.0.1": zip({}), "13.0.3": zip({}) },
    });
    const source = asked(index);

    expect(await source.versions("Newtonsoft.Json")).toEqual([
      "13.0.1",
      "13.0.3",
    ]);
    expect(await source.versions("NoSuchPackage")).toEqual([]);
  });

  it("downloads a version's .nupkg and takes the files of a name out of its lib folders, deleting them once disposed", async () => {
    const { index } = await feed({
      "newtonsoft.json": {
        "13.0.3": zip({
          "Newtonsoft.Json.nuspec": "<package />",
          "lib/net6.0/Newtonsoft.Json.dll": "for net6.0",
          "lib/netstandard2.0/Newtonsoft.Json.dll": "for netstandard2.0",
          "lib/net6.0/Newtonsoft.Json.xml": "docs",
          "tools/Newtonsoft.Json.dll": "not a lib",
        }),
      },
    });
    const source = asked(index);

    const files = await source.assemblies(
      "Newtonsoft.Json",
      "13.0.3",
      "Newtonsoft.Json.dll",
    );

    expect(files.map(({ path, sha256 }) => ({ path, sha256 }))).toEqual([
      { path: "lib/net6.0/Newtonsoft.Json.dll", sha256: sha256("for net6.0") },
      {
        path: "lib/netstandard2.0/Newtonsoft.Json.dll",
        sha256: sha256("for netstandard2.0"),
      },
    ]);
    expect(
      await Promise.all(
        files.map(({ localPath }) => readFile(localPath, "utf8")),
      ),
    ).toEqual(["for net6.0", "for netstandard2.0"]);
    expect(
      await source.assemblies(
        "Newtonsoft.Json",
        "9.9.9",
        "Newtonsoft.Json.dll",
      ),
    ).toEqual([]);

    await source.dispose();
    expect(files.some(({ localPath }) => existsSync(localPath))).toBe(false);
  });

  it("downloads a version's .nupkg and takes every file below a folder out of it, as it lays them out, deleting them once disposed", async () => {
    const { index } = await feed({
      "microsoft.netframework.referenceassemblies.net48": {
        "1.0.3": zip({
          "Microsoft.NETFramework.ReferenceAssemblies.net48.nuspec":
            "<package />",
          "build/.NETFramework/v4.8/mscorlib.dll": "mscorlib",
          "build/.NETFramework/v4.8/Facades/System.Runtime.dll": "a facade",
          "build/.NETFramework/v4.8.1/mscorlib.dll": "not this framework's",
          "build/Microsoft.NETFramework.ReferenceAssemblies.net48.targets":
            "<Project />",
        }),
      },
    });
    const source = asked(index);

    const folder = await source.folder(
      "Microsoft.NETFramework.ReferenceAssemblies.net48",
      "1.0.3",
      "build/.NETFramework/v4.8",
    );

    expect(folder).not.toBeNull();
    expect(await readFile(join(folder as string, "mscorlib.dll"), "utf8")).toBe(
      "mscorlib",
    );
    expect(
      await readFile(
        join(folder as string, "Facades", "System.Runtime.dll"),
        "utf8",
      ),
    ).toBe("a facade");
    expect(existsSync(join(folder as string, "..", "v4.8.1"))).toBe(false);
    expect(
      await source.folder(
        "Microsoft.NETFramework.ReferenceAssemblies.net48",
        "1.0.3",
        "build/.NETFramework/v4.0",
      ),
    ).toBeNull();
    expect(
      await source.folder(
        "Microsoft.NETFramework.ReferenceAssemblies.net48",
        "9.9.9",
        "build/.NETFramework/v4.8",
      ),
    ).toBeNull();

    await source.dispose();
    expect(existsSync(folder as string)).toBe(false);
  });

  it("sends nothing but GET requests for its service index, a package's versions and a version's .nupkg, naming only the package and version", async () => {
    const { index, sent } = await feed({
      "newtonsoft.json": {
        "13.0.3": zip({ "lib/net6.0/Newtonsoft.Json.dll": "x" }),
      },
    });
    const source = asked(index);

    await source.versions("Newtonsoft.Json");
    await source.assemblies("Newtonsoft.Json", "13.0.3", "Newtonsoft.Json.dll");
    await source.versions("Inventory");

    expect(
      sent.map(({ method, url, body }) => ({ method, url, body })),
    ).toEqual([
      { method: "GET", url: "/v3/index.json", body: "" },
      { method: "GET", url: "/flat/newtonsoft.json/index.json", body: "" },
      {
        method: "GET",
        url: "/flat/newtonsoft.json/13.0.3/newtonsoft.json.13.0.3.nupkg",
        body: "",
      },
      { method: "GET", url: "/flat/inventory/index.json", body: "" },
    ]);
    for (const { headers } of sent) {
      expect(headers["cookie"]).toBeUndefined();
      expect(headers["authorization"]).toBeUndefined();
      expect(headers["content-length"] ?? "0").toBe("0");
    }
  });

  it("escapes a package id or version that is not safe in a URL", async () => {
    const urls: string[] = [];
    const source = nugetOrg({
      serviceIndex: "https://feed.test/v3/index.json",
      fetch: (input) => {
        const url = String(input);
        urls.push(url);
        return Promise.resolve(
          url.endsWith("/v3/index.json")
            ? Response.json({
                resources: [
                  {
                    "@id": "https://feed.test/flat/",
                    "@type": "PackageBaseAddress/3.0.0",
                  },
                ],
              })
            : new Response(null, { status: 404 }),
        );
      },
    });

    await source.versions("../A?b#c");

    expect(urls.at(-1)).toBe(
      "https://feed.test/flat/..%2Fa%3Fb%23c/index.json",
    );
  });

  it("fails every request at once, saying why, after one fails", async () => {
    let requests = 0;
    const source = nugetOrg({
      fetch: () => {
        requests++;
        return Promise.reject(new TypeError("fetch failed"));
      },
    });

    await expect(source.versions("Newtonsoft.Json")).rejects.toThrow(
      "nuget.org could not be asked: fetch failed",
    );
    await expect(source.versions("Serilog")).rejects.toThrow(
      "nuget.org could not be asked: fetch failed",
    );
    expect(requests).toBe(1);
  });

  it("fails on an answer that is neither found nor missing", async () => {
    const source = nugetOrg({
      fetch: () =>
        Promise.resolve(
          new Response("busy", {
            status: 503,
            statusText: "Service Unavailable",
          }),
        ),
    });

    await expect(source.versions("Newtonsoft.Json")).rejects.toThrow(
      "nuget.org could not be asked: https://api.nuget.org/v3/index.json answered 503 Service Unavailable",
    );
  });

  it("rejects with the reason it was stopped", async () => {
    const controller = new AbortController();
    const reason = new Error("stopped");
    controller.abort(reason);
    const source = nugetOrg({
      signal: controller.signal,
      fetch: (_, init) => {
        init?.signal?.throwIfAborted();
        return Promise.resolve(new Response("{}"));
      },
    });

    await expect(source.versions("Newtonsoft.Json")).rejects.toBe(reason);
  });
});
