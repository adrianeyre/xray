import { describe, expect, it } from "vitest";

import { clampPosition } from "./code-viewer.js";

describe("clampPosition", () => {
  // "using Greetings;", then "", then "class P {}".
  const lines = ["using Greetings;", "", "class P {}"];
  const lengthOf = (line: number) => lines[line - 1]?.length ?? 0;

  it("keeps a place that is in the file", () => {
    expect(clampPosition({ line: 1, column: 7 }, 3, lengthOf)).toEqual({
      line: 1,
      column: 7,
    });
  });

  it("puts the cursor at the start of the line when no column is given", () => {
    expect(clampPosition({ line: 3, column: null }, 3, lengthOf)).toEqual({
      line: 3,
      column: 1,
    });
  });

  it("brings a place past the end of the file, or of its line, back to the nearest there is", () => {
    expect(clampPosition({ line: 9, column: 4 }, 3, lengthOf)).toEqual({
      line: 3,
      column: 4,
    });
    expect(clampPosition({ line: 2, column: 30 }, 3, lengthOf)).toEqual({
      line: 2,
      column: 1,
    });
    expect(clampPosition({ line: 0, column: 0 }, 3, lengthOf)).toEqual({
      line: 1,
      column: 1,
    });
    expect(clampPosition({ line: 5, column: 5 }, 0, () => 0)).toEqual({
      line: 1,
      column: 1,
    });
  });
});
