import { Component, ErrorInfo, ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || "The app hit an unexpected error while rendering.",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("AYMO render error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="theme-root">
          <div className="site-shell auth-loading">
            <div>
              <h2>Something went wrong</h2>
              <p>{this.state.message}</p>
              <button className="btn btn-solid" type="button" onClick={() => window.location.reload()}>
                Reload
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
