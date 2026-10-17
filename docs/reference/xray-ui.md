# `xray ui`

`xray ui [--port <n>]` starts Xray's web UI on `http://127.0.0.1:<n>/` and opens it in your browser (PRD FR-18, FR-26, §8; ADR 0003). It runs until you stop it with Ctrl+C.

In the page it opens, you upload an Assembly, or a folder holding one, by dropping it on the page or choosing it (see [Uploading an Assembly or a folder](#uploading-an-assembly-or-a-folder)), or give the path of one on this machine (see [Reconstructing from a path](#reconstructing-from-a-path)), and follow its Reconstruction live, stage by stage, to its outcome, with the Assembly's [inspect summary](#the-inspect-summary); then read [its report](#the-report), [browse the Recovered Solution](#browsing-the-recovered-solution) it wrote, file by file, each build error opening its file at its line, and [download it](#downloading-the-recovered-solution) as a zip.

Above where you give it an Assembly, the page states Xray's [intended use](#intended-use).

## What it does

1. **Listens for Ctrl+C**, before anything else, so stopping it at any point after it has made its Workspace deletes that.
2. **Makes a Workspace**: a new, empty temporary folder for this session's uploads and outputs (below).
3. **Starts the server** on `127.0.0.1:<n>` (below), serving the web app from `packages/web/dist`, which `pnpm build:web` builds with Vite (`pnpm start`, from the repository, builds it, the engine and the project site, then runs `xray ui`). If it has not been built, `xray ui` says so and exits 1.
4. **Says where it is running**, and where its Workspace is:

   ```text
   Xray is running at http://127.0.0.1:9729/
   Only this machine can reach it. Workspace: /tmp/xray-ui-a1b2c3
   Press Ctrl+C to stop Xray and delete its Workspace.
   ```

5. **Opens your browser** at that address, with `open` on macOS, `cmd /c start` on Windows, and `xdg-open` elsewhere. If that command cannot be started, it says so on stderr, and you open the address yourself; Xray keeps running. With the `BROWSER` environment variable set to `none`, it opens none.
6. **Runs until stopped** by Ctrl+C (`SIGINT`), `SIGTERM`, or the terminal closing (`SIGHUP`). It then stops the server, deletes the Workspace, and exits 0:

   ```text
   Stopping Xray...
   Xray has stopped, and its Workspace is deleted.
   ```

## Uploading an Assembly or a folder

The page takes an Assembly, or a folder holding one, uploaded (PRD FR-1): drop it on the page's drop zone, or choose it with **Choose a file…** (an `.exe` or `.dll`) or **Choose a folder…**, in Chrome, Edge, Firefox or Safari. It takes one file or one folder at a time; a folder brings every file below it, however deep.

The files are copied into the session's [Workspace](#the-workspace), each to the same place in the folder as it had in the original, and nowhere else: they go only to Xray's own server, on `127.0.0.1`. As they are, the page shows how far it has got, in bytes and in files, with a progress bar. Uploading is copying, so for a large application giving its path ([below](#reconstructing-from-a-path)) is quicker.

Once every file has arrived, the page reconstructs one Assembly of what was uploaded, with the [Sibling Assemblies](#sibling-assemblies) beside it, as it would from a path:

- **A single file**, whatever its name; if it is not a Managed Assembly, the page says what it is and why Xray cannot reconstruct it.
- **From a folder**, the application's own Assembly. That is the folder's only `.exe` or `.dll`; else its only `.dll` with a `.runtimeconfig.json` of the same name beside it, a .NET Core or .NET 5+ application, whose `.exe`, if it has one, is a native launcher; else its only `.exe`, a .NET Framework application beside its DLLs. If none of those tells which, the page lists the folder's `.exe` and `.dll` files, the shallowest first, and asks which is the application to reconstruct.

Before anything is uploaded, a folder holding no `.exe` or `.dll` is refused, as are files whose names not every system can hold: a name with `\ : * ? " < > |` or a control character in it, one ending in a dot or space, one Windows reserves (such as `CON` or `NUL`), or two names that differ only in capitals and small letters. The page says which, and why, beside the drop zone, as it does if a file cannot be uploaded. While an upload or a Reconstruction is under way, nothing more can be uploaded.

## Sibling Assemblies

Above both, **Reconstruct Sibling Assemblies** is on unless you turn it off (PRD FR-11). While it is on, each Sibling Assembly the Assembly references, found beside it, is reconstructed into a project of its own in the same solution, wired with a `ProjectReference`, as `xray reconstruct` does (see [Sibling Assemblies](xray-reconstruct.md#sibling-assemblies)). Turned off, as `--no-siblings` does, only the Assembly is reconstructed, and each Sibling Assembly it references is copied into the Recovered Solution's `Dependencies/` as it is, and referenced with a `HintPath` (see [Copied binaries](xray-reconstruct.md#copied-binaries)). Either way, a third party's Assembly beside it is copied so, and a reference a NuGet package holds becomes a `PackageReference`, looked up in the global-packages cache, then on nuget.org, as `xray reconstruct` does without `--offline` (see [NuGet packages](xray-reconstruct.md#nuget-packages)). It applies to the next Reconstruction started, by upload or by path, and cannot be changed while one is under way.

## Reconstructing from a path

The page has a box for the path of an Assembly, or a folder holding one, on this machine (PRD FR-1): giving its path, rather than uploading it, means even a large application is not copied. Given a folder, it reconstructs the application's Assembly in it, as `xray reconstruct` does (see [What it does](xray-reconstruct.md#what-it-does)). The path must be a full one, from the root of its drive or file system, such as `C:\Apps\MyApp.exe` or `/home/me/MyApp.dll`; whitespace around it, and the double quotes Windows' _Copy as path_ puts around it, are left out.

**Reconstruct** starts a Reconstruction of it, as `xray reconstruct` does, building the Recovered Solution but not running its program (that executes recovered code, so the UI never does). The Recovered Solution is written to the session's [Workspace](#the-workspace), and deleted with it.

While it runs, the page shows each stage of the pipeline (analyse, decompile, resolve dependencies, generate solution, build, run the rebuilt program) as waiting, running, done, skipped or failed, updated at least once a second (FR-19). A running stage shows how long it has run and, where it counts them, how many of its types, Sibling Assemblies or files are done, and which it is on; a skipped stage, why; a failed one, what went wrong. Then it shows the outcome:

- **Full Reconstruction**, **Partial Reconstruction** or **Unverified**, in [its report](#the-report), below the stages.
- **Xray cannot reconstruct this file**, for input that is not a Managed Assembly, a Native Executable or not a PE file at all, saying what it is and why (ADR 0002).
- **The Reconstruction failed**, at the stage it failed in, with why: there is no file at the path, it is a folder with no Assembly in it or with several and nothing saying which is the application's, it cannot be read or its metadata is corrupt, its target framework (or a Sibling Assembly's) cannot be told, or the engine failed.

The page also shows the Assembly's [inspect summary](#the-inspect-summary) as soon as the analyse stage has read it, and keeps it once the Reconstruction has ended, whatever its outcome. Input that is not a Managed Assembly has none.

A path the server will not take, as one that is not a full path, is refused at once, beside the box, and nothing starts. One Reconstruction runs at a time: **Reconstruct** is disabled until it ends.

### Reconnecting

The page follows the Reconstruction over a stream that, if the connection is lost, the browser makes again by itself, saying which event it had last, so it carries on where it left off, missing none and repeating none. Meanwhile, it says it is connecting again.

The page's address names the Reconstruction it follows, as `?reconstruction=<id>`, so loading the page again, or opening that address in another tab, shows the whole Reconstruction so far, then follows the rest. Once `xray ui` has stopped, its Reconstructions are gone; a page that names one says so.

## The inspect summary

For a Managed Assembly, uploaded or given by its path, the page shows the summary of its metadata that [`xray inspect --json`](xray-inspect-json.md) prints (PRD FR-5, FR-6, FR-20), read by the same Reconstruction, in the analyse stage, so the Assembly is read once. It shows every field of that document but `schemaVersion`, each by name, in the order the document gives them:

- **File**, the Assembly, as an absolute path: for an upload, its copy's, in the [Workspace](#the-workspace).
- **Assembly**, **Version**, **Culture** (`neutral` for `null`) and **Public key token** (`none: not strong-named` for `null`).
- **Target framework**, its moniker (`unknown` for `null`); **Framework name**, its `TargetFrameworkAttribute` (`none: no TargetFrameworkAttribute` for `null`); **Runtime version**; **Told from**, how the moniker was told: `its TargetFrameworkAttribute`, what `inferredFrom` says where the Assembly has none (`CLR v2.0.50727 and its reference to System.Core 3.5.0.0`), or `nothing: it records no TargetFrameworkAttribute`; and **Support**, how far Xray supports it: `full`, `best effort: not as fully as .NET Framework 4.x, .NET Core 3.1 or .NET 5 and later`, or `none: no project can target it`.
- **Platform target** (`unknown` for `null`), **Prefer 32-bit** (`yes` or `no`), **Bitness** and **Machine**.
- **Entry point**, as `Type.Method`, or `none: a library`.
- **Output kind**: Console, WinForms, WPF, Windows GUI, neither WinForms nor WPF, or Library.
- **Types**, **Methods** and **Resources**: how many it defines.
- **PDB**: the PDB beside the Assembly, and whether it is its own, as `xray inspect` prints it: `none beside it`; the PDB, its format, `its own: used for local names and source layout`; or the PDB, its format, `ignored:` and why. A PDB uploaded with its Assembly, in the same folder, is beside it in the Workspace too.
- **Obfuscation**: whether the Assembly shows signs of obfuscation, as `xray inspect` prints it: `clean: no sign of it found`; or `likely obfuscated, so reconstructed as it is, not deobfuscated:` and each sign found, as its `message` says it (see [Obfuscation](xray-reconstruct.md#obfuscation)).
- Its **references**, in a table of each one's name, version, culture and public key token, sorted by name.

A value the page does not know, added to one of the document's enumerations since, it shows as the document gives it. Under **As `xray inspect --json` prints it** is the document itself, exactly as that prints it.

## The report

Once a Reconstruction has written a Recovered Solution, whatever its outcome, the page shows the [`xray-report.json`](xray-report-json.md) it wrote there, under **Report**, just below the stages (PRD FR-17, FR-22). Loading the page again, after it has ended, shows it again. A Reconstruction that wrote none, as of a Native Executable, has none.

- **Its outcome**: **Full Reconstruction**, plainly a success, with a tick, in green; **Partial Reconstruction**, plainly not, with a warning sign, in amber, and why it is Partial (nothing satisfies some references, each an Unresolved Dependency, named; it did not build, with how many errors; or the rebuilt program did not run to an exit); or **Unverified**, not built. With it, where the Recovered Solution is, its solution, project, target framework, output type, how many types it has and how many files they were decompiled to (`3, decompiled to 2 files`), its resources and what became of them (`none`, or `11, each under its own name: 6 written as .resx, 5 embedded as they are; 2 satellite assemblies (de, fr)`, as `xray reconstruct` says it; see [Resources](xray-reconstruct.md#resources)), the PDB it was decompiled with (`none beside the Assembly`, its path and `used for local names and source layout`, or its path and `ignored, as it is not the Assembly's own`), whether its Assembly is obfuscated (`clean: no sign of it found`, or `likely obfuscated (mangled names, hidden strings): reconstructed as it is, not deobfuscated`, as `xray reconstruct` says it), how many references its Assemblies make and how many were resolved each way (`3 references: 2 framework, 1 unresolved`), its Sibling Assemblies (`none found beside it`, `not reconstructed (turned off)`, or how many, each a project of its own), how it built (`succeeded`, or `failed with 4 errors and 1 warning`, as `xray reconstruct` says it) and how long it took.
- **Warnings**, if there are any: each, as `warnings` says it, such as a PDB beside an Assembly that was ignored, being another build's (see [PDBs](xray-reconstruct.md#pdbs)), an Assembly that is likely obfuscated, and was reconstructed as it is (see [Obfuscation](xray-reconstruct.md#obfuscation)),, an Assembly for a framework Xray supports only on a best-effort basis (see [Target frameworks supported on a best-effort basis](xray-reconstruct.md#target-frameworks-supported-on-a-best-effort-basis)), or a resource embedded as it is rather than written as a `.resx`, or not recovered (see [Resources](xray-reconstruct.md#resources)).
- **Dependency Resolution**: a table of every reference of every Assembly of the solution, once each, as `dependencies` records them (PRD FR-22): the assembly's name, version and public key token; how it was resolved, **Framework**, **NuGet package**, **Sibling Assembly**, **Copied binary** or **Unresolved**, the last marked in red; what in the Recovered Solution satisfies it, the package and version, the Sibling Assembly's project, or the file it was copied to; the Assemblies that reference it; and why. See [Dependency Resolution](xray-reconstruct.md#dependency-resolution).
- **Sibling Assemblies**, if there are any: each one's project, with how many types it has and the projects it references, as `solution.projects` records them; then anything worked around in them, a duplicate name or a cycle, as `siblingProblems` says it.
- **Timings**: how long each stage took (Analyse, Decompile, Resolve dependencies, Generate solution, Build, Run the rebuilt program), `skipped`, `not built` or `not run` for one that did not run, and the Total, as `timings` records them.
- **Build diagnostics**: every error and warning `dotnet build` printed, as `build.diagnostics` records them, all of them, the errors first, then the warnings, each in the order printed, as `file:line:column: severity code: message`. If it printed none, the page says so.

Choosing a diagnostic about a file of the Recovered Solution opens that file in the viewer of [the Recovered Solution](#browsing-the-recovered-solution), brought into view, at its line: the line marked, in the middle of the viewer, with the cursor at its column. The tree shows the file chosen, opening any folder it is in that was closed; above the viewer, its line and column follow its path and size. A diagnostic that gives no line opens its file at its top. Choosing another diagnostic about the file already shown only moves to its line, without reading the file again. A diagnostic about no file, or about a file outside the Recovered Solution, such as one of the .NET SDK's own targets files, opens nothing.

## Browsing the Recovered Solution

Once a Reconstruction has written a Recovered Solution, whatever its outcome, the page shows it under **Recovered Solution** (PRD FR-21): a tree of its folders and files on the left, and a viewer of the file chosen on the right. Loading the page again, while or after it runs, shows it again once it has ended. A Reconstruction that wrote none, as of a Native Executable, has nothing to browse.

The tree holds every file the Reconstruction wrote, as [`xray-report.json`](xray-report-json.md) lists them in `solution.files`: the `.sln`, the project, each type's `.cs` file, the binaries copied into `Dependencies/`, if any, and the report itself. What `dotnet build` made beside them, in `bin/` and `obj/`, is not part of the Recovered Solution, and is not shown. Each folder lists its folders, then its files, each by name, capitals and small letters together and numbers by their value (`Type2.cs` before `Type10.cs`). Every folder starts open, so every file is in view; choosing a folder closes it, and opens it again. Pointing at a file shows its path and size.

Choosing a file shows it in the viewer, [Monaco](https://microsoft.github.io/monaco-editor/), with its path and size above it, from its top. The viewer only shows files: nothing in it can be changed, and nothing is written back. C# files (`.cs`) are highlighted as C#; XAML files (`.xaml`), projects (`.csproj`) and `.resx` files as XML; and solutions (`.sln`) as solutions, their header, comments, keywords, quoted names and paths, GUIDs and version numbers each highlighted; every other file is shown as plain text, but for a binary (`.dll` or `.exe`, as copied into `Dependencies/`; or a resource embedded as it is, an image such as `.png`, a `.resources` file, or the bytes a `.resx` refers to, `.bin`), which is not read: the page says it is a binary, which is in the zip. Ctrl+F (Cmd+F on macOS) finds text in it. It follows the system's light or dark scheme. Monaco is part of the web app, served by Xray on `127.0.0.1` like the rest of the page, and loaded only once a file is first chosen; nothing is fetched from anywhere else.

However large a file, opening it does not stop the page answering: it arrives from the server in the background, the server reading it from disk as it sends it, and Monaco draws only the lines in view and highlights the rest a little at a time while the page is idle. A file over 20 MB, or 300,000 lines, it shows without highlighting. Choosing another file before one has arrived stops reading it, and shows only the last chosen. If a file cannot be read, the page says why where it would be.

## Downloading the Recovered Solution

Under **Recovered Solution**, **Download .zip** saves the Recovered Solution as a zip archive (PRD FR-23), whatever its outcome, named after its solution: `Arithmetic.zip` for `Arithmetic.sln`. It holds every file the tree does, as `xray-report.json` lists them in `solution.files`, the report among them, each exactly as the Reconstruction wrote it, in a folder named after the solution, so extracting it makes that one folder. The arithmetic Fixture's holds:

```text
Arithmetic/Arithmetic.sln
Arithmetic/Arithmetic/Arithmetic.csproj
Arithmetic/Arithmetic/Properties/AssemblyInfo.cs
Arithmetic/Arithmetic/Program.cs
Arithmetic/xray-report.json
```

What `dotnet build` made beside them, in `bin/` and `obj/`, is left out, so the archive holds only the source; `dotnet build`, run in the folder it extracts to, builds it again, as the Reconstruction did.

The archive is made as it is sent, each file deflated as the server reads it, so it starts downloading at once, however large the Recovered Solution, and only the browser keeps it: Xray writes no copy of it. Names in it are in UTF-8, and marked so. A Recovered Solution too large for a zip archive without its ZIP64 extension, of more than 65,535 files or 4 GiB, which no Reconstruction comes near, is refused, saying where it is in the [Workspace](#the-workspace), to copy from until `xray ui` stops.

## Intended use

Above where you give it an Assembly, the page says what Xray is for (PRD §5):

> **Intended use.** Xray is for Assemblies you own or have the right to analyse: recovering lost source for your own software, studying how C# features compile, or maintaining legacy internal applications. It does not undo obfuscation, or bypass licence checks or any other protection.

## The footer

A footer stays at the bottom of the window. It links **Website design**, with GitHub's mark, to Xray's repository, [github.com/adrianeyre/xray](https://github.com/adrianeyre/xray), in a new tab, and lists Xray's **Privacy Policy**, **Terms and Conditions**, **Cookie Policy** and **Accessibility** statement. Each opens in a modal dialog: a header with its title and a close button (×), a body that scrolls, either way, when what it says does not fit, and a footer of buttons that stays in place, ending with **Close**. Escape, or a click outside it, closes it too, and focus goes back to the button that opened it. Xray sets no cookies and keeps nothing in the browser, as its Cookie Policy says.

## Accessibility

The page is built to meet the [Web Content Accessibility Guidelines (WCAG) 2.2](https://www.w3.org/TR/WCAG22/) at Level AA, as its Accessibility statement says:

- **Keyboard**: everything can be done from the keyboard, starting with **Skip to content**. Focus shows as a 3-pixel ring, at least 3:1 against what is around it, and the page scrolls whatever has focus clear of the footer that stays at the bottom of the window. In a window too short for it, as at 400% zoom, the footer, and a modal's header and footer, stop staying put. Tables, lists and code that scroll within the page can be focused, so they scroll from the keyboard too; Tab moves out of the code viewer, as out of anything else.
- **Screen readers**: the page's title says what it is doing (`Reconstructing MyApp.exe – Xray`), and how far an upload or a Reconstruction has got (the stage it is at, of how many, and how that stage stands), its outcome, and any error are announced as they happen. A modal is named by its title.
- **Contrast**: text is at least 4.5:1 against its background, and the edges of fields and focus rings at least 3:1, in light and dark mode; Windows' contrast themes give borderless buttons a border.
- **Motion and pointing**: a running stage's dot pulses four times, then is still, and nothing moves when the system asks for reduced motion. Every target is at least 24 by 24 pixels, and dropping is never the only way to give the page an Assembly.

## Local only

The server listens on `127.0.0.1`, the loopback interface, and only there. That is not configurable. Other hosts cannot reach it, not even through this machine's own network addresses: a connection to those is refused.

It also answers only requests addressed to `127.0.0.1:<n>` or `localhost:<n>`, by their `Host` header, refusing any other with `403 Forbidden`. A web page on another host that has its own name resolve to `127.0.0.1` (DNS rebinding) cannot reach it through your browser either.

Nor will it take an upload, or start a Reconstruction, for a page on another host. A web page anywhere can have your browser send a request to `127.0.0.1`, but the browser says which page sent it, by its `Origin` header, and the server refuses, with `403 Forbidden`, any request that changes something from a page it did not serve itself. It also takes the files to upload and the path only as JSON, and each file's contents only as `application/octet-stream` with `PUT`, none of which a page on another host can send without first asking the server's leave, which it never gives.

Your Assemblies and Recovered Solutions never leave the machine.

## The Workspace

Each session has its own Workspace, `xray-ui-` and six random characters, in the operating system's temporary folder (`TMPDIR`, or `TEMP` on Windows). Each upload copies its files to a folder of its own there, `uploads/<id>`, keeping the folder's structure, and each Reconstruction writes its Recovered Solution to a folder of its own, `reconstructions/<id>`. Uploaded files are kept nowhere else. Nothing outlives the session; there is no history of past uploads or Reconstructions:

- **Stopped** with Ctrl+C, `SIGTERM` or the terminal closing, Xray stops any Reconstruction still running (the engine, `dotnet build`, all of it), and any file still arriving, then deletes the Workspace, with everything in it, before it exits.
- **Exiting any other way** that still lets Node.js run its exit handlers, such as on an error it did not expect, it deletes the Workspace as it exits.
- **Killed outright** (`SIGKILL`, or ending it in Task Manager), it cannot delete anything, and the Workspace is left in the temporary folder.

## The port

`--port <n>` is the port to listen on: a whole number from 0 to 65535. Without it, Xray listens on 9729, which spells XRAY on a phone keypad; with `--port 0`, on any free port, which it then says.

If something else is already listening on that port, `xray ui` says so on stderr, with a free port to try instead (the first free one of the next 20, or else any free one), and exits 1:

```text
Port 9729 on 127.0.0.1 is already in use. Try another, such as: xray ui --port 9730
```

## The API

The page drives uploads and Reconstructions, and browses and downloads Recovered Solutions, through the server's API, below `/api`, which only it is meant to use. Each answer that is not a stream, or empty, is JSON; a refusal is `{"message": "…"}`, saying what was wrong, for the user.

### `POST /api/uploads`

Begins an upload, given the files it will be, as JSON with `Content-Type: application/json`: each by its path, which for a folder runs from the folder's parent, the folder's own name first, with `/` between names; and its size, in bytes:

```json
{
  "files": [
    { "path": "MyApp/MyApp.dll", "size": 52224 },
    { "path": "MyApp/MyApp.exe", "size": 151552 },
    { "path": "MyApp/MyApp.runtimeconfig.json", "size": 268 },
    { "path": "MyApp/de/MyApp.resources.dll", "size": 6144 }
  ]
}
```

It answers `201 Created`, with where to send each file, also in its `Location` header; the files that may be Assemblies, its `.exe` and `.dll` files (or the single file uploaded); and which of them a Reconstruction of it starts from, as [above](#uploading-an-assembly-or-a-folder), or `null` if the user must choose:

```json
{
  "id": "5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10",
  "files": "/api/uploads/5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10/files",
  "assemblies": [
    "MyApp/MyApp.dll",
    "MyApp/MyApp.exe",
    "MyApp/de/MyApp.resources.dll"
  ],
  "assembly": "MyApp/MyApp.dll"
}
```

Nothing is written until the files are sent. The request is refused with:

| Status | When |
|---|---|
| 400 | There are no files; a path or size is missing or not one; a path leads outside the upload, or names a file not every system can hold; two paths would be the same file; or, of more than one file, none is an `.exe` or `.dll`. |
| 403 | It came from a page another host served (see [Local only](#local-only)). |
| 413 | The list is over 16 MiB, which is room for tens of thousands of files. |
| 415 | It is not JSON. |

### `PUT /api/uploads/<id>/files/<n>`

Sends the upload's file `<n>`, counting from 0 in the order they were listed, as its bytes, with `Content-Type: application/octet-stream`. They are written to the file's place in the upload's folder in the Workspace as they arrive, never held whole in memory, however large the file. The files can be sent in any order, several at once; the page sends four at a time, telling how much of each it has sent.

It answers `204 No Content` once the file is written whole. A file whose sending is cut off is deleted, so it can be sent again. The request is refused with:

| Status | When |
|---|---|
| 400 | Its contents are not the size listed. Nothing is kept of them, so the file can be sent again. |
| 403 | It came from a page another host served. |
| 404 | There is no such upload, as one from before `xray ui` was restarted, or no file `<n>` in it. |
| 409 | The file has arrived already, or is arriving. |
| 415 | It is not `application/octet-stream`. |

### `POST /api/reconstructions`

Starts a Reconstruction of the Assembly, or folder, at a path on this machine, or of an Assembly uploaded, sent as JSON with `Content-Type: application/json`. Its Sibling Assemblies are reconstructed with it unless `"siblings": false` is sent too:

```json
{ "path": "/home/me/MyApp.dll" }
```

```json
{ "path": "/home/me/MyApp.dll", "siblings": false }
```

```json
{
  "upload": "5d0c1f9e-3c1e-4c55-9d6b-9f0e4c2b7a10",
  "assembly": "MyApp/MyApp.dll"
}
```

It answers `202 Accepted`, with the stream's address also in its `Location` header, and the Assembly's path: for an upload, its copy's, in the Workspace:

```json
{
  "id": "27e552ad-4cad-4bbc-8a79-0bcc1498d70a",
  "path": "/home/me/MyApp.dll",
  "events": "/api/reconstructions/27e552ad-4cad-4bbc-8a79-0bcc1498d70a/events"
}
```

Whether there is a Managed Assembly at the path is for the Reconstruction to find out, and its stream to say. The request itself is refused with:

| Status | When |
|---|---|
| 400 | There is no `path`, it is empty, or it is not a full path; or, of an upload, the `assembly` is not one of its files; or `siblings` is not `true` or `false`. |
| 403 | It came from a page another host served (see [Local only](#local-only)). |
| 404 | There is no such upload. |
| 409 | Not all of the upload's files have arrived. |
| 415 | It is not JSON. |

### `GET /api/reconstructions/<id>/events`

The Reconstruction's stream: [Server-Sent Events](https://html.spec.whatwg.org/multipage/server-sent-events.html), `text/event-stream`, as a browser's `EventSource` reads them. Each event has an `id`, its place in the stream counting from 0; an `event`, its type; and `data`, one line of JSON:

| `event` | `data` |
|---|---|
| `started` | First: `{"path": "…"}`, the Assembly, as an absolute path. |
| `progress` | One of the Reconstruction's [progress events](progress-events.md), unchanged. |
| `inspected` | Once the `analyse` stage has read a Managed Assembly's metadata, before it finishes: its summary, the [`xray inspect --json`](xray-inspect-json.md) document, `schemaVersion` and all. None for input that is not a Managed Assembly. |
| `ended` | Last: how it ended (below). The server then ends the stream. |

`ended`'s `data` is one of, by its `kind`:

| `kind` | Fields | When |
|---|---|---|
| `reconstructed` | `directory`, where the Recovered Solution is; `report`, the [`xray-report.json`](xray-report-json.md) written there | It wrote a Recovered Solution, whatever its outcome. |
| `rejected` | `inputKind`, `native-executable` or `not-pe`; `explanation`, what the input is and why Xray cannot reconstruct it | The input is not a Managed Assembly. |
| `failed` | `code`: the input's (`not-found`, `no-assembly-in-folder`, `assembly-not-chosen`, `unreadable`, `invalid-metadata`), the Assembly's (`unknown-target-framework`), the engine's (such as `engine-not-found`), or `null`; `message`, what went wrong | It could not start or finish. |

A stream connected to again with a `Last-Event-ID` header, as `EventSource` does by itself when it loses the connection, sends only the events after that one; without one, every event so far. Either way, it then sends each new event as it happens. The stream starts with `retry: 1000`, so a browser connects again a second after losing it.

The arithmetic Fixture, with the summary and `report` cut short:

```text
retry: 1000

id: 0
event: started
data: {"path":"/home/me/Arithmetic.dll"}

id: 1
event: progress
data: {"kind":"stage-started","stage":"analyse","elapsedMs":0}

id: 2
event: inspected
data: {"schemaVersion":1,"path":"/home/me/Arithmetic.dll","assembly":{"name":"Arithmetic","version":"1.0.0.0","culture":null,"publicKeyToken":null},…}

id: 3
event: progress
data: {"kind":"stage-finished","stage":"analyse","elapsedMs":84,"durationMs":84}

…

id: 18
event: ended
data: {"kind":"reconstructed","directory":"/tmp/xray-ui-a1b2c3/reconstructions/27e552ad-4cad-4bbc-8a79-0bcc1498d70a","report":{"schemaVersion":1,"outcome":"full",…}}
```

A Reconstruction this session did not start, as one from before `xray ui` was restarted, is `404 Not Found`.

### `GET /api/reconstructions/<id>/files`

The files of the Recovered Solution the Reconstruction wrote, in the order it wrote them, the report last, each by its path in the Recovered Solution, with `/` between names, and its size, in bytes: those `xray-report.json` lists in `solution.files`, not what `dotnet build` made beside them. The arithmetic Fixture's:

```json
{
  "files": [
    { "path": "Arithmetic.sln", "size": 980 },
    { "path": "Arithmetic/Arithmetic.csproj", "size": 571 },
    { "path": "Arithmetic/Properties/AssemblyInfo.cs", "size": 466 },
    { "path": "Arithmetic/Program.cs", "size": 5592 },
    { "path": "xray-report.json", "size": 2382 }
  ]
}
```

It is refused with:

| Status | When |
|---|---|
| 404 | There is no such Reconstruction, as one from before `xray ui` was restarted; or it wrote no Recovered Solution, as for input that is not a Managed Assembly, or one that failed. |
| 409 | It has not finished. |

### `GET /api/reconstructions/<id>/files/<path>`

Sends the file at `<path>` in the Recovered Solution, each name in it percent-encoded (as `encodeURIComponent` does) with `/` between them, as its bytes, unchanged: `text/plain; charset=utf-8`, with its `Content-Length` and `X-Content-Type-Options: nosniff`, so no page can run it. It is read from disk as it is sent, never held whole in memory, however large.

It sends only a file of the Recovered Solution, and nothing else in the Workspace or on this machine: `<path>` must be, exactly, one of the paths the list above gives, so no path with `..` in it, encoded or not, an absolute path, or a file `dotnet build` made is ever sent; and the file, any link followed, must still lie within the Reconstruction's own folder in the Workspace. It is refused with:

| Status | When |
|---|---|
| 404 | There is no such Reconstruction; it wrote no Recovered Solution; or `<path>` is not one of its files, or leads outside its folder. |
| 409 | It has not finished. |

### `GET /api/reconstructions/<id>/zip`

Sends the Recovered Solution the Reconstruction wrote as a zip archive, as [above](#downloading-the-recovered-solution): `application/zip`, with `Content-Disposition: attachment` naming it after the solution, so a browser saves it rather than showing it, and `X-Content-Type-Options: nosniff`. It is made as it is sent, so it has no `Content-Length`.

It holds the files the list above gives, in its order, each in the folder `<solution>/`, deflated, and nothing else in the Workspace or on this machine: the same files, each still within the Reconstruction's own folder, any link followed, that `GET /api/reconstructions/<id>/files/<path>` sends. The arithmetic Fixture's is `Arithmetic.zip`:

```text
Content-Type: application/zip
Content-Disposition: attachment; filename="Arithmetic.zip"; filename*=UTF-8''Arithmetic.zip
```

It is refused with:

| Status | When |
|---|---|
| 404 | There is no such Reconstruction, or it wrote no Recovered Solution. |
| 409 | It has not finished. |
| 413 | The Recovered Solution is too large for a zip archive: more than 65,535 files, or 4 GiB. |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Stopped: the server stopped and its Workspace was deleted. |
| 1 | It could not start: the port is in use, or the web app has not been built; or, stopping, it could not delete its Workspace. |
| 2 | The command line could not be understood, such as a `--port` that is not a port number. |
