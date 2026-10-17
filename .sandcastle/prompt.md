# Read first

Before touching anything, read these in full. They are the canon your work is judged against:

- `README.md`
- `GLOSSARY.md` — use its terms exactly (Reconstruction, Recovered Solution, Managed Assembly, Fixture, Round-trip…) and none of the words it lists under _Avoid_
- `docs/product-requirements-document/xray.md`
- `docs/architectural-decision-record/0001-typescript-cli-with-csharp-engine-sidecar.md`
- `docs/architectural-decision-record/0002-managed-dotnet-only.md`
- `docs/architectural-decision-record/0003-local-only-web-ui.md`
- `docs/architectural-decision-record/0004-sdk-style-projects-for-all-frameworks.md`

# The brief

!`gh issue view {{ISSUE}} --comments`

Every issue listed under "Blocked by" must already be closed. If one is open, stop, comment on this issue saying which, and output <promise>COMPLETE</promise>.

# What already exists and must survive

- The root `package.json` holds the Sandcastle harness that is running you (`@ai-hero/sandcastle`, `tsx`, the `sandcastle` script, `devEngines`). Extend it; never rewrite it from scratch.
- `.sandcastle/` is the harness configuration. Do not edit it unless the issue says to.
- `docs/` is the canon. Do not change the PRD or an ADR to match your code; if they disagree, say so on the issue.

# Invariants

- **core owns behaviour.** `cli` and `server` are thin adapters over `packages/core`.
- **The engine is narrow.** `engine/` does only "Assembly in → metadata / C# / XAML out" over JSON on stdio (ADR 0001). Pipeline, Dependency Resolution, solution generation, build verification and reporting live in TypeScript.
- **Managed Assemblies only.** Native Executables are detected and rejected (ADR 0002). Obfuscation is detected and flagged, never undone.
- **Local only.** The server binds to `127.0.0.1`; the user's files never leave the machine; the only network traffic is NuGet lookups/restores, disabled by `--offline` (ADR 0003).
- **SDK-style projects always**, original target framework preserved (ADR 0004).
- **Proof is a Round-trip.** A behaviour is done when a Fixture exercising it passes, not when the code looks right.
- Node 26+, pnpm 12+, ESM, strict TypeScript, Vitest, ESLint + Prettier.

# Task

Implement the issue above as a single vertical slice that meets every acceptance criterion. Commit in coherent steps with conventional commit messages. Do not widen the scope beyond "What to build"; anything you notice outside it goes in a comment on the issue.

# Verification

Run every check that exists in the workspace (once #3 has landed: `pnpm lint`, `pnpm typecheck`, `pnpm test`; once `engine/` exists: `dotnet test engine`), plus anything the acceptance criteria name. Paste their **real output** into a comment on the issue, and tick each acceptance criterion you have verified, saying how. Never reach green by skipping, deleting or weakening a test. If something cannot be verified in this sandbox (e.g. a Windows-only GUI launch), say so explicitly.

# Done

When every acceptance criterion is met and verified, or you are blocked, output <promise>COMPLETE</promise>.
