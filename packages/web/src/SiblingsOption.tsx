/**
 * Whether to reconstruct the Sibling Assemblies beside the Assembly too (FR-11):
 * on unless turned off, as `--no-siblings` turns it off for `xray reconstruct`.
 * Each becomes a project of its own in the Recovered Solution, wired with a
 * `ProjectReference`; turned off, each is copied into `Dependencies/` and
 * referenced with a `HintPath` instead.
 */
export function SiblingsOption({
  siblings,
  onChange,
  busy,
}: {
  readonly siblings: boolean;
  readonly onChange: (siblings: boolean) => void;
  /** While a Reconstruction is starting or running, it cannot be changed. */
  readonly busy: boolean;
}) {
  return (
    <div className="siblings-option">
      <input
        id="siblings"
        name="siblings"
        type="checkbox"
        checked={siblings}
        disabled={busy}
        onChange={(event) => onChange(event.target.checked)}
        aria-describedby="siblings-hint"
      />
      <label htmlFor="siblings">Reconstruct Sibling Assemblies</label>
      <p id="siblings-hint" className="siblings-hint">
        Each of the application&apos;s own Assemblies beside it that it
        references becomes a project of its own in the solution. Turned off,
        each is copied into the solution as it is, and referenced there.
      </p>
    </div>
  );
}
