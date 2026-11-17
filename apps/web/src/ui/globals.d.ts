// Chrome's Prompt API (the on-device model). Only what Distill touches; the Firebase SDK drives actual inference.
import type { LocalModelState } from "@distill/engine";

declare global {
  interface LanguageModelMonitor extends EventTarget {}
  // eslint-disable-next-line no-var
  var LanguageModel:
    | {
        availability(options?: object): Promise<LocalModelState>;
        create(options?: { monitor?: (m: LanguageModelMonitor) => void }): Promise<{ destroy(): void }>;
      }
    | undefined;
}
export {};
