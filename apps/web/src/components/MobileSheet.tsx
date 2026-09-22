import { useEffect, useId, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

const FOCUSABLE_SELECTOR = [
  '[data-autofocus]',
  'button:not([disabled])',
  'a[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

type MobileSheetProps = {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function MobileSheet({ open, title, onClose, children, className = '' }: MobileSheetProps) {
  const titleId = useId();
  const sheetRef = useRef<HTMLElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dragStartRef = useRef<{ y: number; pointerId: number } | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open || typeof document === 'undefined') return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const previousRootOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.style.overflow = 'hidden';

    const frame = window.requestAnimationFrame(() => {
      const sheet = sheetRef.current;
      const initial = sheet?.querySelector<HTMLElement>('[data-autofocus]')
        ?? sheet?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      initial?.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const sheet = sheetRef.current;
      if (!sheet) return;

      const focusable = Array.from(sheet.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter(element => !element.hasAttribute('disabled'));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !sheet.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !sheet.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown);
      document.documentElement.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) window.requestAnimationFrame(() => previousFocus.focus());
    };
  }, [open]);

  function beginDrag(event: ReactPointerEvent<HTMLDivElement>) {
    dragStartRef.current = { y: event.clientY, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - start.y);
    if (sheetRef.current) sheetRef.current.style.transform = `translate(-50%, ${offset}px)`;
  }

  function finishDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const start = dragStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const offset = Math.max(0, event.clientY - start.y);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStartRef.current = null;

    if (sheetRef.current) sheetRef.current.style.transform = '';
    if (offset >= 80) onCloseRef.current();
  }

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-sheet-layer">
      <button
        className="mobile-sheet-backdrop"
        type="button"
        aria-label={`Fechar ${title}`}
        onClick={onClose}
      />
      <section
        ref={sheetRef}
        className={`mobile-sheet ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className="mobile-sheet__grabber-hitbox"
          aria-hidden="true"
          onPointerDown={beginDrag}
          onPointerMove={moveDrag}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className="mobile-sheet__grabber" />
        </div>
        <header className="mobile-sheet__header">
          <strong id={titleId}>{title}</strong>
          <button className="mobile-sheet__close" type="button" aria-label="Fechar" onClick={onClose}>
            <X aria-hidden="true" />
          </button>
        </header>
        <div className="mobile-sheet__content">{children}</div>
      </section>
    </div>,
    document.body
  );
}
