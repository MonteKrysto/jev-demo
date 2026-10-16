import { useDeferredValue, useState } from "react";
import { AlertTriangle, CheckCircle2, Search } from "lucide-react";
import type { Run } from "../../../packages/core/domain";
import { factNames } from "../lib/format";
import { EmptyState } from "./ui";

export function Evidence({ run }: { run: Run }) {
  const [search, setSearch] = useState("");
  const term = useDeferredValue(search.toLowerCase());
  const facts = run.facts.filter((f) =>
    `${factNames[f.key]} ${f.value} ${f.sourceId}`.toLowerCase().includes(term),
  );
  if (!run.facts.length)
    return (
      <EmptyState title="No evidence gathered yet">
        Tool observations will appear here with the source behind each finding.
      </EmptyState>
    );
  return (
    <>
      <div className="filter-bar">
        <label className="search-field">
          <Search size={16} />
          <input
            aria-label="Search evidence"
            placeholder="Search findings or sources…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <span className="muted">
          {facts.length} of {run.facts.length} facts
        </span>
      </div>
      {run.conflicts.length > 0 && (
        <div className="conflict-notice">
          <AlertTriangle size={19} />
          <div>
            <strong>These sources disagree</strong>
            {run.conflicts.map((c) => (
              <p key={c}>{c}</p>
            ))}
          </div>
        </div>
      )}
      <div className="table-scroll">
        <table className="evidence-table">
          <thead>
            <tr>
              <th>Finding</th>
              <th>Value</th>
              <th>Source & verification</th>
            </tr>
          </thead>
          <tbody>
            {facts.map((fact) => {
              const receipt = run.receipts.find((r) => r.id === fact.sourceId);
              return (
                <tr key={fact.id}>
                  <td>{factNames[fact.key]}</td>
                  <td>{fact.value}</td>
                  <td>
                    <span
                      className={`verification ${fact.verified ? "verified" : ""}`}
                    >
                      <CheckCircle2 size={13} />
                      {fact.verified
                        ? "Verified against source"
                        : "Awaiting verification"}
                    </span>
                    <details className="source-details">
                      <summary>
                        {fact.sourceId.split(":").at(-1)} · View source
                      </summary>
                      <blockquote>{fact.quote}</blockquote>
                      {receipt && (
                        <>
                          <span className="small-note">
                            Full observation · {receipt.tool}
                          </span>
                          <pre>{receipt.text}</pre>
                        </>
                      )}
                    </details>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!facts.length && (
        <EmptyState title="No matching evidence">
          Try a different finding or source.
        </EmptyState>
      )}
    </>
  );
}
