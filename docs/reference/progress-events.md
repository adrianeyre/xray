# Progress events

A Reconstruction reports its progress as it runs (PRD §7.3, FR-19): as each stage starts, as it progresses, and as it finishes, fails or is skipped. `xray reconstruct` shows these events on stderr (see [Progress](xray-reconstruct.md#progress)); `xray ui`'s server streams the same events, unchanged, to the browser (see [The API](xray-ui.md#the-api)). They come from `@xray/core`, which exports their type as `ProgressEvent`:

```ts
import { reconstruct, type ProgressEvent } from "@xray/core";

await reconstruct("MyApp.dll", "./out", {
  onProgress: (event: ProgressEvent) => console.error(JSON.stringify(event)),
});
```

Each event is a plain JSON object, as unchanged by `JSON.stringify` and `JSON.parse` as by being sent anywhere.

## Stages

In the order they run (`RECONSTRUCTION_STAGES`):

| `stage` | What it does | Counts |
|---|---|---|
| `analyse` | Chooses the Assembly in a folder, if given one, starts the engine, classifies the input, checks the output directory and inspects the Assembly. | — |
| `decompile` | Decompiles every top-level type of the Assembly to C#, several at once, one on each processor; the engine reports each type as it starts on it. | types |
| `resolve-dependencies` | Dependency Resolution (FR-10): looks each reference that is not the framework's up as a NuGet package, in the global-packages cache, then, unless `--offline`, on nuget.org (FR-10.2); finds the Sibling Assemblies the Assembly references beside it, and those they reference, that no package holds, then decompiles each, to be a project of its own (FR-10.3); then stops the engine. With `--no-siblings`, it only looks the Assembly's references up as NuGet packages. Xray does not resolve other dependencies yet, so every other reference is left to the target framework. | Sibling Assemblies, once found |
| `generate` | Lays out the Recovered Solution and writes it. | files |
| `build` | Verifies the Recovered Solution with `dotnet build`; skipped with `--no-build`. | — |
| `run` | Runs the rebuilt program (FR-14), which executes recovered code, so it is skipped unless asked to (`--run`); also skipped, with why, when the program cannot run on this OS or there is none (see [Run](xray-reconstruct.md#run)). | — |

The durations of `analyse`, `decompile`, `resolve-dependencies`, `generate`, `build` and `run` are the `timings` of [`xray-report.json`](xray-report-json.md) (`resolveDependencies` for `resolve-dependencies`).

## Events

Stages run one at a time, in order. A stage that runs is `stage-started`, then `stage-progress` every 250 ms while it runs, whether or not it has moved on, then `stage-finished` or `stage-failed`. A stage that does not run is `stage-skipped`. So while a Reconstruction runs, there is an event at least every second, however long a stage takes.

| `kind` | When |
|---|---|
| `stage-started` | The stage has started. |
| `stage-progress` | The stage is still running; it says how far it has got. |
| `stage-finished` | The stage is done. |
| `stage-skipped` | The stage does not run, and why. |
| `stage-failed` | The stage failed, so the Reconstruction stopped: no later stage runs. |

Input that is not a Managed Assembly finishes `analyse`, and no later stage runs.

## Fields

| Field | Type | In | Meaning |
|---|---|---|---|
| `kind` | string | every event | Enumeration: one of the kinds above. |
| `stage` | string | every event | Enumeration: one of the stages above. |
| `elapsedMs` | integer | every event | Whole milliseconds since the Reconstruction started. |
| `done` | integer \| null | `stage-progress` | How many of the stage's items are done; `null` if the stage does not count them (see _Counts_ above). |
| `total` | integer \| null | `stage-progress` | How many items the stage has; `null` if it does not count them, or does not know yet, as before the engine reports the first type. |
| `current` | string \| null | `stage-progress` | What it is working on now: the full name of the type the engine last started decompiling, such as ``App.Models.Point`1``, the name of the assembly being looked up as a NuGet package and looked for beside the input, such as `Newtonsoft.Json` or `Inventory`, then the file name of the Sibling Assembly being decompiled, such as `Inventory.dll`, the file being written, relative to the Recovered Solution, such as `App/Program.cs`, or the program being run, relative as files are, such as `App/bin/Debug/net8.0/App.dll`; `null` if it does not say. |
| `durationMs` | integer | `stage-finished`, `stage-failed` | How long the stage ran, in whole milliseconds. |
| `reason` | string | `stage-skipped` | Why the stage does not run. |
| `message` | string | `stage-failed` | What went wrong: the message of the error the Reconstruction fails with. |

New fields, kinds and stages may be added, so ignore fields you do not know, and treat an unknown `kind` or `stage` as "other".

## Example

The arithmetic Fixture, reconstructed with `--no-build`. Most of `decompile`'s 598 ms go on loading the decompiler, before the engine starts on the Fixture's one type. It references only the framework's assemblies, so `resolve-dependencies` has nothing to look up, and is done at once. The times differ from run to run.

```json
{"kind":"stage-started","stage":"analyse","elapsedMs":0}
{"kind":"stage-finished","stage":"analyse","elapsedMs":81,"durationMs":81}
{"kind":"stage-started","stage":"decompile","elapsedMs":81}
{"kind":"stage-progress","stage":"decompile","elapsedMs":332,"done":0,"total":1,"current":"Arithmetic.Program"}
{"kind":"stage-progress","stage":"decompile","elapsedMs":582,"done":0,"total":1,"current":"Arithmetic.Program"}
{"kind":"stage-finished","stage":"decompile","elapsedMs":680,"durationMs":598}
{"kind":"stage-started","stage":"resolve-dependencies","elapsedMs":680}
{"kind":"stage-finished","stage":"resolve-dependencies","elapsedMs":686,"durationMs":7}
{"kind":"stage-started","stage":"generate","elapsedMs":686}
{"kind":"stage-finished","stage":"generate","elapsedMs":688,"durationMs":2}
{"kind":"stage-skipped","stage":"build","elapsedMs":688,"reason":"Building was skipped, so the Recovered Solution is not verified."}
{"kind":"stage-skipped","stage":"run","elapsedMs":688,"reason":"Running the rebuilt program executes recovered code, so it is run only when asked."}
```
