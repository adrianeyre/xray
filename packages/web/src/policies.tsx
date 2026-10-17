import type { ReactNode } from "react";

import type { ModalAction } from "./Modal.js";

/** Where Xray's source, its issues and its releases are. */
export const REPOSITORY_URL = "https://github.com/adrianeyre/xray";
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const LICENCE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;

const UPDATED = "15 October 2026";

export type PolicyId = "privacy" | "terms" | "cookies" | "accessibility";

export interface Policy {
  readonly id: PolicyId;
  /** What the footer's button for it says. */
  readonly label: string;
  /** Its modal's heading. */
  readonly title: string;
  /** Its modal's footer buttons, besides Close. */
  readonly actions: readonly ModalAction[];
  readonly body: ReactNode;
}

function Updated() {
  return <p className="policy-updated">Last updated {UPDATED}.</p>;
}

/** The footer's policies, in the order it lists them. */
export const POLICIES: readonly Policy[] = [
  {
    id: "privacy",
    label: "Privacy Policy",
    title: "Privacy Policy",
    actions: [{ label: "Ask a question", href: ISSUES_URL }],
    body: (
      <>
        <Updated />
        <p className="policy-lead">
          Xray runs entirely on your computer. It has no accounts, no analytics,
          no telemetry and no advertising, and nothing you give it is uploaded
          anywhere.
        </p>
        <h3>What Xray handles, and where it goes</h3>
        <table className="policy-table">
          <thead>
            <tr>
              <th scope="col">What</th>
              <th scope="col">Where it goes</th>
              <th scope="col">How long it is kept</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Files you upload</th>
              <td>
                Copied to this session&rsquo;s Workspace, a temporary folder on
                this machine
              </td>
              <td>Deleted when Xray stops</td>
            </tr>
            <tr>
              <th scope="row">Paths you type</th>
              <td>Only to Xray&rsquo;s own server, on this machine</td>
              <td>For this session</td>
            </tr>
            <tr>
              <th scope="row">Recovered Solutions</th>
              <td>Written to the Workspace</td>
              <td>
                Deleted when Xray stops; a downloaded zip is saved only by your
                browser
              </td>
            </tr>
            <tr>
              <th scope="row">Package lookups</th>
              <td>
                The names and versions of an Assembly&rsquo;s references, sent
                to nuget.org or your configured NuGet sources
              </td>
              <td>As that source&rsquo;s own privacy policy says</td>
            </tr>
          </tbody>
        </table>
        <h3>Who can reach it</h3>
        <p>
          Xray&rsquo;s server listens only on <code>127.0.0.1</code>. Other
          computers cannot connect to it, and it refuses requests from web pages
          on any other site.
        </p>
        <h3>Network traffic</h3>
        <p>
          The only traffic Xray causes is NuGet package lookups and restores,
          for the references it resolves and the builds it verifies. It turns
          off the .NET SDK&rsquo;s telemetry for those builds. From the command
          line, <code>xray reconstruct --offline</code> makes no network calls
          at all.
        </p>
        <h3>Questions</h3>
        <p>
          Xray is open source, so you can check all of this in its code. Ask
          anything by opening an issue on GitHub.
        </p>
      </>
    ),
  },
  {
    id: "terms",
    label: "Terms and Conditions",
    title: "Terms and Conditions",
    actions: [{ label: "Read the MIT licence", href: LICENCE_URL }],
    body: (
      <>
        <Updated />
        <p className="policy-lead">
          Xray is free, open-source software under the MIT licence. Using it
          means accepting that licence and these terms.
        </p>
        <h3>Use it only where you have the right to</h3>
        <p>
          Xray is for Assemblies you own or have the right to analyse:
          recovering lost source for your own software, studying how C# features
          compile, or maintaining legacy internal applications. You are
          responsible for following the licence of any software you analyse, and
          the law where you are.
        </p>
        <h3>What it will not do</h3>
        <ul>
          <li>
            Undo obfuscation, or bypass licence checks or other protection.
          </li>
          <li>
            Run recovered code from this page. Only{" "}
            <code>xray reconstruct --run</code>, from the command line, does
            that, and only when you ask it to.
          </li>
        </ul>
        <h3>No warranty</h3>
        <p>
          Xray is provided &ldquo;as is&rdquo;, without warranty of any kind. A
          Recovered Solution can differ from the original source: review it
          before you rely on it.
        </p>
        <h3>Third-party software</h3>
        <p>
          Decompilation is powered by ILSpy&rsquo;s{" "}
          <code>ICSharpCode.Decompiler</code>, and code is shown in Monaco, both
          under the MIT licence. NuGet packages a Recovered Solution restores
          come under their own licences.
        </p>
        <h3>Changes</h3>
        <p>
          These terms can change with new versions of Xray. Each version&rsquo;s
          changes are listed in its changelog.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    label: "Cookie Policy",
    title: "Cookie Policy",
    actions: [],
    body: (
      <>
        <Updated />
        <p className="policy-lead">
          Xray sets no cookies, and stores nothing in your browser.
        </p>
        <table className="policy-table">
          <thead>
            <tr>
              <th scope="col">Storage</th>
              <th scope="col">Used by Xray</th>
              <th scope="col">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Cookies</th>
              <td>No</td>
              <td>It has no accounts or sessions to remember</td>
            </tr>
            <tr>
              <th scope="row">Local and session storage</th>
              <td>No</td>
              <td>It keeps no settings in the browser</td>
            </tr>
            <tr>
              <th scope="row">IndexedDB and caches</th>
              <td>No</td>
              <td>Everything it needs comes from its own server, each time</td>
            </tr>
            <tr>
              <th scope="row">Analytics and tracking</th>
              <td>No</td>
              <td>It has none</td>
            </tr>
          </tbody>
        </table>
        <h3>The page&rsquo;s address</h3>
        <p>
          While a Reconstruction runs, its ID is kept in the page&rsquo;s
          address, as <code>?reconstruction=&hellip;</code>, so reloading the
          page keeps following it. That is not a cookie: it goes only to
          Xray&rsquo;s own server, and means nothing once Xray stops.
        </p>
        <p>With nothing to consent to, there is no cookie banner.</p>
      </>
    ),
  },
  {
    id: "accessibility",
    label: "Accessibility",
    title: "Accessibility Statement",
    actions: [{ label: "Report a problem", href: ISSUES_URL }],
    body: (
      <>
        <Updated />
        <p className="policy-lead">
          Conformance status: Xray&rsquo;s web UI is built to meet the Web
          Content Accessibility Guidelines (WCAG) 2.2 at{" "}
          <strong>Level AA</strong>.
        </p>
        <h3>Our commitment</h3>
        <p>
          Xray should be usable by everyone who needs to recover a .NET
          application, including people who use a screen reader, magnification,
          speech input or a keyboard on its own, and people who need reduced
          motion or higher contrast.
        </p>
        <h3>What we have done</h3>
        <ul>
          <li>
            <strong>Keyboard access</strong>: every button, link, field, file
            and dialog can be reached and used with a keyboard alone, in a
            logical order, with a clear focus outline that is never hidden
            behind the footer. &ldquo;Skip to content&rdquo; is the first thing
            Tab reaches.
          </li>
          <li>
            <strong>Screen readers</strong>: headings and landmarks give the
            page its structure, every form field has a visible label, and the
            page&rsquo;s title says what it is doing. How far an upload or a
            Reconstruction has got, its outcome, and any error are announced as
            they happen.
          </li>
          <li>
            <strong>Contrast</strong>: text meets at least 4.5:1 against its
            background (3:1 for large text), and the edges of fields, focus
            outlines and meaningful icons at least 3:1, in light and dark mode.
            Windows&rsquo; contrast themes are respected.
          </li>
          <li>
            <strong>Not by colour alone</strong>: each stage&rsquo;s status, the
            outcome and each build diagnostic are given in words, as well as in
            colour.
          </li>
          <li>
            <strong>No dragging required</strong>: an Assembly or a folder can
            be dropped on the page, or chosen with{" "}
            <em>Choose a file&hellip;</em> or <em>Choose a folder&hellip;</em>,
            or its path typed.
          </li>
          <li>
            <strong>Motion</strong>: nothing moves for more than five seconds,
            and every animation is turned off when your system asks for reduced
            motion.
          </li>
          <li>
            <strong>Target sizes</strong>: every button and link is at least 24
            by 24 pixels, and the main actions are 44 pixels tall.
          </li>
          <li>
            <strong>Zoom and reflow</strong>: the page reflows to a single
            column, and stays usable at 400% zoom or 320 pixels wide, without
            scrolling sideways; only wide tables and code scroll, within
            themselves.
          </li>
          <li>
            <strong>Text spacing</strong>: content stays readable when you
            increase line height, letter spacing or word spacing in your
            browser.
          </li>
          <li>
            <strong>Errors</strong>: a path or file Xray cannot take is refused
            beside where you gave it, saying why, and what you typed is kept, so
            you never enter it again.
          </li>
          <li>
            <strong>Themes</strong>: light and dark, following your
            system&rsquo;s setting, both meeting the same contrast.
          </li>
        </ul>
        <h3>Compatibility</h3>
        <p>
          Xray&rsquo;s UI is designed for current versions of Chrome, Edge,
          Firefox and Safari, used with screen readers such as NVDA, JAWS,
          VoiceOver and Orca.
        </p>
        <h3>Known limitations</h3>
        <ul>
          <li>
            The code viewer is Monaco, the editor of Visual Studio Code. Press{" "}
            <kbd>Alt</kbd>+<kbd>F1</kbd> (<kbd>Option</kbd>+<kbd>F1</kbd> on a
            Mac) inside it for its own accessibility help, including a mode for
            screen readers. Tab moves out of it, to the rest of the page.
          </li>
          <li>
            Recovered code is shown as it was decompiled: its names, comments
            and layout come from the Assembly, not from us.
          </li>
          <li>
            The links to GitHub open pages we do not control, and cannot vouch
            for the accessibility of.
          </li>
          <li>
            Our accessibility work is based on our own testing, with automated
            tools, keyboard-only use and screen readers. Xray has not yet had an
            independent audit.
          </li>
        </ul>
        <h3>If something does not work for you</h3>
        <p>
          Please tell us: we would rather hear about a problem than leave it in
          place. Open an issue on GitHub, saying what you were trying to do, and
          the browser and assistive technology you use. Everything the UI does
          can also be done from the command line, with <code>xray inspect</code>{" "}
          and <code>xray reconstruct</code>.
        </p>
      </>
    ),
  },
];
