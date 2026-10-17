# Performance

A Reconstruction of an Assembly of about 2,000 types and 5 MB must finish in under 60 s, excluding `dotnet build`, on a typical developer laptop (PRD §8), reporting its progress at least once a second all the while (FR-19). `pnpm benchmark` checks both, on the benchmark Fixture.

## What is timed

The benchmark Fixture's Assembly, `Ledgerworks.dll`: a .NET 8 console program of 2,042 top-level types in 40 namespaces, 5.5 MiB (5,775,872 bytes), whose source is generated as it is built (see [The benchmark Fixture](../../fixtures/README.md#the-benchmark-fixture)). It is reconstructed twice: as it is built, with its PDB beside it, which lays its 2,042 types out in the 1,642 files they were written in; and from a copy without the PDB, as an Assembly is often given, one file per type.

Each Reconstruction is core's `reconstruct`, as `xray reconstruct --no-build --offline` runs it: every stage but `build` and `run`, which are skipped, from starting the engine to writing `xray-report.json`. It is `--offline` so that how quickly nuget.org answers is not timed, though the Fixture references only the framework, so nothing would be looked up. Its time is from calling `reconstruct` until it resolves, which is a little more than its report's `timings.total`.

Its progress is timed too: the longest it went without a [progress event](progress-events.md), from its start to the first, between any two, or from the last until it resolved. The events are timed as they are reported, so a stage that kept Node's event loop busy, and the 250 ms ticker from firing, would show here as well as a stage that never reported.

What was timed is then shown to be a Full Reconstruction: each Recovered Solution is rebuilt with `dotnet build`, not timed, and the program it builds is run with each of the Fixture's inputs, as a [Round-trip](../../fixtures/README.md) does, and must print what the original does.

## Running it

```bash
pnpm build:engine
pnpm benchmark                  # prints the results as Markdown
pnpm benchmark --json out.json  # and writes them as JSON
```

It builds the Fixture (as `pnpm build:fixtures` does, once), then prints the machine it ran on, each Reconstruction's time and its stages', the longest it went without progress, whether it met the targets, and its Round-trip. It exits 1 if either Reconstruction missed a target or failed its Round-trip.

CI runs it on every push and pull request as a job of its own, `benchmark`, on `ubuntu-latest`, which never blocks a merge: a shared runner is slower than a developer's laptop, and its speed varies from run to run. Its results are in the run's summary, and in its `benchmark` artifact as JSON.

## How it is fast enough

Decompiling is almost all of a Reconstruction's time, so the engine decompiles an Assembly's types on every processor at once, as ILSpy does when it writes a project: each thread has a decompiler of its own, and they share one type system. It uses the server garbage collector, a heap for each processor, so that threads allocating as they decompile do not wait on one another, adapting its heaps to the work so that it takes no more memory than one heap: about 220 MB for the benchmark Fixture. Types finish out of order, so `decompile`'s progress names each type as the engine starts on it, and how many are done can stay the same from one event to the next.

## Results

Measured on 2026-10-08 with `pnpm benchmark`, on an AWS virtual machine shared with other work: an Intel Xeon Platinum 8488C (Sapphire Rapids), 16 logical processors, 62 GiB of memory; Linux 6.17 x64; Node 26.10.0; .NET SDK 8.0.425. It was run as it is, then confined to 4 processors and to 1 with `taskset`, which both Node and .NET respect, so the engine used only those. _Before_ is the same Reconstruction with the engine as it was, decompiling one type at a time.

| Processors | Before, with its PDB | With its PDB | Without a PDB | Longest without progress |
| ---: | ---: | ---: | ---: | ---: |
| 16 | 19.5 s | **9.2 s** | **8.4 s** | 0.3 s |
| 4 | 19.7 s | **11.8 s** | **11.9 s** | 0.3 s |
| 1 | 42.8 s | **42.2 s** | **40.1 s** | 0.3 s |

Each met both targets, and each Round-trip passed: the rebuilt program printed what the original does for all 5 inputs. Decompiling was 95% or more of each; `analyse` took 0.2 s, `resolve-dependencies` under 0.1 s and `generate` 0.1 to 0.2 s.

These were not timed on a laptop. A developer's laptop typically has 4 or more processors, each at least as fast as one of this server's, which shares its cores between two processors, so the 4-processor row is what to expect of one, and the 1-processor row bounds it: even then, a Reconstruction finishes in well under 60 s. Before, the engine used one processor to decompile, and others only for its garbage collector and compiling itself, which is why it took the same time on 4 as on 16. Time on more processors falls by less than their number, as some of the work is done once, and threads decompiling at once share the processor's caches and memory; on a shared virtual machine, it varies from run to run by about 10%.
