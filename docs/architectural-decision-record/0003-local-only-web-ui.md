# Web UI runs locally; no hosted service

The primary interface is a browser UI, but it is served by `xray ui` on `127.0.0.1` rather than hosted publicly. A hosted service would store third-party executables and run `dotnet build` (and optionally the recovered program) on untrusted code on our infrastructure, carrying security, cost and legal burdens disproportionate to a developer tool. Locally, the user's own machine and rights apply, and nothing leaves it.

## Consequences

Users must install Node and a .NET SDK. Uploads and outputs live in a temporary workspace deleted when the server stops; there is no history of past Reconstructions.
