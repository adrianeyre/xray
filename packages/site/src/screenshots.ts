// The pictures of `xray ui` the site shows, in static/images/, each written by
// capture-screenshots.ts from the UI itself reconstructing a Fixture.

export interface Screenshot {
  /** Its file, in static/images/. */
  readonly file: string;
  /** What it shows, for those who cannot see it. */
  readonly alt: string;
  /** Said below it. */
  readonly caption: string;
  /** Its size, in pixels, so the page keeps its place before it loads. */
  readonly width: number;
  readonly height: number;
}

/** An animation of a whole Reconstruction in `xray ui`, shown at the top of the page. */
export const TOUR: Screenshot = {
  file: "tour.gif",
  alt: "Xray's web UI: a path to a WPF app's Assembly is given and Reconstruct pressed; the pipeline's stages run to a Full Reconstruction, and the Recovered Solution's XAML and C# files are opened in the code viewer.",
  caption:
    "A WPF app reconstructed in `xray ui`, from its Assembly's path to its recovered XAML and C#.",
  width: 1200,
  height: 760,
};

export const SCREENSHOTS: readonly Screenshot[] = [
  {
    file: "reconstruction.png",
    alt: "The pipeline's stages, each done with its time, and the report of a Full Reconstruction: the Recovered Solution, its project and target framework, its types, resources and dependencies, and its build, which succeeded.",
    caption:
      "Each stage of the pipeline as it runs, then the report: here, a Full Reconstruction.",
    width: 1888,
    height: 1618,
  },
  {
    file: "recovered-solution.png",
    alt: "The Recovered Solution's file tree, with a window's XAML, recovered from its BAML, open in the code viewer.",
    caption:
      "The Recovered Solution, file by file: here, a window's XAML, recovered from its BAML.",
    width: 1888,
    height: 1416,
  },
  {
    file: "partial-reconstruction.png",
    alt: "The report of a Partial Reconstruction: the Recovered Solution was written, but one reference is an Unresolved Dependency, and the build failed with 1 error; each is given as a reason.",
    caption:
      "A Partial Reconstruction says exactly why: here, an Unresolved Dependency, and the build error it caused.",
    width: 1888,
    height: 1294,
  },
];
