import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  afterClose,
  afterFailedAction,
  afterStart,
  afterVerify,
  answerStillCurrent,
  deleteButtonLabel,
  exportButtonLabel,
  isReauthRequiredAnswer,
  pressAction,
  readReauthAnswer,
  REAUTH_UI,
  showsCodeEntry,
  stageAfterFailedAction,
  type ReauthStage,
} from "../accountReauthClient";

/**
 * The settings screen's email-code step: the answer reader and the stage
 * transitions, executed, and the page's wiring, by source.
 *
 * Mutations and the test each one turns red:
 *   a non-200 answer read as a pass                                -> C1
 *   a locked code or a required verification not restarting       -> C1
 *   the delete or export request sent before the code step         -> C2
 *   the code or its step written to browser storage                -> C2
 *   a verified stage that verifies again, or is lost on a failure
 *   that does not ask for a new verification                      -> C4
 *   a 403 asking for a new verification not starting over          -> C4
 *   a new code that runs the action, leaves the old code typed,
 *   or hides a refusal                                            -> C5
 *   "Deleting…" shown while a code is being checked               -> C6
 *   the page setting a stage itself instead of from an outcome     -> C7
 *   a close that keeps any stage, or a late answer accepted        -> C8
 *   a modal exit that skips closeModal, or a late answer applied
 *   without the close check                                        -> C9
 *   a failed export showing the server's text or another sentence,
 *   or a throw before the export request reported as a failed
 *   export (the flag removed, or set after the request)           -> C10
 *   a verify with no readable answer running the action at once    -> C11
 *   a press after it sending the verify again                      -> C11
 *   a required verification after it starting over from idle,
 *   showing the server's words, or clearing the typed code          -> C12
 *   a refused new code from it falling back to code                -> C13
 *   a throwing verify thrown on, an unreadable body read as {}, or
 *   either action not handling the unconfirmed answer              -> C14
 *   an export kept open from unconfirmed that, after the user closed
 *   the modal, still closes a modal, shows a message or downloads  -> C15
 */

/** Runs one press the way the page does and returns the stage it leaves. */
function press(
  stage: ReauthStage,
  answer: Parameters<typeof readReauthAnswer>,
  action?: { status: number; body: unknown }
): { request: string; stage: ReauthStage; acted: boolean } {
  const kind = pressAction(stage);
  if (kind === "act") {
    const after = action ? stageAfterFailedAction(stage, action.status, action.body) : stage;
    return { request: "act", stage: after, acted: true };
  }
  const step = readReauthAnswer(...answer);
  const next = kind === "start" ? afterStart("idle", step) : afterVerify(step);
  if (next.proceed) {
    const after = action ? stageAfterFailedAction(next.stage, action.status, action.body) : next.stage;
    return { request: `${kind}+act`, stage: after, acted: true };
  }
  return { request: kind, stage: next.stage, acted: false };
}

