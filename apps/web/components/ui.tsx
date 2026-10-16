import type { ReactNode } from "react";
import { AlertCircle, ArrowRight, Inbox, LoaderCircle } from "lucide-react";
import { Link } from "react-router-dom";
import type { Run } from "../../../packages/core/domain";
import { statusNames } from "../lib/format";

export function Status({
  run,
  active = false,
}: {
  run: Run;
  active?: boolean;
}) {
  return (
    <span className={`status status-${active ? "running" : run.status}`}>
      <span className="status-dot" />
      {active ? "Investigating" : statusNames[run.status]}
    </span>
  );
}
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Loading({
  label = "Loading your workspace…",
}: {
  label?: string;
}) {
  return (
    <div className="state-panel" role="status">
      <LoaderCircle className="spin" size={26} />
      <p>{label}</p>
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <div className="state-panel error-state" role="alert">
      <AlertCircle size={28} />
      <h2>We couldn’t load this view</h2>
      <p>
        {error instanceof Error
          ? error.message
          : "Check your connection and try again."}
      </p>
      {retry && (
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel">
      <div className="empty-icon">
        <Inbox size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Panel({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function NewRunLink({
  children = "New investigation",
}: {
  children?: ReactNode;
}) {
  return (
    <Link className="button primary" to="/investigations/new">
      {children}
      <ArrowRight size={16} />
    </Link>
  );
}
