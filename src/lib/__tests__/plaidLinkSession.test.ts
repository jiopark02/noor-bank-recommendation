import { describe, it, expect, vi } from "vitest";
import {
  createLinkSession,
  LINK_START_FAILED_MESSAGE,
  LINK_TOKEN_FALLBACK_MESSAGE,
  LinkSessionState,
  LinkTokenResult,
} from "../../components/plaid/linkSession";

/**
 * The bank-link button's session logic, executed. The button itself cannot be
 * rendered here (no DOM environment); plaidLinkSessionWiring.test.ts holds the
 * wiring by source probe.
 *
 * Mutations that turn this file red:
 *   - the session requests a token when it is created          -> "creating"
 *   - the idle check in click() removed                        -> "one request per press"
 *   - finished() leaves the token, or click() reuses it        -> "exit drops", "success drops"
 *   - a failed request leaves the phase anything but idle      -> "a failed request"
 *   - the server's sentence replaced, or the fallback dropped  -> "a failed request", "a refusal with no sentence"
 *   - the override path asks the server                        -> "a re-link token"
 *   - an answer after dispose() or after finished() applied    -> "late answers"
 *   - attach() does not undo dispose()                         -> "re-attached"
 *   - dispose() leaves an abandoned request requesting         -> "abandoned while detached"
 *   - an answer from before dispose() applied after attach()   -> "abandoned while detached"
 *   - a press while detached asks the server                   -> "a press while detached"
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(options: { override?: string | null } = {}) {
  const pending: Array<ReturnType<typeof deferred<LinkTokenResult>>> = [];
  const requestToken = vi.fn(() => {
    const d = deferred<LinkTokenResult>();
    pending.push(d);
    return d.promise;
  });
  const changes: LinkSessionState[] = [];
  const session = createLinkSession({
    requestToken,
    overrideToken: () => options.override ?? null,
    onChange: (state) => changes.push(state),
  });
  return { session, requestToken, pending, changes };
}

/** Lets the promise callbacks inside the session run. */
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("link session", () => {
  it("creating a session requests nothing", () => {
    const { session, requestToken, changes } = setup();
    expect(requestToken).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(session.getState()).toEqual({ phase: "idle", token: null, error: null });
  });

  it("one request per press; a press while requesting or open asks for nothing", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(1);
    expect(session.getState().phase).toBe("requesting");

    session.click();
    expect(requestToken).toHaveBeenCalledTimes(1);

    pending[0].resolve({ ok: true, token: "link-1" });
    await settle();
    expect(session.getState()).toEqual({ phase: "open", token: "link-1", error: null });

    session.click();
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("exit drops the token, and the next press asks for a new one", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    pending[0].resolve({ ok: true, token: "link-1" });
    await settle();

    session.finished();
    expect(session.getState()).toEqual({ phase: "idle", token: null, error: null });

    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
    pending[1].resolve({ ok: true, token: "link-2" });
    await settle();
    expect(session.getState().token).toBe("link-2");
  });

  it("success drops the token the same way", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    pending[0].resolve({ ok: true, token: "link-1" });
    await settle();

    session.finished();
    expect(session.getState().token).toBeNull();
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
  });

  it("a failed request shows the server's sentence, returns to idle, and the next press asks again", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    pending[0].resolve({ ok: false, message: "Refused for now." });
    await settle();
    expect(session.getState()).toEqual({
      phase: "idle",
      token: null,
      error: "Refused for now.",
    });

    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
    // A new attempt clears the old sentence while it runs.
    expect(session.getState()).toEqual({ phase: "requesting", token: null, error: null });
  });

  it("a request that rejects is a failed attempt too, and can be retried", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    pending[0].reject(new Error("aborted"));
    await settle();
    expect(session.getState()).toEqual({
      phase: "idle",
      token: null,
      error: LINK_START_FAILED_MESSAGE,
    });
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
  });

  it("a refusal with no sentence falls back to the fixed one", async () => {
    const { session, pending } = setup();
    session.click();
    pending[0].resolve({ ok: false, message: "" });
    await settle();
    expect(session.getState().error).toBe(LINK_TOKEN_FALLBACK_MESSAGE);
  });

  it("Link failing to start drops the token and can be retried", async () => {
    const { session, requestToken, pending } = setup();
    session.click();
    pending[0].resolve({ ok: true, token: "link-1" });
    await settle();
    session.failed(LINK_START_FAILED_MESSAGE);
    expect(session.getState()).toEqual({
      phase: "idle",
      token: null,
      error: LINK_START_FAILED_MESSAGE,
    });
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
  });

  it("a re-link token opens without asking the server, and is dropped on exit", () => {
    const { session, requestToken } = setup({ override: "link-update-1" });
    session.click();
    expect(requestToken).not.toHaveBeenCalled();
    expect(session.getState()).toEqual({ phase: "open", token: "link-update-1", error: null });
    session.finished();
    expect(session.getState().token).toBeNull();
    expect(requestToken).not.toHaveBeenCalled();
  });

  it("late answers: nothing applies after dispose(), or after the attempt ended", async () => {
    const disposedCase = setup();
    disposedCase.session.click();
    const before = disposedCase.changes.length;
    disposedCase.session.dispose();
    disposedCase.pending[0].resolve({ ok: true, token: "link-late" });
    await settle();
    expect(disposedCase.changes.length).toBe(before);
    expect(disposedCase.session.getState().token).toBeNull();

    const endedCase = setup();
    endedCase.session.click();
    endedCase.session.finished();
    endedCase.pending[0].resolve({ ok: true, token: "link-late" });
    await settle();
    expect(endedCase.session.getState()).toEqual({ phase: "idle", token: null, error: null });
  });
});

describe("link session: detach and attach again (effect cleanup, then the effect again)", () => {
  it("re-attached after cleanup: one request per press, and its answer opens Link", async () => {
    const { session, requestToken, pending } = setup();
    session.attach();
    session.dispose();
    session.attach();

    session.click();
    expect(requestToken).toHaveBeenCalledTimes(1);
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(1);

    pending[0].resolve({ ok: true, token: "link-1" });
    await settle();
    expect(session.getState()).toEqual({ phase: "open", token: "link-1", error: null });
  });

  it("a press while detached asks for nothing", () => {
    const { session, requestToken, changes } = setup();
    session.dispose();
    session.click();
    expect(requestToken).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it("abandoned while detached: the answer is dropped, and the button is pressable once attached", async () => {
    const { session, requestToken, pending, changes } = setup();
    session.click();
    session.dispose();

    // The answer arrives while detached: nothing changes, nothing is reported.
    const before = changes.length;
    pending[0].resolve({ ok: true, token: "link-late" });
    await settle();
    expect(changes.length).toBe(before);

    // Attached again: the button is told the session is idle.
    session.attach();
    expect(changes[changes.length - 1]).toEqual({ phase: "idle", token: null, error: null });
    session.click();
    expect(requestToken).toHaveBeenCalledTimes(2);
  });

  it("abandoned while detached: an answer that arrives after attach() is dropped too", async () => {
    const { session, pending } = setup();
    session.click();
    session.dispose();
    session.attach();

    pending[0].resolve({ ok: true, token: "link-late" });
    await settle();
    expect(session.getState()).toEqual({ phase: "idle", token: null, error: null });
  });
});
