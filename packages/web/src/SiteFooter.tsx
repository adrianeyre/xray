import { useEffect, useRef, useState } from "react";

import { Modal } from "./Modal.js";
import { POLICIES, REPOSITORY_URL, type PolicyId } from "./policies.js";

/**
 * The footer, kept at the bottom of the window: where Xray's design lives,
 * on GitHub, and its policies, each read in a modal.
 */
export function SiteFooter() {
  const [open, setOpen] = useState<PolicyId | null>(null);
  const footer = useRef<HTMLElement>(null);

  useEffect(() => {
    // Kept to its height, so the page scrolls focus clear of it (WCAG 2.4.11).
    const element = footer.current;
    if (element === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--footer-height", `${element.offsetHeight}px`),
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--footer-height");
    };
  }, []);

  return (
    <footer className="site-footer" ref={footer}>
      <div className="site-footer-inner">
        <a
          className="site-footer-github"
          href={REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
        >
          <GitHubMark />
          <span>Website design</span>
          <span className="visually-hidden">
            {" "}
            on GitHub (opens in a new tab)
          </span>
        </a>
        <nav aria-label="Policies">
          <ul className="site-footer-links">
            {POLICIES.map((policy) => (
              <li key={policy.id}>
                <button
                  type="button"
                  className="site-footer-link"
                  aria-haspopup="dialog"
                  onClick={() => setOpen(policy.id)}
                >
                  {policy.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {POLICIES.map((policy) => (
        <Modal
          key={policy.id}
          open={open === policy.id}
          title={policy.title}
          onClose={() => setOpen(null)}
          actions={[...policy.actions, { label: "Close", primary: true }]}
        >
          {policy.body}
        </Modal>
      ))}
    </footer>
  );
}

/** GitHub's mark, as one path. */
function GitHubMark() {
  return (
    <svg
      className="github-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
