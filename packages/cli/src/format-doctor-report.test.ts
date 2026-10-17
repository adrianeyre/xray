import type { DoctorReport } from "@xray/core";
import { describe, expect, it } from "vitest";

import { formatDoctorReport } from "./format-doctor-report.js";

describe("formatDoctorReport", () => {
  it("prints a PASS line per check and a verdict", () => {
    const report: DoctorReport = {
      passed: true,
      checks: [
        { id: "node", title: "Node.js", passed: true, summary: "26.10.0" },
        {
          id: "dotnet-sdk",
          title: ".NET SDK",
          passed: true,
          summary: "8.0.425 (/usr/share/dotnet/sdk)",
        },
        {
          id: "engine",
          title: "Xray engine",
          passed: true,
          summary: "0.0.0 (protocol 1, ICSharpCode.Decompiler 11.0.0)",
        },
      ],
    };

    expect(formatDoctorReport(report)).toBe(
      [
        "PASS  Node.js      26.10.0",
        "PASS  .NET SDK     8.0.425 (/usr/share/dotnet/sdk)",
        "PASS  Xray engine  0.0.0 (protocol 1, ICSharpCode.Decompiler 11.0.0)",
        "",
        "All 3 checks passed.",
        "",
      ].join("\n"),
    );
  });

  it("prints a FAIL line with how to fix it, indenting multi-line summaries", () => {
    const report: DoctorReport = {
      passed: false,
      checks: [
        { id: "node", title: "Node.js", passed: true, summary: "26.10.0" },
        {
          id: "dotnet-sdk",
          title: ".NET SDK",
          passed: false,
          summary: "Only .NET SDK 7.0.410 is installed; Xray needs 8 or later.",
          fix: "Install the .NET SDK 8 or later from https://dot.net.",
        },
        {
          id: "engine",
          title: "Xray engine",
          passed: false,
          summary:
            "The Xray engine exited unexpectedly (exit code 134).\n\nUnhandled exception: boom",
          fix: "Rebuild the engine with `pnpm build:engine` and try again.",
        },
      ],
    };

    expect(formatDoctorReport(report)).toBe(
      [
        "PASS  Node.js      26.10.0",
        "FAIL  .NET SDK     Only .NET SDK 7.0.410 is installed; Xray needs 8 or later.",
        "                   Fix: Install the .NET SDK 8 or later from https://dot.net.",
        "FAIL  Xray engine  The Xray engine exited unexpectedly (exit code 134).",
        "",
        "                   Unhandled exception: boom",
        "                   Fix: Rebuild the engine with `pnpm build:engine` and try again.",
        "",
        "2 of 3 checks failed.",
        "",
      ].join("\n"),
    );
  });
});
