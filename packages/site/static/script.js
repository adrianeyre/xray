// The site's few enhancements; everything on the page works without them:
// the menu folds behind a button on narrow screens, each block of commands
// gets a copy button, and the footer's policies open in modal dialogs.

document.documentElement.classList.add("js");

// ---------- The menu, on narrow screens ----------

const toggle = document.querySelector(".menu-toggle");
const nav = document.getElementById("site-nav");
if (toggle && nav) {
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    nav.dataset.open = String(open);
  };
  toggle.addEventListener("click", () =>
    setOpen(toggle.getAttribute("aria-expanded") !== "true"),
  );
  // Choosing a section, or Escape, closes it.
  nav.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest("a")) {
      setOpen(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      toggle.getAttribute("aria-expanded") === "true"
    ) {
      setOpen(false);
      toggle.focus();
    }
  });
}

// ---------- Copy buttons ----------

const status = document.createElement("p");
status.className = "visually-hidden";
status.setAttribute("aria-live", "polite");
document.body.append(status);

for (const terminal of document.querySelectorAll(".terminal")) {
  const pre = terminal.querySelector("pre");
  if (!pre || !navigator.clipboard) {
    continue;
  }
  const button = document.createElement("button");
  button.type = "button";
  button.className = "copy-button";
  button.textContent = "Copy";
  const label = pre.getAttribute("aria-label");
  if (label) {
    button.setAttribute("aria-label", `Copy: ${label}`);
  }
  button.addEventListener("click", async () => {
    // The commands alone, without the comments beside them.
    const text = pre.innerText
      .split("\n")
      .map((line) => line.replace(/\s+#.*$/, ""))
      .join("\n")
      .trim();
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Copied";
      status.textContent = "Copied to the clipboard.";
    } catch {
      button.textContent = "Copy failed";
      status.textContent =
        "Could not copy: select the text and copy it instead.";
    }
    setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  });
  terminal.append(button);
}

// ---------- Policies, in modal dialogs ----------

for (const link of document.querySelectorAll("a[data-dialog]")) {
  const dialog = document.getElementById(link.hash.slice(1));
  if (!(dialog instanceof HTMLDialogElement)) {
    continue;
  }
  link.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.showModal();
  });
}

for (const dialog of document.querySelectorAll("dialog.policy")) {
  dialog
    .querySelector("[data-close]")
    ?.addEventListener("click", () => dialog.close());
  // A click on the backdrop, outside the dialog's frame, closes it.
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
}

// Opened at a policy's address, as from another page, show it as a dialog.
const opened =
  location.hash &&
  document.querySelector(`dialog.policy#${CSS.escape(location.hash.slice(1))}`);
if (opened instanceof HTMLDialogElement) {
  opened.showModal();
}
