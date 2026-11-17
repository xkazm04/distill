// Packages the on-device public extension build. Nothing else in the repository makes a zip.
//
//   npm run pack:extension  -> apps/extension/release/distill-extension-<version>.zip
//     The download people load unpacked. It KEEPS the manifest `key` (a public key, not a secret), so the extension id
//     is the same on every computer - the Handrail native host allows exactly that id.
//   npm run pack:store      -> apps/extension/release/distill-extension-<version>-store.zip
//     The Chrome Web Store upload. The store refuses a manifest `key` and assigns its own id, so this copy strips it.
//
// Both: build the public variant (apps/extension/dist-public), run check-dist on it (and fail on any finding), scan
// the exact bytes going into the zip again, then write the zip and apps/extension/release/extension-id.txt.
// The own build (apps/extension/dist) is never packaged: it holds its builder's App Check debug token.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { extensionIdFromKey } from "./extension-id.mjs";

const store = process.argv.includes("--store");
const EXT = "apps/extension";
const DIST = `${EXT}/dist-public`;
const RELEASE = `${EXT}/release`;
const fail = (m) => { console.error(`pack-extension: ${m}`); process.exit(1); };

// The public build needs the Firebase web config (public by design) for Firebase AI Logic; without it the AI is off.
const REQUIRED = ["VITE_FIREBASE_API_KEY", "VITE_FIREBASE_PROJECT_ID", "VITE_FIREBASE_APP_ID"];
const dotenv = existsSync(".env") ? readFileSync(".env", "utf8") : "";
const has = (k) => Boolean(process.env[k]?.trim() || new RegExp(`^${k}=[ \\t]*\\S`, "m") /* "\\" in a template: a bare \s would be just "s" */.test(dotenv));
const missing = REQUIRED.filter((k) => !has(k));
if (missing.length) fail(`the Firebase web config is missing (${missing.join(", ")}); fill .env first - the zip would have no AI`);

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// npm is a .cmd on Windows, which needs a shell; node runs directly (its path may contain spaces).
const run = (cmd, args, shell = false) => {
  try { execFileSync(cmd, args, { stdio: "inherit", shell }); } catch { fail(`${[cmd, ...args].join(" ")} failed - not packaging`); }
};
run(npm, ["run", "build:public", "-w", "@distill/extension"], process.platform === "win32");
run(process.execPath, ["scripts/check-dist.mjs", DIST]);

// What goes into the zip, as bytes. The manifest is the only file that may differ from dist-public (store: no key).
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const manifest = JSON.parse(readFileSync(join(DIST, "manifest.json"), "utf8"));
if (typeof manifest.key !== "string" || !manifest.key) fail("dist-public/manifest.json has no `key`");
const id = extensionIdFromKey(manifest.key);
const { key: _key, ...withoutKey } = manifest;
const entries = walk(DIST).sort().map((f) => {
  const name = relative(DIST, f).replaceAll("\\", "/");
  const data = name === "manifest.json" && store ? Buffer.from(JSON.stringify(withoutKey, null, 2) + "\n") : readFileSync(f);
  return { name, data };
});

// Second lock on the exact bytes: the public rules again, and the store copy must have no key.
const NEVER = [/recaptcha/i, /FIREBASE_APPCHECK_DEBUG_TOKEN/, /firebaseappcheck/i, /firestore\.googleapis/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
for (const { name, data } of entries) {
  const text = data.toString("latin1");
  for (const re of NEVER) if (re.test(text)) fail(`${name} matches ${re} - not packaging`);
}
const packedManifest = JSON.parse(entries.find((e) => e.name === "manifest.json").data.toString("utf8"));
if (store && "key" in packedManifest) fail("the store copy still has a `key`");
if (!store && packedManifest.key !== manifest.key) fail("the download lost its `key`");

mkdirSync(RELEASE, { recursive: true });
const file = `${RELEASE}/distill-extension-${manifest.version}${store ? "-store" : ""}.zip`;
writeFileSync(file, zip(entries));
writeFileSync(`${RELEASE}/extension-id.txt`, `${id}\n`);
console.log(`pack-extension: wrote ${file} (${entries.length} files, manifest key ${store ? "stripped for the store" : "kept"})`);
console.log(`pack-extension: extension id ${id}${store ? " (the store assigns its own id to the uploaded copy)" : ""} -> ${RELEASE}/extension-id.txt`);

/** A plain zip (deflate), no dependencies. Fixed timestamps, so the same build gives the same bytes. */
function zip(files) {
  const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01 00:00
  const local = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name, "utf8");
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(DOS_TIME, 10); head.writeUInt16LE(DOS_DATE, 12); head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(8, 10); dir.writeUInt16LE(DOS_TIME, 12); dir.writeUInt16LE(DOS_DATE, 14); dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(data.length, 24); dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    local.push(head, nameBuf, packed);
    central.push(dir, nameBuf);
    offset += head.length + nameBuf.length + packed.length;
  }
  const centralSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