describe("stage transitions", () => {
  it("C4 a verified code sends the next press straight to the action until the server asks for a new one", () => {
    // idle -> start -> code
    let r = press("idle", [200, { status: "sent" }]);
    expect(r).toEqual({ request: "start", stage: "code", acted: false });
    // code -> verify succeeds -> the action runs in the same press; it stops
    // part-way, and the stage stays verified
    r = press(r.stage, [200, { status: "verified" }], { status: 409, body: { code: "REVOKE_INCOMPLETE" } });
    expect(r).toEqual({ request: "verify+act", stage: "verified", acted: true });
    // verified -> the retry goes to the action with no verify, and survives
    // an unavailable check and any other failure
    for (const failure of [
      { status: 409, body: { code: "REVOKE_INCOMPLETE" } },
      { status: 503, body: { code: "REAUTH_CHECK_UNAVAILABLE" } },
      { status: 500, body: {} },
    ]) {
      r = press(r.stage, [200, {}], failure);
      expect(r, JSON.stringify(failure)).toEqual({ request: "act", stage: "verified", acted: true });
    }
    // the server asks for a new verification -> idle, and the next press starts
    for (const code of ["REAUTH_REQUIRED", "REAUTH_SESSION_UNAVAILABLE"]) {
      r = press("verified", [200, {}], { status: 403, body: { code } });
      expect(r, code).toEqual({ request: "act", stage: "idle", acted: true });
      expect(pressAction(r.stage)).toBe("start");
    }
    // a 403 with another code keeps the stage
    expect(stageAfterFailedAction("verified", 403, { code: "SOMETHING_ELSE" })).toBe("verified");
  });

  it("C4 a wrong code stays in code, a locked one starts over, and no code required acts at once", () => {
    expect(press("code", [403, { code: "REAUTH_CODE_REJECTED", error: "No." }])).toEqual({
      request: "verify",
      stage: "code",
      acted: false,
    });
    expect(press("code", [429, { code: "REAUTH_LOCKED", error: "Locked." }])).toEqual({
      request: "verify",
      stage: "idle",
      acted: false,
    });
    expect(press("idle", [200, { status: "not_required" }])).toEqual({
      request: "start+act",
      stage: "idle",
      acted: true,
    });
    expect(afterVerify(readReauthAnswer(403, { code: "REAUTH_CODE_REJECTED", error: "No." })).error).toBe("No.");
    expect(afterVerify(readReauthAnswer(200, { status: "verified" }))).toEqual({
      stage: "verified",
      proceed: true,
      error: null,
      notice: REAUTH_UI.verified,
      clearCode: true,
    });
  });

  it("C5 a new code stays in code, clears the typed code, and shows the issue-limit and email-failure answers as they are", () => {
    expect(afterStart("code", readReauthAnswer(200, { status: "sent" }))).toEqual({
      stage: "code",
      proceed: false,
      error: null,
      notice: REAUTH_UI.newCodeSent,
      clearCode: true,
    });
    const limit = "Too many codes requested. Please wait a while and try again.";
    const mail = "We couldn't send the email. Please try again.";
    for (const [status, code, message] of [
      [429, "REAUTH_RATE_LIMITED", limit],
      [502, "REAUTH_SEND_FAILED", mail],
    ] as const) {
      const next = afterStart("code", readReauthAnswer(status, { code, error: message }));
      expect(next, code).toEqual({ stage: "code", proceed: false, error: message, notice: null, clearCode: false });
    }
    // A new code never runs the action, whatever the answer.
    for (const answer of [
      [200, { status: "not_required" }],
      [200, { status: "verified" }],
      [503, {}],
    ] as const) {
      expect(afterStart("code", readReauthAnswer(answer[0], answer[1])).proceed).toBe(false);
    }
  });

  it("C8 closing starts over from every stage, and an answer sent before the close changes nothing", () => {
    expect(afterClose()).toEqual({ stage: "idle", proceed: false, error: null, notice: null, clearCode: true });
    expect(answerStillCurrent(0, 0)).toBe(true);
    expect(answerStillCurrent(0, 1)).toBe(false);
    expect(answerStillCurrent(3, 2)).toBe(false);

    // The page's sequence: a verify is sent in the code stage, the modal is
    // closed while it is out, then the answer "verified" arrives.
    for (const from of ["idle", "code", "verified"] as const) {
      let closes = 0;
      let stage: ReauthStage = from;
      const sentAt = closes;
      closes += 1;
      stage = afterClose().stage;
      const late = afterVerify(readReauthAnswer(200, { status: "verified" }));
      const acted = answerStillCurrent(sentAt, closes) ? late.proceed : false;
      if (answerStillCurrent(sentAt, closes)) stage = late.stage;
      expect(stage, from).toBe("idle");
      expect(acted, from).toBe(false);
      expect(pressAction(stage), from).toBe("start");
    }
  });

  it("C11 a verify with no readable answer waits for a press, then sends the action and never the verify again", () => {
    // No readable answer, whatever the status.
    expect(readReauthAnswer(200, undefined)).toEqual({ kind: "unknown" });
    expect(readReauthAnswer(502, undefined)).toEqual({ kind: "unknown" });
    // It does not run the action by itself, keeps the typed code and says so.
    expect(afterVerify({ kind: "unknown" })).toEqual({
      stage: "unconfirmed",
      proceed: false,
      error: REAUTH_UI.verifyUnknown,
      notice: null,
      clearCode: false,
    });
    expect(REAUTH_UI.verifyUnknown).toBe(
      "Connection lost while checking your code. Press again to continue."
    );
    // The next press is the action itself.
    expect(pressAction("unconfirmed")).toBe("act");

    // The page's sequence, request by request.
    for (const [label, action, stage] of [
      ["the check passes", undefined, "unconfirmed"],
      ["the check asks for a verification", { status: 403, body: { code: "REAUTH_REQUIRED" } }, "code"],
    ] as const) {
      const requests: string[] = [];
      let r = press("code", [503, undefined]);
      requests.push(r.request);
      expect(r, label).toEqual({ request: "verify", stage: "unconfirmed", acted: false });
      r = press(r.stage, [200, {}], action);
      requests.push(r.request);
      expect(requests, label).toEqual(["verify", "act"]);
      expect(r.stage, label).toBe(stage);
    }
  });

  it("C12 after an unconfirmed code, a required verification returns to the code stage with its own words and keeps the code", () => {
    expect(REAUTH_UI.codeUnconfirmed).toBe(
      "We couldn't confirm your code. Check it and press again, or request a new one."
    );
    const required = { code: "REAUTH_REQUIRED", error: "Server words." };
    expect(stageAfterFailedAction("unconfirmed", 403, required)).toBe("code");
    const back = afterFailedAction("unconfirmed", 403, required);
    expect(back).toEqual({
      stage: "code",
      proceed: false,
      error: REAUTH_UI.codeUnconfirmed,
      notice: null,
      clearCode: false,
    });
    // The kept code is what the next press sends: the code stage verifies.
    expect(pressAction(back!.stage)).toBe("verify");
    // A session the server cannot use starts over, as from any stage.
    expect(stageAfterFailedAction("unconfirmed", 403, { code: "REAUTH_SESSION_UNAVAILABLE" })).toBe("idle");
    expect(afterFailedAction("unconfirmed", 403, { code: "REAUTH_SESSION_UNAVAILABLE" })).toBeNull();
    // Any other failure keeps unconfirmed, so a retry goes to the action again.
    for (const [status, body] of [
      [409, { code: "REVOKE_INCOMPLETE" }],
      [503, { code: "REAUTH_CHECK_UNAVAILABLE" }],
      [500, {}],
      [503, { code: "REAUTH_REQUIRED" }],
    ] as const) {
      expect(stageAfterFailedAction("unconfirmed", status, body), String(status)).toBe("unconfirmed");
      expect(afterFailedAction("unconfirmed", status, body), String(status)).toBeNull();
    }
    // The other stages keep their answers.
    expect(afterFailedAction("verified", 403, required)).toBeNull();
    expect(stageAfterFailedAction("verified", 403, required)).toBe("idle");
  });

  it("C13 unconfirmed shows the code field; a new code moves to code, a refused one stays", () => {
    expect(showsCodeEntry("code")).toBe(true);
    expect(showsCodeEntry("unconfirmed")).toBe(true);
    expect(showsCodeEntry("idle")).toBe(false);
    expect(showsCodeEntry("verified")).toBe(false);
    expect(afterStart("unconfirmed", { kind: "sent" }).stage).toBe("code");
    expect(afterStart("unconfirmed", { kind: "error", message: "Limit." })).toEqual({
      stage: "unconfirmed",
      proceed: false,
      error: "Limit.",
      notice: null,
      clearCode: false,
    });
    expect(afterStart("unconfirmed", { kind: "unknown" }).stage).toBe("unconfirmed");
    expect(afterStart("unconfirmed", { kind: "not_required" }).proceed).toBe(false);
    expect(deleteButtonLabel("unconfirmed", null)).toBe(REAUTH_UI.deleteConfirm);
    expect(exportButtonLabel("unconfirmed", null)).toBe(REAUTH_UI.exportConfirm);
  });

  it("C6 the delete button says Deleting only while the delete request itself is out", () => {
    expect(deleteButtonLabel("idle", "start")).toBe(REAUTH_UI.working);
    expect(deleteButtonLabel("code", "verify")).toBe(REAUTH_UI.working);
    expect(deleteButtonLabel("verified", "act")).toBe(REAUTH_UI.deleting);
    expect(deleteButtonLabel("code", "act")).toBe(REAUTH_UI.deleting);
    expect(deleteButtonLabel("idle", null)).toBe(REAUTH_UI.start);
    expect(deleteButtonLabel("code", null)).toBe(REAUTH_UI.deleteConfirm);
    expect(deleteButtonLabel("verified", null)).toBe(REAUTH_UI.deleteConfirm);
    expect(exportButtonLabel("code", "verify")).toBe(REAUTH_UI.working);
    expect(exportButtonLabel("verified", null)).toBe(REAUTH_UI.exportConfirm);
  });
});

