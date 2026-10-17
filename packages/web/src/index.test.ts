import { describe, expect, it } from "vitest";

import { packageName } from "./index.js";

describe("@xray/web", () => {
  it("compiles and exports its package name", () => {
    expect(packageName).toBe("@xray/web");
  });
});
