import { useDeferredValue, useState } from "react";
import { ArrowRight, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { useWorkspace } from "../lib/workspace";
import { EmptyState, ErrorState, Loading, PageHeading } from "../components/ui";

export function CasesPage() {
  const { scenarios, runs } = useWorkspace();
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.toLowerCase());
  if (scenarios.isPending) return <Loading label="Loading the case library…" />;
  if (scenarios.isError)
    return (
      <ErrorState
        error={scenarios.error}
        retry={() => {
          void scenarios.refetch();
        }}
      />
    );
  const filtered = scenarios.data.filter((s) =>
    `${s.title} ${s.description} ${s.claimId}`.toLowerCase().includes(term),
  );
  return (
    <>
      <PageHeading
        eyebrow="CONTROLLED SCENARIOS"
        title="Case library"
        description="Explore different evidence patterns, missing information, and handoff outcomes."
      />
      <div className="library-toolbar">
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search cases"
            placeholder="Find a case…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">{filtered.length} synthetic cases</span>
      </div>
      <div className="case-grid">
        {filtered.map((scenario, index) => {
          const count = runs.data?.filter(
            (r) => r.scenarioId === scenario.id,
          ).length;
          return (
            <article className="case-card" key={scenario.id}>
              <div className="case-top">
                <span className={`case-number tone-${index % 3}`}>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="tag">Synthetic case</span>
              </div>
              <h2>{scenario.title}</h2>
              <p>{scenario.description}</p>
              <div className="case-meta">
                <span className="mono">{scenario.claimId}</span>
                <span>
                  {count === undefined ? "—" : `${count} recent runs`}
                </span>
              </div>
              <Link
                className="case-launch"
                to={`/investigations/new?case=${scenario.id}`}
              >
                Investigate this case <ArrowRight size={16} />
              </Link>
            </article>
          );
        })}
      </div>
      {!filtered.length && (
        <EmptyState title="No matching cases">
          Try a claim ID or a different search term.
        </EmptyState>
      )}
      <p className="footnote">
        Every execution mode uses these synthetic source records. Live modes
        make real model requests; they do not contact an insurer.
      </p>
    </>
  );
}
