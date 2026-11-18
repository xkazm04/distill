// Reads a zip in the browser, with no dependency: enough for the release zip scripts/pack-extension.mjs writes
// (stored or deflated entries, no zip64, no encryption). Every entry's size and CRC-32 is checked, and a name that
// could leave the folder it is unpacked into is refused.

export interface ZipEntry { name: string; data: Uint8Array }

export class ZipError extends Error {}

const MAX_ENTRIES = 2000;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A relative path of plain segments, forward slashes only: nothing absolute, no "..", no drive, no backslash. */
export function safeName(name: string): boolean {
  if (!name || name.length > 300 || name.startsWith("/") || /[\\:\0]/.test(name)) return false;
  return name.split("/").every((s) => s !== "" && s !== "." && s !== ".." && !/[<>"|?*]/.test(s) && !/[. ]$/.test(s));
}

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  // A failed write shows up on the reading side as well; this promise only needs to not go unhandled.
  void writer.write(data as Uint8Array<ArrayBuffer>).then(() => writer.close()).catch(() => undefined);
  const reader = stream.readable.getReader();
  const out = new Uint8Array(expected);
  let at = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (at + value.length > expected) { void reader.cancel().catch(() => undefined); throw new ZipError("an entry is larger than the zip says"); }
    out.set(value, at);
    at += value.length;
  }
  if (at !== expected) throw new ZipError("an entry is shorter than the zip says");
  return out;
}

/** Every file in the zip (folders are left out), in the zip's order. Throws ZipError on anything unexpected. */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes, or earlier when the zip has a comment (at most 65535 bytes).
  let end = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  }
  if (end < 0) throw new ZipError("this is not a zip file");
  const count = view.getUint16(end + 10, true);
  const dirSize = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) throw new ZipError("the zip holds too many files");
  if (at + dirSize > end) throw new ZipError("the zip's list of files is damaged");

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) throw new ZipError("the zip's list of files is damaged");
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const packedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    let name: string;
    try { name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)); } catch { throw new ZipError("a file name in the zip cannot be read"); }
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith("/")) continue; // a folder
    if (flags & 0x1) throw new ZipError("the zip is encrypted");
    if (packedSize === 0xffffffff || size === 0xffffffff || local === 0xffffffff) throw new ZipError("the zip is in a format Distill does not read");
    if (!safeName(name)) throw new ZipError(`the zip holds a file with an unsafe name (${JSON.stringify(name.slice(0, 60))})`);
    const key = name.toLowerCase(); // one file per name on a disk that ignores case
    if (seen.has(key)) throw new ZipError(`the zip holds ${name} twice`);
    seen.add(key);
    total += size;
    if (total > MAX_TOTAL_BYTES) throw new ZipError("the zip unpacks to more than Distill accepts");

    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50) throw new ZipError(`${name} is damaged in the zip`);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (start + packedSize > bytes.length) throw new ZipError(`${name} is cut short in the zip`);
    const packed = bytes.subarray(start, start + packedSize);
    let data: Uint8Array;
    if (method === 0) {
      if (packedSize !== size) throw new ZipError(`${name} is damaged in the zip`);
      data = packed.slice();
    } else if (method === 8) {
      try { data = await inflateRaw(packed, size); }
      catch (e) { throw e instanceof ZipError ? new ZipError(`${name}: ${e.message}`) : new ZipError(`${name} cannot be unpacked`); }
    } else throw new ZipError(`${name} is packed in a way Distill does not read`);
    if (crc32(data) !== crc) throw new ZipError(`${name} does not match its checksum`);
    entries.push({ name, data });
  }
  return entries;
}
