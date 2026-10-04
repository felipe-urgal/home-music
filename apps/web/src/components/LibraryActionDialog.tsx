import { useEffect, useId, useRef } from 'react';
import { AlertTriangle, LoaderCircle, X } from 'lucide-react';
import './LibraryActionDialog.css';

type LibraryActionDialogProps = {
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

export function LibraryActionDialog({
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
}: LibraryActionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const hasInput = value !== undefined;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (!open) {
      if (dialog.open) dialog.close();
      return;
    }

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
      className={`library-action-dialog${danger ? ' is-danger' : ''}`}
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
        <header className="library-action-dialog__header">
          <div className="library-action-dialog__heading">
            {danger && (
              <span className="library-action-dialog__danger-icon" aria-hidden="true">
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
            className="library-action-dialog__close"
            aria-label="Fechar"
            disabled={busy}
            onClick={onClose}
          >
            <X />
          </button>
        </header>

        {hasInput && (
          <div className="library-action-dialog__body">
            <label className="library-action-dialog__field">
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
          <p className="library-action-dialog__error" role="alert">
            {error}
          </p>
        )}

        <footer className="library-action-dialog__actions">
          <button
            ref={cancelButtonRef}
            type="button"
            className="library-action-dialog__secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className={danger ? 'library-action-dialog__danger' : 'library-action-dialog__primary'}
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
