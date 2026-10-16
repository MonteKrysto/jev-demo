import { Database, FileSearch, Phone, ShieldCheck } from "lucide-react";
import { PageHeading, Panel } from "../components/ui";

import { toolCatalog } from "../../../packages/core/catalog";
const tools = toolCatalog.map((tool) => ({
  name: tool.name.replaceAll("_", " "),
  function: tool.name,
  icon:
    tool.name === "call_payer"
      ? Phone
      : tool.name === "get_documents"
        ? FileSearch
        : Database,
  description: tool.description,
  fields: tool.fields.map((f) => f.replaceAll("_", " ")).join(", "),
  source: "Versioned synthetic database records",
}));
export function ToolsPage() {
  return (
    <>
      <PageHeading
        eyebrow="UNDERSTAND THE SYSTEM"
        title="Tools & workflow"
        description="The capabilities currently connected to your investigation environment."
      />
      <div className="tool-grid">
        {tools.map(({ icon: Icon, ...tool }) => (
          <article className="panel tool-card" key={tool.function}>
            <div className="tool-card-top">
              <span className="tool-icon">
                <Icon size={23} />
              </span>
              <span className="tag">Read only</span>
            </div>
            <h2>{tool.name}</h2>
            <code>{tool.function}</code>
            <p>{tool.description}</p>
            <dl>
              <dt>Returns</dt>
              <dd>{tool.fields}</dd>
              <dt>Source</dt>
              <dd>{tool.source}</dd>
            </dl>
          </article>
        ))}
      </div>
      <Panel title="How an investigation progresses">
        <div className="workflow-explainer">
          {[
            [
              "01",
              "Evaluate",
              "JEV receives the evidence collected so far and selects the next permitted capability.",
            ],
            [
              "02",
              "Execute",
              "The assigned agent invokes its tool. In full live mode, OpenAI makes the function call and extracts the findings.",
            ],
            [
              "03",
              "Reconsider",
              "New observations enter the next decision checkpoint. Source verification checks extracted values against the tool receipts.",
            ],
            [
              "04",
              "Review",
              "A proposed Task Action and sourced completion note are held for review before the synthetic handoff is saved.",
            ],
          ].map(([step, title, description]) => (
            <div key={step}>
              <span>{step}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </Panel>
      <div className="explanation-grid">
        <div className="context-note">
          <ShieldCheck size={22} />
          <h3>Boundaries enforced by the application</h3>
          <p>
            Exact claim access, source validation, confidence gates, checkpoint
            and payer-contact limits, and approval before saving a handoff.
          </p>
        </div>
        <div className="context-note">
          <h3>The current decision space</h3>
          <p>
            JEV selects among the permitted investigative capabilities. OpenAI
            selects a tool within its assigned capability and returns sourced
            findings. Required evidence and call budgets are enforced by the
            application.
          </p>
          <p>
            Background workers save each checkpoint. Tool receipts are durable
            and reused when an interrupted extraction is retried.
          </p>
        </div>
      </div>
    </>
  );
}
