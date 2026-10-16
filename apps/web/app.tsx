import {
  Component,
  Suspense,
  lazy,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/layout";
import { EmptyState, Loading } from "./components/ui";
import { ExecutionProvider } from "./lib/workspace";

const Overview = lazy(() =>
  import("./pages/overview").then((m) => ({ default: m.OverviewPage })),
);
const DemoHome = lazy(() => import("./pages/demo").then(m => ({ default: m.DemoHome })));
const DemoRun = lazy(() => import("./pages/demo").then(m => ({ default: m.DemoRun })));
const DemoCompare = lazy(() => import("./pages/demo-compare").then(m => ({ default: m.DemoCompare })));
const Investigations = lazy(() =>
  import("./pages/investigations").then((m) => ({
    default: m.InvestigationsPage,
  })),
);
const Investigation = lazy(() =>
  import("./pages/investigation").then((m) => ({
    default: m.InvestigationPage,
  })),
);
const NewInvestigation = lazy(() =>
  import("./pages/new-investigation").then((m) => ({
    default: m.NewInvestigationPage,
  })),
);
const Cases = lazy(() =>
  import("./pages/cases").then((m) => ({ default: m.CasesPage })),
);
const Compare = lazy(() =>
  import("./pages/compare").then((m) => ({ default: m.ComparePage })),
);
const Evaluations = lazy(() =>
  import("./pages/evaluations").then((m) => ({ default: m.EvaluationsPage })),
);
const Tools = lazy(() =>
  import("./pages/tools").then((m) => ({ default: m.ToolsPage })),
);
const Settings = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1 },
    mutations: { retry: false },
  },
});
class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workspace rendering failed", error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="fatal-error">
          <h1>The workspace couldn’t render.</h1>
          <p>
            Your saved investigations are still on the server. Reload to try
            again.
          </p>
          <button
            className="button primary"
            onClick={() => window.location.reload()}
          >
            Reload workspace
          </button>
        </div>
      );
    return this.props.children;
  }
}
export function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ExecutionProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route index element={<DemoHome />} />
                  <Route path="demo/compare" element={<DemoCompare />} />
                  <Route path="demo/:id" element={<DemoRun />} />
                  <Route path="lab" element={<Overview />} />
                  <Route path="investigations" element={<Investigations />} />
                  <Route
                    path="investigations/new"
                    element={<NewInvestigation />}
                  />
                  <Route
                    path="investigations/:id"
                    element={<Investigation />}
                  />
                  <Route path="cases" element={<Cases />} />
                  <Route path="compare" element={<Compare />} />
                  <Route path="evaluations" element={<Evaluations />} />
                  <Route path="tools" element={<Tools />} />
                  <Route path="settings" element={<Settings />} />
                  <Route
                    path="*"
                    element={
                      <EmptyState
                        title="This page doesn’t exist"
                        action={
                          <Link className="button primary" to="/">
                            Back to demo
                          </Link>
                        }
                      >
                        Use the navigation to return to your workspace.
                      </EmptyState>
                    }
                  />
                </Route>
              </Routes>
            </Suspense>
          </ExecutionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
