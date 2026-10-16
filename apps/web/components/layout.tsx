import { Suspense, useEffect, useState } from "react";
import {
  Activity,
  ArrowRight,
  BookOpen,
  FlaskConical,
  GitCompareArrows,
  LayoutDashboard,
  Menu,
  Settings2,
  ShieldCheck,
  Workflow,
  Wrench,
  X,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { useExecution, useWorkspace } from "../lib/workspace";
import { needsReview } from "../lib/format";
import { Loading } from "./ui";

const navigation = [
  { to: "/", label: "Demo", icon: Activity },
  { to: "/lab", label: "Overview", icon: LayoutDashboard },
  { to: "/investigations", label: "Investigations", icon: Workflow },
  { to: "/cases", label: "Case library", icon: BookOpen },
  { to: "/compare", label: "Compare runs", icon: GitCompareArrows },
  { to: "/evaluations", label: "Evaluations", icon: FlaskConical },
  { to: "/tools", label: "Tools & workflow", icon: Wrench },
  { to: "/settings", label: "Configuration", icon: Settings2 },
];

export function Layout() {
  const location = useLocation();
  const guided = location.pathname === "/" || location.pathname.startsWith("/demo/");
  const [menuOpen, setMenuOpen] = useState(false);
  const { runs, config } = useWorkspace();
  const execution = useExecution();
  const reviews = runs.data?.filter(needsReview).length ?? 0;
  const current = navigation.find((item) =>
    item.to === "/"
      ? location.pathname === "/"
      : location.pathname.startsWith(item.to),
  );
  useEffect(() => {
    setMenuOpen(false);
    document.title = `${guided ? "Guided demo" : current?.label ?? "Workspace"} · JEV RCM`;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname, current?.label, guided]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menuOpen]);
  if (guided) return <div className="demo-shell">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="demo-header">
      <Link to="/" className="demo-brand"><Activity size={22} /><strong>JEV + OpenAI</strong><span>RCM proof of concept</span></Link>
      <Link to="/lab" className="demo-advanced-link">Advanced workspace <ArrowRight size={15} /></Link>
    </header>
    {execution.error && <div className="global-error" role="alert"><span>{execution.error}</span><button className="icon-button" aria-label="Dismiss error" onClick={execution.dismissError}><X size={17} /></button></div>}
    {execution.activeId && <div className="demo-active-notice" role="status">{execution.activeIds.length > 1 ? `${execution.activeIds.length} investigations are queued or running.` : "An investigation is running."} <Link to={`/demo/${execution.activeId}`}>View or pause it</Link>.</div>}
    <main id="main-content" className="demo-page"><Suspense fallback={<Loading />}><Outlet /></Suspense></main>
  </div>;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      {menuOpen && (
        <button
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside className={`sidebar ${menuOpen ? "is-open" : ""}`}>
        <Link to="/" className="brand">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            jev<span className="brand-caption">REVENUE OPERATIONS</span>
          </span>
        </Link>
        <span className="nav-label">WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `nav-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
              {to === "/investigations" && reviews > 0 && (
                <span
                  className="nav-count"
                  title="Investigations awaiting review"
                >
                  {reviews}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note">
          <FlaskConical size={19} />
          <strong>A space to investigate.</strong>
          <p>Explore how decisions evolve as evidence arrives.</p>
          <span className="sandbox-label">
            <span />
            Synthetic environment
          </span>
        </div>
        <div className="sidebar-footer">
          <span className="avatar">LR</span>
          <div>
            <strong>Local reviewer</strong>
            <span>Development workspace</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <Menu size={21} />
            </button>
            <span>RCM workspace</span>
            <span className="slash">/</span>
            <strong>{current?.label ?? "Investigation"}</strong>
          </div>
          <div className="topbar-meta">
            <ShieldCheck size={15} />
            <span>Synthetic data</span>
            <span
              className={`connection-dot ${config.isError ? "offline" : ""}`}
            />
            <span>
              {config.isError
                ? "API unavailable"
                : config.data
                  ? "Connected"
                  : "Connecting"}
            </span>
          </div>
        </header>
        {execution.activeId && (
          <div className="execution-banner" role="status">
            <span className="pulse-dot" />
            <span>
              {execution.stopping
                ? "Pausing after the current checkpoint…"
                : "An investigation is running in the background. You can close this tab."}
            </span>
            <Link to={`/investigations/${execution.activeId}`}>
              View investigation <ArrowRight size={14} />
            </Link>
          </div>
        )}
        {execution.error && (
          <div className="global-error" role="alert">
            <span>{execution.error}</span>
            <button
              className="icon-button"
              aria-label="Dismiss error"
              onClick={execution.dismissError}
            >
              <X size={17} />
            </button>
          </div>
        )}
        <main id="main-content" className="page">
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>JEV Investigation Lab</span>
          <span>Evidence behind every action.</span>
        </footer>
      </div>
    </div>
  );
}
