import { useDeferredValue } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { modeNames, needsReview, statusNames } from "../lib/format";
import { ErrorState, Loading, NewRunLink, PageHeading } from "../components/ui";
import { RunTable } from "../components/run-table";

export function InvestigationsPage() {
  const { runs, scenarios } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const term = useDeferredValue(search.toLowerCase());
  const status = params.get("status") ?? "all";
  const mode = params.get("mode") ?? "all";
  const filter = (key: string, value: string) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === "all" || !value) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  if (runs.isPending || scenarios.isPending) return <Loading />;
  if (runs.isError || scenarios.isError)
    return (
      <ErrorState
        error={runs.error ?? scenarios.error}
        retry={() => {
          void runs.refetch();
          void scenarios.refetch();
        }}
      />
    );
  const filtered = runs.data.filter((run) => {
    const title =
      scenarios.data.find((s) => s.id === run.scenarioId)?.title ?? "";
    return (
      `${run.claimId} ${run.id} ${title}`.toLowerCase().includes(term) &&
      (status === "all" ||
        (status === "review" ? needsReview(run) : run.status === status)) &&
      (mode === "all" || run.mode === mode)
    );
  });
  return (
    <>
      <PageHeading
        title="Investigations"
        description="Pick up an investigation, review its findings, or revisit a saved handoff."
        action={<NewRunLink />}
      />
      <div className="filter-tabs">
        <button
          className={status === "all" ? "selected" : ""}
          onClick={() => filter("status", "all")}
        >
          All investigations <span>{runs.data.length}</span>
        </button>
        <button
          className={status === "review" ? "selected" : ""}
          onClick={() => filter("status", "review")}
        >
          Awaiting review <span>{runs.data.filter(needsReview).length}</span>
        </button>
        <button
          className={status === "completed" ? "selected" : ""}
          onClick={() => filter("status", "completed")}
        >
          Saved handoffs
        </button>
      </div>
      <section className="panel">
        <div className="filter-bar">
          <label className="search-field">
            <Search size={17} />
            <input
              aria-label="Search investigations"
              placeholder="Search by claim, case, or run ID…"
              value={search}
              onChange={(event) => {
                filter("q", event.target.value);
              }}
            />
          </label>
          <div className="filter-controls">
            <SlidersHorizontal size={16} />
            <select
              aria-label="Filter by execution mode"
              value={mode}
              onChange={(event) => filter("mode", event.target.value)}
            >
              <option value="all">All execution modes</option>
              {Object.entries(modeNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => filter("status", event.target.value)}
            >
              <option value="all">All statuses</option>
              <option value="review">Awaiting review</option>
              {Object.entries(statusNames).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <RunTable runs={filtered} scenarios={scenarios.data} />
        <div className="table-footer">
          Showing {filtered.length} of {runs.data.length} loaded investigations
          · The latest 50 runs are available.
        </div>
      </section>
    </>
  );
}
