import type { AssemblyIdentity, InspectJson } from "./events.js";
import { inspectFacts, inspectJsonText } from "./inspect-summary.js";

/**
 * The inspect summary of the Assembly being reconstructed (FR-5, FR-20):
 * what `xray inspect` says of it, field by field, then the document
 * `xray inspect --json` prints, as it prints it.
 */
export function InspectSummary({
  inspection,
}: {
  readonly inspection: InspectJson;
}) {
  const { references } = inspection;
  return (
    <section className="inspect" aria-label="Inspect summary">
      <h2>
        Inspect summary <code>{inspection.assembly.name}</code>
      </h2>
      <dl className="facts">
        {inspectFacts(inspection).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <h3>
        {references.length === 1
          ? "1 reference"
          : `${references.length} references`}
      </h3>
      {references.length === 0 ? (
        <p>It references no assembly.</p>
      ) : (
        <table className="references">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Version</th>
              <th scope="col">Culture</th>
              <th scope="col">Public key token</th>
            </tr>
          </thead>
          <tbody>
            {references.map((reference, index) => (
              <Reference key={index} reference={reference} />
            ))}
          </tbody>
        </table>
      )}
      <details className="inspect-json">
        <summary>
          As <code>xray inspect --json</code> prints it
        </summary>
        <pre
          role="region"
          aria-label="xray inspect --json"
          // It scrolls sideways; focusable, so it scrolls from the keyboard too.
          tabIndex={0}
        >
          <code>{inspectJsonText(inspection)}</code>
        </pre>
      </details>
    </section>
  );
}

function Reference({ reference }: { readonly reference: AssemblyIdentity }) {
  return (
    <tr>
      <td>{reference.name}</td>
      <td>{reference.version}</td>
      <td>{reference.culture ?? "neutral"}</td>
      <td>{reference.publicKeyToken ?? "none"}</td>
    </tr>
  );
}
