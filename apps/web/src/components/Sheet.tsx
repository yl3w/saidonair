import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

/**
 * A bottom sheet: what a popover becomes on a phone (docs/design.md §3). A handle, a title, the
 * content, and a footer whose primary action names what it will do — "Go to 12 September", never
 * "OK".
 *
 * `dismiss` names the other button, and which word is right depends on when the content lands.
 * "Cancel" is honest for a sheet holding a draft the footer commits, and a lie for one whose
 * controls apply as they are tapped — there the button only closes, and it should say where it
 * goes.
 *
 * Native `<dialog>` and its `showModal()`, never the checkbox or anchor variants, which lose
 * escape-to-close and focus containment (`AGENTS.md` → Web UI code).
 */
export function Sheet({
  open,
  title,
  confirm,
  dismiss = "Cancel",
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  /** Names what the primary button will do; omitted when the sheet's content is the action. */
  confirm?: string;
  /** Names the closing button. Default "Cancel": right only where there is a draft to abandon. */
  dismiss?: string;
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
      <div class="modal-box modal-edge-bottom max-h-[85dvh] pb-[env(safe-area-inset-bottom)]">
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
            class="btn btn-quiet-secondary flex-1"
            onClick={onClose}
          >
            {dismiss}
          </button>
          {confirm !== undefined && (
            <button
              type="button"
              class="btn btn-quiet flex-1"
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