describe("readReauthAnswer", () => {
  it("C1 only a 200 with a known status passes, and a used-up code restarts", () => {
    expect(readReauthAnswer(200, { status: "sent" })).toEqual({ kind: "sent" });
    expect(readReauthAnswer(200, { status: "verified" })).toEqual({ kind: "verified" });
    expect(readReauthAnswer(200, { status: "not_required" })).toEqual({ kind: "not_required" });
    expect(readReauthAnswer(200, { status: "other" }).kind).toBe("error");
    expect(readReauthAnswer(200, null).kind).toBe("error");
    expect(readReauthAnswer(403, { status: "verified", code: "REAUTH_CODE_REJECTED", error: "No." })).toEqual({
      kind: "error",
      message: "No.",
    });
    expect(readReauthAnswer(429, { code: "REAUTH_LOCKED", error: "Locked." })).toEqual({
      kind: "restart",
      message: "Locked.",
    });
    expect(readReauthAnswer(403, { code: "REAUTH_REQUIRED", error: "Again." }).kind).toBe("restart");
    expect(readReauthAnswer(503, "not json")).toEqual({ kind: "error", message: REAUTH_UI.fallback });
    expect(isReauthRequiredAnswer(403, { code: "REAUTH_REQUIRED" })).toBe(true);
    expect(isReauthRequiredAnswer(503, { code: "REAUTH_REQUIRED" })).toBe(false);
    expect(isReauthRequiredAnswer(403, { code: "REAUTH_CHECK_UNAVAILABLE" })).toBe(false);
  });
});

