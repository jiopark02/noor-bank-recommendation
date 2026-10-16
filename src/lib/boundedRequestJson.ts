/**
 * boundedRequestJson — reads a request body as JSON without reading more than
 * a fixed number of bytes.
 *
 * request.json() buffers the whole body before parsing, so a route that calls
 * it pays for any upload size it is sent. This reader refuses at once when
 * Content-Length declares more than the limit, and otherwise counts bytes as
 * the stream arrives and cancels it past the limit, so a missing or false
 * header does not get past it.
 *
 * Everything other than "too large" keeps the behavior of readRequestJson in
 * requestJson.ts: a body that is absent, already consumed, cannot be read, or
 * is not JSON comes back as `ok` with `value: undefined`, and the caller's
 * existing validation answers it as before.
 */

export type BoundedJsonResult =
  | { kind: "too_large" }
  | { kind: "ok"; value: unknown };

export async function readRequestJsonWithByteLimit(
  request: Pick<Request, "headers" | "body">,
  maxBytes: number
): Promise<BoundedJsonResult> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const declaredBytes = Number(declared);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { kind: "too_large" };
    }
  }

  const body = request.body;
  if (!body) {
    return { kind: "ok", value: undefined };
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    // Inside the try: a body that was already read is locked, and getReader()
    // throws; that is "cannot be read", not a server fault.
    const reader = body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { kind: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { kind: "ok", value: undefined };
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (let i = 0; i < chunks.length; i += 1) {
    bytes.set(chunks[i], offset);
    offset += chunks[i].byteLength;
  }

  try {
    return { kind: "ok", value: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { kind: "ok", value: undefined };
  }
}
