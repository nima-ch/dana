import { Component, type ReactNode } from "react"

type Props = { children: ReactNode }
type State = { hasError: boolean; message: string }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: "" }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message }
  }

  render() {
    if (this.state.hasError) {
      return <div className="flex min-h-screen items-center justify-center bg-background p-6 text-center text-foreground">An unexpected error occurred.</div>
    }
    return this.props.children
  }
}
