// Distill engine: pure functions shared by the web app, the extension and Handrail. No Firebase import here; the
// apps own the SDK and pass prompts through `route()` decisions.
export * from "./types.js";
export { extractPage, type ExtractOptions } from "./page.js";
export { extractForm, readErrors, readValues, writeValues, FORM_READER } from "./form.js";
export { isInvalid, looksLikeError, shownNow } from "./errors.js";
export { validateAndRepair } from "./repair.js";
export { parseWizard } from "./wizard.js";
export { route } from "./route.js";
export { prompts } from "./prompts.js";
export { schemas } from "./schemas.js";
export { fingerprint } from "./fingerprint.js";
export {
  parseGuide, parseLibrary, matchGuide, guideWizard, guideLang, guideStructure, mergeWizards, narrowStructure, formAddress, sameLabel,
  isHttps, isIsoDate, GUIDE_LANGS, GUIDE_MIN_OVERLAP, type GuideCheck, type GuideLang, type GuideMatchResult, type GuideSteps,
} from "./guides.js";
export {
  pageToken, parseSimplified, agentCanDo, agentDoor, extractActions, AGENT_TASKS, MAX_ACTIONS,
  type AgentTask, type AgentVerdict, type DoorContext, type PageAction, type PageActionKind, type Simplified,
} from "./agent.js";
export { findClutter, clutterSummary, CLUTTER_LABELS, type ClutterItem, type ClutterKind, type ClutterOptions } from "./clutter.js";
export { detectLang, type DetectedLang } from "./lang.js";
export { findContacts, type ContactKind, type ContactOptions, type FoundContact } from "./contact.js";
export { parseTranslation, MAX_GROWTH, type TranslateBlock, type Translation } from "./translate.js";
