// Chrome native messaging framing: each message is a 4-byte little-endian length followed by that many bytes of UTF-8
// JSON. Chrome caps a message from the host to the browser at 1 MiB and one from the browser to the host at 64 MiB.

export const MAX_HOST_TO_BROWSER = 1024 * 1024;
export const MAX_BROWSER_TO_HOST = 64 * 1024 * 1024;

export function encodeMessage(message: unknown, maxBytes = MAX_HOST_TO_BROWSER): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.length > maxBytes) throw new Error(`native message of ${body.length} bytes exceeds the ${maxBytes} byte limit`);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length, 0);
  return Buffer.concat([head, body]);
}

/** Incremental decoder: push arbitrary chunks, get back every complete message they finish. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);
  constructor(private readonly maxBytes = MAX_BROWSER_TO_HOST) {}

  push(chunk: Buffer): unknown[] {
    this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    const out: unknown[] = [];
    for (;;) {
      if (this.buf.length < 4) break;
      const len = this.buf.readUInt32LE(0);
      if (len > this.maxBytes) throw new Error(`native message length ${len} exceeds the ${this.maxBytes} byte limit`);
      if (this.buf.length < 4 + len) break;
      const body = this.buf.subarray(4, 4 + len).toString("utf8");
      this.buf = this.buf.subarray(4 + len);
      out.push(JSON.parse(body));
    }
    return out;
  }
}
