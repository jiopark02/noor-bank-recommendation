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
//
// The button's effect attaches the session and its cleanup detaches it. React
// may run that cleanup and then the effect again on the same button (in
// development it always does once on mount), so a detached session can be
// attached again. While detached it changes nothing and reports nothing.
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
  /**
   * The button's effect was cleaned up: the session is detached. A request in
   * flight is abandoned (its answer is dropped, whenever it arrives) and the
   * session returns to idle, so it is pressable once attached again. A press
   * while detached does nothing.
   */
  dispose: () => void;
  /**
   * The button's effect ran: the session is attached and reports its current
   * state. A new session starts attached.
   */
  attach: () => void;
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
  let attached = true;
  // Each request carries the attempt it belongs to, so an answer that arrives
  // after the session moved on (or was detached) is dropped.
  let attempt = 0;

  function set(next: LinkSessionState): void {
    if (!attached) return;
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
      if (!attached || state.phase !== "idle") return;

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
          if (!attached || mine !== attempt) return;
          if (result.ok && result.token) {
            set({ phase: "open", token: result.token, error: null });
          } else {
            toIdle(
              (!result.ok && result.message) || LINK_TOKEN_FALLBACK_MESSAGE
            );
          }
        },
        () => {
          if (!attached || mine !== attempt) return;
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
      attached = false;
      // Without this, an abandoned request would leave the session requesting
      // with no answer to come, and the button disabled once attached again.
      if (state.phase === "requesting") {
        attempt += 1;
        state = IDLE_LINK_SESSION;
      }
    },

    attach() {
      attached = true;
      // The button's copy of the state may be stale after a detach.
      deps.onChange(state);
    },
  };
}
