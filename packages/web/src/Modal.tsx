import { useEffect, useId, useRef, type ReactNode } from "react";

export interface ModalAction {
  readonly label: string;
  /** The footer's main button, styled as the one to press; one at most. */
  readonly primary?: boolean;
  /** A link the button opens in a new tab, rather than an action. */
  readonly href?: string;
  /** Run when it is pressed; the modal closes afterwards unless it is a link. */
  readonly onClick?: () => void;
}

export interface ModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  /** The buttons in its footer, which stays in place as the body scrolls. */
  readonly actions: readonly ModalAction[];
  readonly children: ReactNode;
}

/**
 * A modal dialog: a header with its title and a close button, a body that
 * scrolls, both ways, when its content does not fit, and a footer of buttons.
 * The browser's own `<dialog>`, shown with `showModal()`, keeps focus inside
 * it and the page behind it inert, and closes it on Escape; clicking the
 * backdrop closes it too. Focus goes back to whatever opened it.
 */
export function Modal({ open, title, onClose, actions, children }: ModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (element === null) {
      return;
    }
    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={titleId}
      // Escape, or the dialog closing any other way, closes it here too.
      onClose={() => {
        if (open) {
          onClose();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // A click on the dialog itself, not its content, is on the backdrop.
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="modal-frame">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label={`Close ${title}`}
            onClick={onClose}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>
        <div
          className="modal-body"
          // Focusable, so it scrolls from the keyboard too.
          tabIndex={0}
          role="region"
          aria-label={`${title}: contents`}
        >
          {children}
        </div>
        <footer className="modal-footer">
          {actions.map((action) =>
            action.href === undefined ? (
              <button
                key={action.label}
                type="button"
                className={action.primary ? "button button-primary" : "button"}
                onClick={() => {
                  action.onClick?.();
                  onClose();
                }}
              >
                {action.label}
              </button>
            ) : (
              <a
                key={action.label}
                className={action.primary ? "button button-primary" : "button"}
                href={action.href}
                target="_blank"
                rel="noreferrer"
              >
                {action.label}
                <span className="visually-hidden"> (opens in a new tab)</span>
              </a>
            ),
          )}
        </footer>
      </div>
    </dialog>
  );
}
