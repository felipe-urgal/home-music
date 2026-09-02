import { Component, Suspense, type ReactNode } from 'react';
import { ResponsiveState } from './ResponsiveState';

type LazySurfaceBoundaryProps = {
  children: ReactNode;
  loadingTitle: string;
  loadingDetail?: string;
};

type LazySurfaceErrorBoundaryProps = {
  children: ReactNode;
};

type LazySurfaceErrorBoundaryState = {
  failed: boolean;
};

class LazySurfaceErrorBoundary extends Component<
  LazySurfaceErrorBoundaryProps,
  LazySurfaceErrorBoundaryState
> {
  state: LazySurfaceErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazySurfaceErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <ResponsiveState
          variant="error"
          title="Não foi possível carregar esta área"
          detail="O arquivo da interface pode ter sido atualizado. Recarregue o aplicativo para tentar novamente."
        >
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>
            Recarregar aplicativo
          </button>
        </ResponsiveState>
      );
    }

    return this.props.children;
  }
}

export function LazySurfaceBoundary({
  children,
  loadingTitle,
  loadingDetail = 'Carregando somente os recursos necessários para esta área.'
}: LazySurfaceBoundaryProps) {
  return (
    <LazySurfaceErrorBoundary>
      <Suspense
        fallback={(
          <ResponsiveState
            variant="loading"
            title={loadingTitle}
            detail={loadingDetail}
          />
        )}
      >
        {children}
      </Suspense>
    </LazySurfaceErrorBoundary>
  );
}
