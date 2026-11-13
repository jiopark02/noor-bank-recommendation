// =============================================================================
// One Plaid Link session per link token. No React and no network here: the
// button supplies the request and renders the state, so this logic runs in a
// test without a DOM.
//
// A link token is asked for when the user presses the button, never when the
// button mounts, and it serves one Link session only: when Link exits or
// succeeds the token is dropped, and the next press asks for a new one. A
// request that fails leaves the session idle with the error sentence, so the
// next press asks again.
// =============================================================================

/** What asking the server for a link token produced. */
export type LinkTokenResult =
  | { ok: true; token: string }
  | { ok: false; message: string };

export type LinkSessionPhase = "idle" | "requesting" | "open";

export type LinkSessionState = {
  phase: LinkSessionPhase;
  /** The token of the session that is open; null otherwise. */
  token: string | null;
  /** The sentence to show for the last failed attempt; null otherwise. */
  error: string | null;
};

export type LinkSessionDeps = {
  /** Asks the server for a new link token. Must not throw. */
  requestToken: () => Promise<LinkTokenResult>;
  /**
   * A token the caller already holds (a re-link token). When it returns one,
   * a press opens Link with it and requestToken is not called.
   */
  overrideToken: () => string | null;
  onChange: (state: LinkSessionState) => void;
};

export type LinkSession = {
  getState: () => LinkSessionState;
  /** The button was pressed. Does nothing unless the session is idle. */
  click: () => void;
  /** Link exited or succeeded: the token is dropped. */
  finished: () => void;
  /** Link could not start with the token: the token is dropped. */
  failed: (message: string) => void;
  /** The button unmounted: anything that answers later is dropped. */
  dispose: () => void;
};

export const LINK_TOKEN_FALLBACK_MESSAGE = "Failed to create link token";
export const LINK_START_FAILED_MESSAGE = "Failed to initialize Plaid";

export const IDLE_LINK_SESSION: LinkSessionState = {
  phase: "idle",
  token: null,
  error: null,
};

export function createLinkSession(deps: LinkSessionDeps): LinkSession {
  let state: LinkSessionState = IDLE_LINK_SESSION;
  let disposed = false;
  // Each request carries the attempt it belongs to, so an answer that arrives
  // after the session moved on is dropped.
  let attempt = 0;

  function set(next: LinkSessionState): void {
    if (disposed) return;
    state = next;
    deps.onChange(state);
  }

  function toIdle(error: string | null): void {
    attempt += 1;
    set({ phase: "idle", token: null, error });
  }

  return {
    getState: () => state,

    click() {
      if (disposed || state.phase !== "idle") return;

      const override = deps.overrideToken();
      if (override) {
        set({ phase: "open", token: override, error: null });
        return;
      }

      attempt += 1;
      const mine = attempt;
      set({ phase: "requesting", token: null, error: null });

      let pending: Promise<LinkTokenResult>;
      try {
        pending = deps.requestToken();
      } catch {
        pending = Promise.resolve({ ok: false, message: LINK_START_FAILED_MESSAGE });
      }
      pending.then(
        (result) => {
          if (disposed || mine !== attempt) return;
          if (result.ok && result.token) {
            set({ phase: "open", token: result.token, error: null });
          } else {
            toIdle(
              (!result.ok && result.message) || LINK_TOKEN_FALLBACK_MESSAGE
            );
          }
        },
        () => {
          if (disposed || mine !== attempt) return;
          toIdle(LINK_START_FAILED_MESSAGE);
        }
      );
    },

    finished() {
      toIdle(null);
    },

    failed(message: string) {
      toIdle(message || LINK_START_FAILED_MESSAGE);
    },

    dispose() {
      disposed = true;
    },
  };
}
