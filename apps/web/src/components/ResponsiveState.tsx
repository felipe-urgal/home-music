import { AlertTriangle, LoaderCircle, Music2 } from 'lucide-react';
import type { ReactNode } from 'react';

type ResponsiveStateProps = {
  variant: 'loading' | 'error' | 'empty';
  title: string;
  detail?: string;
  children?: ReactNode;
};

export function ResponsiveState({ variant, title, detail, children }: ResponsiveStateProps) {
  const Icon = variant === 'loading' ? LoaderCircle : variant === 'error' ? AlertTriangle : Music2;

  return (
    <div
      className={`responsive-state responsive-state--${variant}`}
      data-testid={`responsive-state-${variant}`}
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
    >
      <Icon className={variant === 'loading' ? 'responsive-state__spinner' : undefined} aria-hidden="true" />
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {children && <div className="responsive-state__actions">{children}</div>}
    </div>
  );
}
