import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * A bottom sheet: what a popover becomes on a phone (docs/design.md §3). A handle, a title, the
 * content, and a two-button footer whose primary action names what it will do — "Go to 12
 * September", never "OK".
 *
 * Native `<dialog>` and its `showModal()`, never the checkbox or anchor variants, which lose
 * escape-to-close and focus containment (`AGENTS.md` → Web UI code).
 */
export function Sheet({
  open,
  title,
  confirm,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  /** Names what the primary button will do; omitted when the sheet's content is the action. */
  confirm?: string;
  onConfirm?: () => void;
  onClose: () => void;
  children: ComponentChildren;
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
      class="modal modal-bottom"
      aria-label={title}
      onClose={onClose}
      onCancel={onClose}
    >
      <div class="modal-box max-h-[85dvh] rounded-t-md border border-edge bg-panel pb-[env(safe-area-inset-bottom)]">
        <div
          class="mx-auto mb-3 h-1 w-10 rounded-full bg-edge"
          aria-hidden="true"
        />
        <h2 class="font-reading text-section font-semibold text-ink">
          {title}
        </h2>

        <div class="mt-3">{children}</div>

        <div class="mt-4 flex gap-2 border-t border-rule pt-3">
          <button
            type="button"
            class="btn btn-sm min-h-11 flex-1 border-edge bg-panel text-ui text-ink-2"
            onClick={onClose}
          >
            Cancel
          </button>
          {confirm !== undefined && (
            <button
              type="button"
              class="btn btn-sm min-h-11 flex-1 border-edge bg-panel text-ui text-primary"
              disabled={onConfirm === undefined}
              onClick={onConfirm}
            >
              {confirm}
            </button>
          )}
        </div>
      </div>
    </dialog>
  );
}
