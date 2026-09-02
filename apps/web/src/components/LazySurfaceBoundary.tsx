import { Component, Suspense, type ReactNode } from 'react';
import { ResponsiveState } from './ResponsiveState';

type LazySurfaceBoundaryProps = {
  children: ReactNode;
  loadingTitle: string;
  loadingDetail?: string;
  fullScreen?: boolean;
};

type LazySurfaceErrorBoundaryProps = {
  children: ReactNode;
  fullScreen: boolean;
};

type LazySurfaceErrorBoundaryState = {
  failed: boolean;
};

function withOptionalShell(content: ReactNode, fullScreen: boolean) {
  return fullScreen ? <main className="app-shell">{content}</main> : content;
}

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
      return withOptionalShell(
        <ResponsiveState
          variant="error"
          title="Não foi possível carregar esta área"
          detail="O arquivo da interface pode ter sido atualizado. Recarregue o aplicativo para tentar novamente."
        >
          <button className="primary-action" type="button" onClick={() => window.location.reload()}>
            Recarregar aplicativo
          </button>
        </ResponsiveState>,
        this.props.fullScreen
      );
    }

    return this.props.children;
  }
}

export function LazySurfaceBoundary({
  children,
  loadingTitle,
  loadingDetail = 'Carregando somente os recursos necessários para esta área.',
  fullScreen = false
}: LazySurfaceBoundaryProps) {
  const fallback = withOptionalShell(
    <ResponsiveState
      variant="loading"
      title={loadingTitle}
      detail={loadingDetail}
    />,
    fullScreen
  );

  return (
    <LazySurfaceErrorBoundary fullScreen={fullScreen}>
      <Suspense fallback={fallback}>
        {children}
      </Suspense>
    </LazySurfaceErrorBoundary>
  );
}
