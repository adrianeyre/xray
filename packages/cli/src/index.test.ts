import { describe, expect, it } from "vitest";

import {
  coreCommands,
  ExitCode,
  main,
  packageName,
  processIo,
} from "./index.js";

describe("@xray/cli", () => {
  it("compiles and exports its package name", () => {
    expect(packageName).toBe("@xray/cli");
  });

  it("exports what the published package runs the binary with", () => {
    expect(main).toBeTypeOf("function");
    expect(coreCommands).toBeTypeOf("function");
    expect(processIo.stdout).toBeTypeOf("function");
    expect(ExitCode.ok).toBe(0);
  });
});
