// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { POLICIES, REPOSITORY_URL } from "./policies.js";
import { SiteFooter } from "./SiteFooter.js";

let root: Root | null = null;

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function render(): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<SiteFooter />));
  return container;
}

function footerButton(label: string): HTMLButtonElement {
  const button = [
    ...document.querySelectorAll<HTMLButtonElement>(".site-footer-link"),
  ].find((candidate) => candidate.textContent === label);
  if (button === undefined) {
    throw new Error(`No footer button "${label}".`);
  }
  return button;
}

function openDialogs(): HTMLDialogElement[] {
  return [...document.querySelectorAll<HTMLDialogElement>("dialog")].filter(
    (dialog) => dialog.open,
  );
}

describe("SiteFooter", () => {
  it("links the website's design on GitHub, with GitHub's mark, in a new tab", () => {
    render();

    const link = document.querySelector<HTMLAnchorElement>(
      ".site-footer-github",
    );
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/adrianeyre/xray",
    );
    expect(REPOSITORY_URL).toBe("https://github.com/adrianeyre/xray");
    expect(link?.target).toBe("_blank");
    expect(link?.rel).toBe("noreferrer");
    expect(link?.querySelector("svg.github-mark")).not.toBeNull();
    expect(link?.textContent).toBe(
      "Website design on GitHub (opens in a new tab)",
    );
  });

  it("lists the policies, in order, after the GitHub link", () => {
    render();

    expect(
      [...document.querySelectorAll(".site-footer-link")].map(
        (button) => button.textContent,
      ),
    ).toEqual([
      "Privacy Policy",
      "Terms and Conditions",
      "Cookie Policy",
      "Accessibility",
    ]);
    expect(document.querySelector("nav")?.getAttribute("aria-label")).toBe(
      "Policies",
    );
  });

  it("opens nothing until a policy is chosen", () => {
    render();

    expect(document.querySelectorAll("dialog")).toHaveLength(POLICIES.length);
    expect(openDialogs()).toHaveLength(0);
  });

  for (const policy of POLICIES) {
    describe(`${policy.label}`, () => {
      it("opens its modal: a header with its title and a close cross, a scrolling body, and a footer of buttons", () => {
        render();

        act(() => footerButton(policy.label).click());

        const [dialog] = openDialogs();
        expect(openDialogs()).toHaveLength(1);
        const frame = dialog?.querySelector(".modal-frame");
        expect(
          [...(frame?.children ?? [])].map((child) => child.className),
        ).toEqual(["modal-header", "modal-body", "modal-footer"]);

        const heading = dialog?.querySelector(".modal-header h2");
        expect(heading?.textContent).toBe(policy.title);
        expect(dialog?.getAttribute("aria-labelledby")).toBe(heading?.id);

        const close = dialog?.querySelector<HTMLButtonElement>(".modal-close");
        expect(close?.getAttribute("aria-label")).toBe(`Close ${policy.title}`);

        const body = dialog?.querySelector<HTMLElement>(".modal-body");
        expect(body?.tabIndex).toBe(0);
        expect(body?.textContent).toContain("Last updated");

        const buttons = [
          ...(dialog?.querySelectorAll(".modal-footer .button") ?? []),
        ].map((button) => button.textContent);
        expect(buttons.at(-1)).toBe("Close");
        expect(buttons).toHaveLength(policy.actions.length + 1);
      });

      it("closes with its cross", () => {
        render();
        act(() => footerButton(policy.label).click());

        act(() =>
          openDialogs()[0]
            ?.querySelector<HTMLButtonElement>(".modal-close")
            ?.click(),
        );

        expect(openDialogs()).toHaveLength(0);
      });

      it("closes with its footer's Close button", () => {
        render();
        act(() => footerButton(policy.label).click());

        const close = [
          ...(openDialogs()[0]?.querySelectorAll<HTMLButtonElement>(
            ".modal-footer button",
          ) ?? []),
        ].find((button) => button.textContent === "Close");
        act(() => close?.click());

        expect(openDialogs()).toHaveLength(0);
      });

      it("closes on Escape", () => {
        render();
        act(() => footerButton(policy.label).click());

        act(() => {
          openDialogs()[0]?.dispatchEvent(
            new Event("cancel", { cancelable: true }),
          );
        });

        expect(openDialogs()).toHaveLength(0);
      });

      it("closes when its backdrop is clicked, but not when its content is", () => {
        render();
        act(() => footerButton(policy.label).click());
        const dialog = openDialogs()[0];

        act(() =>
          dialog
            ?.querySelector<HTMLElement>(".modal-body")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        expect(openDialogs()).toHaveLength(1);

        act(() =>
          dialog?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
        );
        expect(openDialogs()).toHaveLength(0);
      });

      it("opens again after closing", () => {
        render();
        act(() => footerButton(policy.label).click());
        act(() =>
          openDialogs()[0]
            ?.querySelector<HTMLButtonElement>(".modal-close")
            ?.click(),
        );

        act(() => footerButton(policy.label).click());

        expect(openDialogs()).toHaveLength(1);
      });
    });
  }

  it("opens links in its footer in a new tab, saying so", () => {
    render();
    act(() => footerButton("Privacy Policy").click());

    const link =
      openDialogs()[0]?.querySelector<HTMLAnchorElement>(".modal-footer a");
    expect(link?.target).toBe("_blank");
    expect(link?.textContent).toBe("Ask a question (opens in a new tab)");
    expect(link?.getAttribute("href")).toBe(
      "https://github.com/adrianeyre/xray/issues",
    );
  });

  it("shows one policy at a time", () => {
    render();
    act(() => footerButton("Cookie Policy").click());
    act(() =>
      openDialogs()[0]
        ?.querySelector<HTMLButtonElement>(".modal-close")
        ?.click(),
    );
    act(() => footerButton("Accessibility").click());

    expect(
      openDialogs().map(
        (dialog) => dialog.querySelector(".modal-header h2")?.textContent,
      ),
    ).toEqual(["Accessibility Statement"]);
  });

  it("names each dialog by its title alone, not reading its whole policy out on opening", () => {
    render();
    act(() => footerButton("Privacy Policy").click());

    const dialog = openDialogs()[0];
    const titleId = dialog?.getAttribute("aria-labelledby") ?? "";
    expect(document.getElementById(titleId)?.textContent).toBe(
      "Privacy Policy",
    );
    expect(dialog?.hasAttribute("aria-describedby")).toBe(false);
  });

  it("states conformance with WCAG 2.2 at Level AA, what it does to meet it, and where it falls short", () => {
    render();
    act(() => footerButton("Accessibility").click());

    const body = openDialogs()[0]?.querySelector(".modal-body");
    expect(body?.querySelector(".policy-lead")?.textContent).toBe(
      "Conformance status: Xray’s web UI is built to meet the Web Content Accessibility Guidelines (WCAG) 2.2 at Level AA.",
    );
    expect(
      [...(body?.querySelectorAll("h3") ?? [])].map((h3) => h3.textContent),
    ).toEqual([
      "Our commitment",
      "What we have done",
      "Compatibility",
      "Known limitations",
      "If something does not work for you",
    ]);
    expect(
      [...(body?.querySelectorAll("li > strong") ?? [])].map(
        (strong) => strong.textContent,
      ),
    ).toEqual([
      "Keyboard access",
      "Screen readers",
      "Contrast",
      "Not by colour alone",
      "No dragging required",
      "Motion",
      "Target sizes",
      "Zoom and reflow",
      "Text spacing",
      "Errors",
      "Themes",
    ]);
  });
});
