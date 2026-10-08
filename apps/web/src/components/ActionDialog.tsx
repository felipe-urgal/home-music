import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';
import './ActionDialog.css';

type ActionDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  value?: string;
  inputLabel?: string;
  placeholder?: string;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  confirmDisabled?: boolean;
  onValueChange?: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function ActionDialog({
  open,
  title,
  description,
  value,
  inputLabel = 'Nome',
  placeholder,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  confirmDisabled = false,
  onValueChange,
  onConfirm,
  onClose
}: ActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasInput = value !== undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      const previous = returnFocusRef.current;
      returnFocusRef.current = null;
      if (previous?.isConnected) window.requestAnimationFrame(() => previous.focus());
      return;
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();
    const frame = window.requestAnimationFrame(() => {
      if (hasInput) inputRef.current?.focus();
      else cancelButtonRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [hasInput, open]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const body = document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    root.style.overflow = 'hidden';
    body.style.overflow = 'hidden';

    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className={`action-dialog${danger ? ' is-danger' : ''}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={event => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={event => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <form
        onSubmit={event => {
          event.preventDefault();
          if (!busy && !confirmDisabled) onConfirm();
        }}
      >
        <header className="action-dialog__header">
          <div className="action-dialog__heading">
            {danger && (
              <span className="action-dialog__danger-icon" aria-hidden="true">
                <AlertTriangle />
              </span>
            )}
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <p id={descriptionId}>{description}</p>}
            </div>
          </div>
          <button
            type="button"
            className="action-dialog__close"
            aria-label="Fechar"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        {hasInput && (
          <div className="action-dialog__body">
            <label className="action-dialog__field">
              <span>{inputLabel}</span>
              <input
                ref={inputRef}
                data-autofocus
                autoComplete="off"
                value={value}
                placeholder={placeholder}
                disabled={busy}
                onChange={event => onValueChange?.(event.target.value)}
              />
            </label>
          </div>
        )}

        {error && (
          <p className="action-dialog__error" role="alert">
            {error}
          </p>
        )}

        <footer className="action-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="action-dialog__secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={danger ? 'action-dialog__danger' : 'action-dialog__primary'}
            disabled={busy || confirmDisabled}
          >
            {busy && <LoaderCircle className="is-spinning" aria-hidden="true" />}
            {busy ? 'Aguarde…' : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
