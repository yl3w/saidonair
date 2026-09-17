import { useEffect, useRef } from "preact/hooks";

/**
 * The one confirmation pattern. **Confirm only what someone else feels** (docs/design.md §4): this
 * is for declining an approved channel and nothing else so far, because pausing, starting a run and
 * retrying are reversible and affect nobody. The question names the consequence — who loses what —
 * rather than asking "are you sure".
 *
 * Native `<dialog>` and `showModal()`, never the checkbox or anchor variants, which lose
 * escape-to-close and focus containment (`AGENTS.md` → Web UI code).
 */
export function ConfirmDialog({
  open,
  title,
  question,
  confirmLabel,
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  question: string;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      class="modal"
      aria-label={title}
      onClose={onClose}
      onCancel={onClose}
    >
      <div class="modal-box modal-edge">
        <h2 class="font-reading text-section font-semibold text-ink">
          {title}
        </h2>
        <p class="mt-2 font-reading text-body text-ink-2">{question}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-quiet-secondary"
            onClick={onClose}
          >
            Keep it as it is
          </button>
          <button
            type="button"
            class="btn btn-outline btn-error"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