describe("settings page wiring", () => {
  const PAGE = readFileSync(
    fileURLToPath(new URL("../../app/settings/page.tsx", import.meta.url)),
    "utf8"
  ).replace(/\s+/g, " ");

  function between(from: string, to: string): string {
    const start = PAGE.indexOf(from);
    const end = PAGE.indexOf(to, start + from.length);
    if (start < 0 || end < 0) throw new Error(`could not bound \`${from}\` … \`${to}\``);
    return PAGE.slice(start, end);
  }

  it("C3 the first-step words promise no email, since the first press may run the action at once", () => {
    const firstStep = [
      deleteButtonLabel("idle", null),
      deleteButtonLabel("idle", "start"),
      exportButtonLabel("idle", null),
      exportButtonLabel("idle", "start"),
      REAUTH_UI.exportTitle,
      REAUTH_UI.exportBody,
    ];
    for (const words of firstStep) {
      expect(words).not.toMatch(/email me|sending|we'll email|we will email|send (you )?a code/i);
    }
    expect(REAUTH_UI.exportBody).toContain("we may email you a code");
    // Both modals take their button's words from the label functions only.
    expect(PAGE).toContain("{deleteButtonLabel(reauthStage, reauthBusy)}");
    expect(PAGE).toContain("{exportButtonLabel(reauthStage, reauthBusy)}");
    expect(PAGE).not.toMatch(/Email me a code|Sending…|Deleting…|REAUTH_UI\.send/);
  });

  it("C9 every way out of a modal starts over, and every late answer is checked against the closes", () => {
    const close = between("const closeModal = () => {", "const postReauth = async");
    expect(close).toContain("modalCloses.current += 1;");
    expect(close).toContain("applyReauthOutcome(afterClose());");
    expect(close).toContain("setReauthBusy(null);");
    // Every modal, by backdrop and by Cancel, closes through closeModal.
    expect(PAGE.split("<Modal onClose={closeModal}>").length - 1).toBe(PAGE.split("<Modal ").length - 1);
    // closeModal is the only place a modal is closed.
    expect(PAGE.split("setActiveModal(null)").length - 1).toBe(1);
    expect(close).toContain("setActiveModal(null)");
    const cancels = PAGE.split("Cancel </button>").length - 1;
    expect(cancels).toBeGreaterThan(0);
    expect(PAGE.split("<button onClick={closeModal}").length - 1).toBe(cancels);
    // The answers that can arrive after a close are each checked.
    const helpers = between("const advanceReauth = async", "const handleDeleteAccount = async");
    expect(helpers.split("answerStillCurrent(sentAt, modalCloses.current)").length - 1).toBe(2);
    expect(helpers.indexOf("answerStillCurrent(sentAt, modalCloses.current)")).toBeLessThan(
      helpers.indexOf("applyReauthOutcome(next);")
    );
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    expect(deletion.split("answerStillCurrent(sentAt, modalCloses.current)").length - 1).toBe(2);
  });

  it("C7 the page takes every stage change from the transition functions", () => {
    const helpers = between("const resetReauth = () =>", "const handleDeleteAccount = async");
    expect(helpers).toContain("const press = pressAction(reauthStage);");
    expect(helpers).toContain("if (press === 'act') return { proceed: true, stage: reauthStage };");
    expect(helpers).toContain("afterStart('idle', await postReauth('start', { purpose }))");
    expect(helpers).toContain("afterVerify(await postReauth('verify', { purpose, code: reauthCode }))");
    expect(helpers).toContain("const from = reauthStage === 'unconfirmed' ? 'unconfirmed' : 'code';");
    expect(helpers).toContain("const next = afterStart(from, await postReauth('start', { purpose }));");
    expect(helpers).toContain("if (answerStillCurrent(sentAt, modalCloses.current)) applyReauthOutcome(next);");
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    expect(deletion).toContain("stageAfterFailedAction(ready.stage, res.status, errBody)");
    expect(deletion).toContain("setReauthBusy('act');");
    // No stage is set by hand anywhere but from an outcome or the reset.
    expect(PAGE.split("setReauthStage(").length - 1).toBe(3);
    expect(PAGE).toContain("onClick={() => handleNewReauthCode('delete_account')}");
    expect(PAGE).toContain("onClick={() => handleNewReauthCode('export_data')}");
  });

  it("C14 a verify that throws or whose body cannot be read becomes unknown; both actions handle the unconfirmed answer", () => {
    const post = between("const postReauth = async", "const advanceReauth = async");
    // A verify request that throws is not thrown on; a start still is.
    expect(post).toContain("if (path === 'verify') return { kind: 'unknown' };");
    expect(post).toContain("throw err;");
    // An unreadable body is passed on as undefined, the unknown marker.
    expect(post).toContain("await res.json().catch(() => undefined);");
    expect(post).not.toContain("res.json().catch(() => ({}))");

    // Delete: the unconfirmed answer is handled before the other refusals.
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    const unconfirmedAt = deletion.indexOf("afterFailedAction(ready.stage, res.status, errBody)");
    expect(unconfirmedAt).toBeGreaterThan(-1);
    expect(unconfirmedAt).toBeLessThan(deletion.indexOf("stageAfterFailedAction(ready.stage, res.status, errBody)"));
    expect(deletion).toContain("if (unconfirmed) { applyReauthOutcome(unconfirmed); }");

    // Export: from unconfirmed the modal stays open until the answer, and the
    // unconfirmed answer is read after the export request.
    const exporting = between("const handleExportData = async", "const handleLogout");
    const fetchAt = exporting.indexOf("fetch('/api/account/export'");
    const keepOpen = exporting.indexOf("openUntilAnswer = ready.stage === 'unconfirmed';");
    expect(keepOpen).toBeGreaterThan(-1);
    expect(keepOpen).toBeLessThan(fetchAt);
    expect(exporting.indexOf("if (!openUntilAnswer) closeModal();")).toBeLessThan(fetchAt);
    expect(exporting.indexOf("afterFailedAction(ready.stage, res.status, errBody)")).toBeGreaterThan(fetchAt);

    // Both modals show the code field in code and unconfirmed alike.
    expect(PAGE.split("{showsCodeEntry(reauthStage) && (").length - 1).toBe(2);
    expect(PAGE).not.toContain("reauthStage === 'code'");
  });

  it("C15 an export kept open from unconfirmed and closed by the user before its answer is cancelled: no close, message or download", () => {
    const exporting = between("const handleExportData = async", "const handleLogout");
    // The user's close is told from this function's own close.
    expect(exporting).toContain(
      "const closedByUser = () => openUntilAnswer && !answerStillCurrent(sentAt, modalCloses.current);"
    );
    // Every closeModal after the modal was kept open goes through the check:
    // the session branch, the answer, and the catch.
    expect(exporting).toContain(
      "if (!rawAuth.Authorization) { if (closedByUser()) return; if (openUntilAnswer) { closeModal(); openUntilAnswer = false; }"
    );
    expect(exporting).toContain("} catch { if (closedByUser()) return; if (openUntilAnswer) closeModal();");
    // The answer: checked after the error body read, and a successful body is
    // cancelled, never downloaded.
    const CANCEL = "if (closedByUser()) { if (res.ok) await res.body?.cancel().catch(() => undefined); return; }";
    const cancelAt = exporting.indexOf(CANCEL);
    expect(cancelAt).toBeGreaterThan(exporting.indexOf("const errBody = res.ok ? null : await res.json()"));
    expect(cancelAt).toBeLessThan(exporting.indexOf("const blob = await res.blob();"));
    expect(cancelAt).toBeLessThan(exporting.indexOf("afterFailedAction(ready.stage, res.status, errBody)"));
    expect(exporting).toContain("closeModal(); openUntilAnswer = false; } if (!res.ok) {");
    // No closeModal in the function goes around the check: one before the
    // session read for the other stages, and the three above.
    expect(exporting.split("closeModal();").length - 1).toBe(4);
    expect(exporting.split("closedByUser()").length - 1).toBe(3);
    expect(exporting).not.toContain("answerStillCurrent(sentAt, modalCloses.current)) closeModal()");
  });

  it("C10 a failed export request shows the new-code sentence; a throw before the request does not", () => {
    expect(REAUTH_UI.exportFailed).toBe(
      "Your data couldn't be exported. Request a new code and try again."
    );
    const exporting = between("const handleExportData = async", "const handleLogout");
    const FLAG_SET = "exportRequested = true; const res = await fetch('/api/account/export'";
    // The flag starts false, before the try, and is set right before the
    // export request and nowhere else.
    expect(exporting.indexOf("let exportRequested = false;")).toBeGreaterThan(-1);
    expect(exporting.indexOf("let exportRequested = false;")).toBeLessThan(exporting.indexOf("try {"));
    expect(exporting).toContain(FLAG_SET);
    expect(exporting.split("exportRequested = true").length - 1).toBe(1);
    // A failed answer: always the new-code sentence.
    const afterFetch = exporting.slice(exporting.indexOf(FLAG_SET));
    const notOk = afterFetch.indexOf("if (!res.ok) {");
    expect(notOk).toBeGreaterThan(-1);
    expect(afterFetch.indexOf("showError(REAUTH_UI.exportFailed);")).toBeGreaterThan(notOk);
    expect(afterFetch.indexOf("showError(REAUTH_UI.exportFailed);")).toBeLessThan(
      afterFetch.indexOf("} catch {")
    );
    // A throw: the flag decides between the two sentences.
    const catchBody = afterFetch.slice(afterFetch.indexOf("} catch {"), afterFetch.indexOf("} finally {"));
    expect(catchBody).toContain(
      "showError(exportRequested ? REAUTH_UI.exportFailed : REAUTH_UI.fallback);"
    );
    expect(exporting.split("REAUTH_UI.exportFailed").length - 1).toBe(2);
    // The server's own error text no longer reaches the export toast.
    expect(exporting).not.toContain("errBody.error");
    expect(PAGE).not.toContain("Failed to export your data");
  });

  it("C2 each action runs the code step for its own purpose before its request, and stores nothing", () => {
    const deletion = between("const handleDeleteAccount = async", "const handleExportData");
    const step = deletion.indexOf("await advanceReauth('delete_account')");
    expect(step).toBeGreaterThan(-1);
    expect(deletion.indexOf("fetch('/api/account/delete'")).toBeGreaterThan(step);

    const exporting = between("const handleExportData = async", "const handleLogout");
    const exportStep = exporting.indexOf("await advanceReauth('export_data')");
    expect(exportStep).toBeGreaterThan(-1);
    expect(exporting.indexOf("fetch('/api/account/export'")).toBeGreaterThan(exportStep);

    const helpers = between("const resetReauth = () =>", "const handleDeleteAccount = async");
    expect(helpers).toContain("fetch(`/api/account/reauth/${path}`");
    expect(PAGE).not.toMatch(/(localStorage|sessionStorage)\.setItem\([^)]*reauth/i);
    expect(helpers).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
