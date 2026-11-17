import { engine, REMOTE_CONFIG_DEFAULTS } from "./engine";
import { getFirebase, remoteValue } from "../firebase";

/** The Recast kinds switched on in Remote Config (falls back to the built-in default list). */
export async function enabledRecastKinds(): Promise<string[]> {
  let raw: string = REMOTE_CONFIG_DEFAULTS.recast_kinds;
  try {
    raw = remoteValue(await getFirebase(), "recast_kinds");
  } catch {
    /* defaults */
  }
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export { engine };
