// The site's icons: simple strokes on a 24 by 24 grid, drawn for it, kept once
// in a sprite at the top of the page and used by name. Each is decorative,
// beside words that say the same, so each is hidden from screen readers.

const PATHS = {
  "arrow-right": "M5 12h14M13 6l6 6-6 6",
  check: "M5 12.5l4.5 4.5L19 7.5",
  copy: "M9 9h10v10H9zM5 15V5h10",
  menu: "M4 7h16M4 12h16M4 17h16",
  close: "M6 6l12 12M18 6L6 18",
  external: "M14 5h5v5M19 5l-8 8M17 14v5H5V7h5",
  monitor: "M3 5h18v11H3zM8 20h8M12 16v4",
  terminal: "M3 5h18v14H3zM7 10l3 2.5L7 15M12.5 15H17",
  search: "M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5L20 20",
  code: "M9 8l-4 4 4 4M15 8l4 4-4 4M13 6l-2 12",
  network:
    "M12 4v5M12 15v5M5 9h14M5 9v2M19 9v2M3 13h4v4H3zM17 13h4v4h-4zM10 13h4v4h-4z",
  folder: "M3 6h6l2 2h10v11H3z",
  hammer: "M14 4l6 6-3 3-6-6zM12 9l-8.5 8.5a1.5 1.5 0 0 0 2 2L14 11",
  play: "M7 5l12 7-12 7z",
  package: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  layers: "M12 4l9 5-9 5-9-5zM3 14l9 5 9-5",
  layout: "M3 4h18v16H3zM3 9h18M9 9v11",
  image: "M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01",
  report: "M8 4h8v3H8zM6 5H4v16h16V5h-2M8 13l2.5 2.5L16 10",
  shield: "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6z",
  "shield-check":
    "M12 3l8 3v6c0 4.5-3.5 7.5-8 9-4.5-1.5-8-4.5-8-9V6zM8.5 12l2.5 2.5 4.5-5",
  download: "M12 4v11M7 10l5 5 5-5M4 20h16",
  lock: "M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3",
  key: "M8 14a4 4 0 1 1 3.5-6M11 11h10M17 11v3M20 11v2",
  book: "M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2zM4 21V5M8 7h8",
  scale:
    "M12 4v16M6 20h12M4 9l2-4 2 4a2 2 0 0 1-4 0zM16 9l2-4 2 4a2 2 0 0 1-4 0zM6 5h12",
  help: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01",
  alert: "M12 3l9.5 17h-19zM12 10v4M12 17h.01",
  ban: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8",
  cpu: "M7 7h10v10H7zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z",
} as const;

export type IconName = keyof typeof PATHS;

/** Every icon, as `<symbol>`s, once, at the top of the page. */
export function iconSprite(): string {
  const symbols = Object.entries(PATHS)
    .map(
      ([name, d]) =>
        `<symbol id="i-${name}" viewBox="0 0 24 24"><path d="${d}" /></symbol>`,
    )
    .join("\n      ");
  return `<svg class="sprite" aria-hidden="true" focusable="false">
      ${symbols}
    </svg>`;
}

/** The icon `name`, drawn in the text colour around it, hidden from screen readers. */
export function icon(name: IconName, className = "icon"): string {
  return `<svg class="${className}" aria-hidden="true" focusable="false"><use href="#i-${name}" /></svg>`;
}

/** GitHub's mark, filled, as GitHub gives it for linking to GitHub. */
export function githubMark(className = "icon"): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" stroke="none" d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 0-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.6 1.6.2 2.8 0 3.2.9.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 5.9.5.4.9 1 .9 2.2v3.3c0 .3.1.7.8.6A12 12 0 0 0 12 .3" /></svg>`;
}
