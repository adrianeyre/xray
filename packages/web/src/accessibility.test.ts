import { describe, expect, it } from "vitest";

import { pageTitle } from "./App.js";
import type { ReconstructionEnd } from "./events.js";
import { stageAnnouncement } from "./ReconstructionProgress.js";
import {
  emptyView,
  type ReconstructionView,
  type StageStatus,
} from "./reconstruction-view.js";

/** A Reconstruction of `path` whose first stages stand as `statuses` say. */
function viewWith(
  statuses: readonly StageStatus[],
  path: string | null = "/home/me/MyApp.dll",
  end: ReconstructionEnd | null = null,
): ReconstructionView {
  const view = emptyView();
  return {
    ...view,
    path,
    end,
    stages: view.stages.map((stage, index) => ({
      ...stage,
      status: statuses[index] ?? "waiting",
    })),
  };
}

describe("what a screen reader is told of a Reconstruction", () => {
  it("is nothing before any stage has started", () => {
    expect(stageAnnouncement(viewWith([]))).toBe("");
  });

  it("is the stage it has reached, of how many, and how that stage stands", () => {
    expect(stageAnnouncement(viewWith(["finished", "running"]))).toBe(
      "Stage 2 of 6, Decompile: running.",
    );
    expect(
      stageAnnouncement(
        viewWith(["finished", "finished", "finished", "finished", "failed"]),
      ),
    ).toBe("Stage 5 of 6, Build: failed.");
  });
});

describe("the page's title", () => {
  it("is Xray's name until a Reconstruction is followed", () => {
    expect(pageTitle(null)).toBe("Xray");
    expect(pageTitle(viewWith([], null))).toBe("Xray");
  });

  it("says what is being done to which Assembly, by its name alone", () => {
    expect(pageTitle(viewWith(["running"]))).toBe(
      "Reconstructing MyApp.dll – Xray",
    );
    expect(pageTitle(viewWith(["running"], "C:\\Apps\\MyApp.exe"))).toBe(
      "Reconstructing MyApp.exe – Xray",
    );
    expect(
      pageTitle(
        viewWith(["failed"], "/home/me/MyApp.dll", {
          kind: "failed",
          code: null,
          message: "It cannot be read.",
        }),
      ),
    ).toBe("Could not reconstruct MyApp.dll – Xray");
  });
});
