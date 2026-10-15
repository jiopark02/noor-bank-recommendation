import { describe, it, expect } from "vitest";
import { readRequestJsonWithByteLimit } from "../boundedRequestJson";

/**
 * readRequestJsonWithByteLimit refuses bodies over the limit without trusting
 * Content-Length alone, and otherwise behaves like readRequestJson: anything
 * that is not JSON comes back as ok with value undefined.
 */

const LIMIT = 64;

function streamOf(
  chunks: Uint8Array[],
  onCancel?: () => void
): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i]);
        i += 1;
      } else {
        controller.close();
      }
    },
    cancel() {
      onCancel?.();
    },
  });
}

function fakeRequest(
  body: ReadableStream<Uint8Array> | null,
  headers: Record<string, string> = {}
): Pick<Request, "headers" | "body"> {
  return { headers: new Headers(headers), body: body as Request["body"] };
}

function jsonOfLength(bytes: number): string {
  // {"a":"xxx..."} — 8 bytes of framing.
  return JSON.stringify({ a: "x".repeat(bytes - 8) });
}

describe("size limit", () => {
  it("exactly the limit is read and parsed", async () => {
    const text = jsonOfLength(LIMIT);
    expect(new TextEncoder().encode(text).byteLength).toBe(LIMIT);
    const result = await readRequestJsonWithByteLimit(
      new Request("https://x.test", { method: "POST", body: text }),
      LIMIT
    );
    expect(result).toEqual({ kind: "ok", value: JSON.parse(text) });
  });

  it("one byte over the limit is too_large", async () => {
    const result = await readRequestJsonWithByteLimit(
      new Request("https://x.test", { method: "POST", body: jsonOfLength(LIMIT + 1) }),
      LIMIT
    );
    expect(result).toEqual({ kind: "too_large" });
  });

  it("a small Content-Length does not let a large body through, and the stream is cancelled", async () => {
    let cancelled = false;
    const big = new TextEncoder().encode(jsonOfLength(LIMIT * 4));
    const req = fakeRequest(
      streamOf([big.slice(0, LIMIT), big.slice(LIMIT)], () => {
        cancelled = true;
      }),
      { "content-length": "10" }
    );
    expect(await readRequestJsonWithByteLimit(req, LIMIT)).toEqual({ kind: "too_large" });
    expect(cancelled).toBe(true);
  });

  it("a Content-Length over the limit is refused without reading the body", async () => {
    let readerTaken = false;
    const body = {
      getReader() {
        readerTaken = true;
        throw new Error("body must not be read");
      },
    } as unknown as ReadableStream<Uint8Array>;
    const req = fakeRequest(body, { "content-length": String(LIMIT + 1) });
    expect(await readRequestJsonWithByteLimit(req, LIMIT)).toEqual({ kind: "too_large" });
    expect(readerTaken).toBe(false);
  });
});

describe("non-JSON keeps the readRequestJson behavior", () => {
  it("malformed JSON is ok with value undefined", async () => {
    const result = await readRequestJsonWithByteLimit(
      new Request("https://x.test", { method: "POST", body: "{not json" }),
      LIMIT
    );
    expect(result).toEqual({ kind: "ok", value: undefined });
  });

  it("no body is ok with value undefined", async () => {
    expect(await readRequestJsonWithByteLimit(fakeRequest(null), LIMIT)).toEqual({
      kind: "ok",
      value: undefined,
    });
  });

  it("a stream that errors is ok with value undefined", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("connection reset"));
      },
    });
    expect(await readRequestJsonWithByteLimit(fakeRequest(body), LIMIT)).toEqual({
      kind: "ok",
      value: undefined,
    });
  });

  it("multi-byte text split across chunks decodes intact", async () => {
    const bytes = new TextEncoder().encode(JSON.stringify({ a: "김성원 José" }));
    // {"a":" is bytes 0-5 and 김 is bytes 6-8, so 7 cuts inside the character.
    const req = fakeRequest(streamOf([bytes.slice(0, 7), bytes.slice(7)]));
    expect(await readRequestJsonWithByteLimit(req, LIMIT)).toEqual({
      kind: "ok",
      value: { a: "김성원 José" },
    });
  });

  it("a body that was already consumed is ok with value undefined", async () => {
    const request = new Request("https://x.test", { method: "POST", body: "{}" });
    await request.text();
    expect(request.bodyUsed).toBe(true);
    expect(await readRequestJsonWithByteLimit(request, LIMIT)).toEqual({
      kind: "ok",
      value: undefined,
    });
  });
});
