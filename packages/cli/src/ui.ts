import { spawn } from "node:child_process";

/** How opening a browser at `xray ui`'s address went. */
export type BrowserLaunch =
  /** A browser was asked to open it. */
  | "opened"
  /** None was asked to, as `BROWSER=none` says not to. */
  | "skipped"
  /** None could be asked to: this OS's command for opening one failed to start. */
  | "failed";

/**
 * Opens `url` in the user's default browser, with this OS's command for doing
 * so, unless the `BROWSER` environment variable is `none`.
 */
export function openBrowser(
  url: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<BrowserLaunch> {
  if (env.BROWSER === "none") {
    return Promise.resolve("skipped");
  }
  const [command, args] = browserCommand(url, platform);
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env,
      detached: true,
      stdio: "ignore",
      // `start`'s empty title has to reach cmd quoted as it is.
      windowsVerbatimArguments: platform === "win32",
    });
    child.once("error", () => resolve("failed"));
    child.once("spawn", () => {
      // Some browsers keep the command running while they are open.
      child.unref();
      resolve("opened");
    });
  });
}

/** This OS's command to open `url` in the default browser. */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform,
): [command: string, args: string[]] {
  switch (platform) {
    case "darwin":
      return ["open", [url]];
    case "win32":
      return ["cmd", ["/c", "start", '""', `"${url}"`]];
    default:
      return ["xdg-open", [url]];
  }
}

/** The signals that stop `xray ui`: Ctrl+C, a polite kill, and the terminal closing. */
export const STOP_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

export type StopSignal = (typeof STOP_SIGNALS)[number];

export interface StopRequest {
  /** Resolves with the first of the {@link STOP_SIGNALS} the process receives. */
  readonly stopped: Promise<StopSignal>;
  /** Stops listening, giving the signals back their default behaviour. */
  readonly dispose: () => void;
}

/**
 * Listens for the {@link STOP_SIGNALS}, in place of their default behaviour
 * of ending the process at once, so `xray ui` can stop its server and delete
 * its Workspace first. Until disposed, a signal received while it does so is
 * ignored rather than cutting that short.
 */
export function listenForStop(): StopRequest {
  let stop!: (signal: StopSignal) => void;
  const stopped = new Promise<StopSignal>((resolve) => (stop = resolve));
  const listener = (signal: NodeJS.Signals) => stop(signal as StopSignal);
  for (const signal of STOP_SIGNALS) {
    process.on(signal, listener);
  }
  return {
    stopped,
    dispose: () => {
      for (const signal of STOP_SIGNALS) {
        process.off(signal, listener);
      }
    },
  };
}
