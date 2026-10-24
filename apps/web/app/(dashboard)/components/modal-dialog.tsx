'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog on the native `<dialog>` element (#652).
 *
 * `showModal()` makes the rest of the page inert and gives Escape for free.
 * On top of that, Tab and Shift+Tab wrap inside the dialog (rather than
 * leaving for the browser's own UI), and closing — by a button, Escape or the
 * parent — puts focus back on `returnFocusTo`, the control that opened it, so
 * a keyboard or screen reader user lands where they left off.
 *
 * `open` is the source of truth; Escape asks the parent to close through
 * `onClose` instead of closing the element behind React's back.
 */
export function ModalDialog({
  open,
  onClose,
  labelledBy,
  describedBy,
  returnFocusTo,
  initialFocus,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  describedBy?: string;
  returnFocusTo: RefObject<HTMLElement | null>;
  /** What to focus on open; defaults to the first focusable element. */
  initialFocus?: RefObject<HTMLElement | null>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || !open) return;
    if (!dialog.open) dialog.showModal();
    const first = initialFocus?.current ?? dialog.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => {
      if (dialog.open) dialog.close();
      returnFocusTo.current?.focus();
    };
  }, [open, initialFocus, returnFocusTo]);

  function trapTab(e: React.KeyboardEvent<HTMLDialogElement>) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Chrome may decline to let `cancel` be prevented (close watchers), in
      // which case the element closes itself; keep `open` in step with it.
      onClose={onClose}
      onKeyDown={trapTab}
      className="m-auto w-[min(560px,calc(100vw-2rem))] border border-[#1f1d19] bg-[#14120f] p-0 text-[#f5f4ee] shadow-xl backdrop:bg-black/70"
    >
      {children}
    </dialog>
  );
}
