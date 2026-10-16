import { Component, type PropsWithChildren } from 'react';
import { PageAccessNotice } from './PageAccessNotice';

class AccessBoundary extends Component<
  PropsWithChildren<{ renderError(message: string): React.ReactNode }>,
  { message: string }
> {
  state = { message: '' };
  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }
  render() {
    return this.state.message ? this.props.renderError(this.state.message) : this.props.children;
  }
}
export function PageAccessBoundary({ children, navigate }: PropsWithChildren<{ navigate(path: string): void }>) {
  return (
    <AccessBoundary
      renderError={(message) => <PageAccessNotice message={message} navigate={navigate} />}
    >
      {children}
    </AccessBoundary>
  );
}
