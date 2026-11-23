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
export { parseColor, composite, contrastRatio, luminance, readableOn, cssColor, type Rgba } from "./contrast.js";
export { READING, columnWidth, dominantSize, isLargeText, lineHeightFor, measureFor, sizeScale } from "./reading.js";
// Spark universal-core round 2.
export { findClaimCandidates, parseClaims, splitSentences, claimWhy, CLAIM_WHY, MAX_CLAIMS, type Claim, type ClaimPick, type ClaimWhy } from "./claims.js";
export { parseCheck, CLAIM_VERDICTS, REASON_MAX, SOURCES_MAX, type CheckResult, type CheckSource, type ClaimCheck, type ClaimVerdict } from "./check.js";
export { parseGist, findSentence, GIST_POINTS, GIST_POINT_MAX, type Gist, type GistPoint } from "./gist.js";
export { keepsFacts, missingFacts, parsePlain, type Fact, type FactKind, type PlainResult } from "./plain.js";
export { describeLink, readableHost, registrableDomain, PROGRAM_FILE_TYPES, TRACKING_PARAMS, type LinkNote } from "./links.js";
// Spark universal-core round 3 (contract; each module is filled by its card's builder).
export { readByline, bylineLine, ago as bylineAgo, dayOf as bylineDay, type Byline } from "./byline.js";
export { findActions, ACTION_KINDS, type ActionKind, type FoundAction } from "./actions.js";
export { findPrices, convert, formatMoney, parseEcbRates, type FoundPrice, type Rates } from "./money.js";
export { findDates, formatDate, type FoundDate } from "./dates.js";
export { parseAnswer, QUESTION_MAX, ANSWER_MAX, type PageAnswer, type AnswerResult } from "./ask.js";
