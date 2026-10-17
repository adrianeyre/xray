import type { DoctorReport } from "@xray/core";

/**
 * One `PASS` or `FAIL` line per check, then how to fix each failure, then a
 * one-line verdict.
 */
export function formatDoctorReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((check) => check.title.length));
  // Continuation lines line up under the summary.
  const indent = " ".repeat("PASS  ".length + width + 2);

  const lines = report.checks.flatMap((check) => {
    const status = check.passed ? "PASS" : "FAIL";
    const [first = "", ...rest] = check.summary.split("\n");
    return [
      `${status}  ${check.title.padEnd(width)}  ${first}`,
      ...rest.map((line) => (line === "" ? "" : `${indent}${line}`)),
      ...(check.fix === undefined ? [] : [`${indent}Fix: ${check.fix}`]),
    ];
  });

  const failed = report.checks.filter((check) => !check.passed).length;
  const verdict =
    failed === 0
      ? `All ${report.checks.length} checks passed.`
      : `${failed} of ${report.checks.length} checks failed.`;

  return `${[...lines, "", verdict].join("\n")}\n`;
}
