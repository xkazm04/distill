// The wire contract of Distill. Every type name, field name and enum string here is exact and shared by the web app,
// the extension, Handrail and (as exported JSON Schema) the Android app. Change one only together with every consumer
// and `npm run check`. Absent optional fields are OMITTED, never `null`.

// ---------------------------------------------------------------------------------------------------------------
// Page model (Distill focus view)
// ---------------------------------------------------------------------------------------------------------------

export type PageKind = "article" | "form" | "product" | "docs" | "thread" | "listing" | "letter" | "other";

export type BlockKind = "heading" | "paragraph" | "list" | "table" | "quote" | "image" | "code";

export interface Block {
  /** Stable within one extraction: `b0`, `b1`, ... in document order. */
  id: string;
  kind: BlockKind;
  /** Plain text; never HTML. For `list`, items joined by "\n". For `image`, the alt text. */
  text: string;
  /** Heading level 1-6, only on `heading`. */
  level?: number;
  /** Rows of cells, only on `table`. */
  rows?: string[][];
  /** Only on `image`; absolute URL. Never fetched by the renderer without the page's own origin policy. */
  src?: string;
}

export interface PageModel {
  url: string;
  title: string;
  /** BCP-47 primary tag detected from <html lang> or content, e.g. "cs". */
  lang: string;
  kind: PageKind;
  blocks: Block[];
  /** Present when the page holds at least one fillable form. */
  formCount?: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Forms (Wayfill). PRIVACY LAW: a value typed by a person exists only in `FormValues`, which never crosses the
// cloud boundary. `FormStructure` is the only form shape a cloud-eligible prompt may carry, and it has no value field.
// ---------------------------------------------------------------------------------------------------------------

export type FieldKind =
  | "text" | "textarea" | "email" | "tel" | "number" | "date" | "select" | "radio" | "checkbox" | "file" | "other";

export interface FieldOption {
  /** The option's submitted value attribute (structure, not a person's data). */
  value: string;
  label: string;
}

export interface FieldStructure {
  /** Stable id: the element's id, else name, else `f<n>` in document order. */
  fieldId: string;
  kind: FieldKind;
  /** The label as written on the page, in the page language. */
  label: string;
  required: boolean;
  /** For select/radio/checkbox groups. */
  options?: FieldOption[];
  /** The input's own format hints: placeholder, pattern, maxlength, min/max. */
  placeholder?: string;
  pattern?: string;
  maxLength?: number;
  /** Nearby help text on the page, if any. */
  hint?: string;
  /** Visual section heading the field sits under. */
  section?: string;
}

export interface FormStructure {
  /** sha-256 hex of origin + path + the ordered (fieldId, kind, label) list. Keys `users/{uid}/formGuides/{fingerprint}`. */
  fingerprint: string;
  url: string;
  lang: string;
  title: string;
  fields: FieldStructure[];
}

/** fieldId -> the person's value. Device-only. */
export type FormValues = Record<string, string>;

export interface WizardStep {
  /** Same as the FieldStructure it explains; one step may cover several fields (e.g. an address). */
  stepId: string;
  fieldIds: string[];
  /** In the reader's language (default "en"). */
  question: string;
  explanation: string;
  example?: string;
  /** Format the original field expects, in plain words: "DD.MM.YYYY", "9-digit birth number". */
  expectedFormat?: string;
}

export interface Wizard {
  fingerprint: string;
  readerLang: string;
  steps: WizardStep[];
}

// ---------------------------------------------------------------------------------------------------------------
// Letters and replies (Envelope). A letter is text the person chose to share (page class). Their answers to the reply
// wizard are their own details (values class): they exist only in `ReplyAnswer`, which never crosses the cloud boundary.
// ---------------------------------------------------------------------------------------------------------------

export interface LetterAction {
  /** What the person has to do, in the reader's language. */
  what: string;
  /** By when, as the letter writes it. */
  by?: string;
}

/** What `readLetter` returns (schemas/letter.json). Free text is in the reader's language; dates, amounts and names exactly as written. */
export interface Letter {
  sender?: string;
  subject?: string;
  /** BCP-47 primary tag of the language the letter is written in, e.g. "cs". A reply is written in this language. */
  lang?: string;
  summary: string;
  deadline?: string;
  amountDue?: string;
  actions: LetterAction[];
}

/** One question the person answers so a reply can be written. Built from the letter text only. */
export interface ReplyStep {
  /** `r0`, `r1`, ... in order. */
  stepId: string;
  /** In the reader's language. */
  question: string;
  /** Why the reply needs it, in plain words. */
  explanation: string;
  example?: string;
  expectedFormat?: string;
}

export interface ReplyWizard {
  readerLang: string;
  /** Empty when the letter needs no reply. */
  steps: ReplyStep[];
}

/** The person's answer to one ReplyStep. Device-only, like FormValues. */
export interface ReplyAnswer {
  stepId: string;
  /** The step's question, so the drafting prompt knows what the answer means. */
  question: string;
  value: string;
}

/** What `draftReply` returns (schemas/replyDraft.json). */
export interface ReplyDraft {
  /** The reply, in the letter's language, ready to send. */
  reply: string;
  /** The same reply in the reader's language, so the person knows what they send. Omitted when the languages match. */
  translation?: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Recast (generated layout). Closed vocabulary: a kind the renderer does not know is dropped AND counted.
// ---------------------------------------------------------------------------------------------------------------

export type RecastNodeKind = "summary" | "keyFacts" | "steps" | "checklist" | "comparison" | "timeline" | "callout";

export interface RecastNode {
  kind: RecastNodeKind;
  title?: string;
  /** summary, callout */
  text?: string;
  /** keyFacts: label/value pairs */
  facts?: { label: string; value: string }[];
  /** steps, checklist */
  items?: string[];
  /** comparison: columns[0] is the row header column */
  columns?: string[];
  rows?: string[][];
  /** timeline */
  events?: { when: string; what: string }[];
  /** callout tone */
  tone?: "info" | "warning" | "deadline";
  /** Every node cites the page blocks it came from, so the reader can jump to the original. */
  sourceBlockIds: string[];
}

export interface RecastSpec {
  version: 1;
  nodes: RecastNode[];
}

export interface RepairResult {
  nodes: RecastNode[];
  /** How many nodes were dropped, and why, shown in the surface: "4 sections shown, 1 could not be displayed". */
  dropped: number;
  reasons: string[];
}

// ---------------------------------------------------------------------------------------------------------------
// Sieve (routing). Mirrors Firebase AI Logic's InferenceMode / InferenceSource strings exactly.
// ---------------------------------------------------------------------------------------------------------------

export type InferenceMode = "prefer_on_device" | "only_on_device" | "only_in_cloud" | "prefer_in_cloud";
export type InferenceSource = "on_device" | "in_cloud";

/** The local model is a state machine, not a boolean (Chrome Prompt API availability strings). */
export type LocalModelState = "unavailable" | "downloadable" | "downloading" | "available";

/** `values` = the prompt carries a person's form values, profile or reply answers: device only, no fallback. */
export type PromptClass = "page" | "structure" | "values";

export type Task =
  | "classifyPage"      // page
  | "simplifyBlocks"    // page
  | "recast"            // page
  | "buildWizard"       // structure
  | "explainField"      // structure
  | "suggestValue"      // values
  | "checkValue"        // values
  | "readLetter"        // page (Envelope: OCR text of a letter the person chose to share)
  | "buildReplyWizard"  // page (Envelope: the same letter text; never the person's answers)
  | "draftReply";       // values (Envelope: carries the person's answers)

export interface RouteDecision {
  task: Task;
  promptClass: PromptClass;
  mode: InferenceMode;
  /** Plain-words reason shown on hover of the device/cloud chip. */
  reason: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Firestore documents (no form values, ever) and Remote Config keys.
// ---------------------------------------------------------------------------------------------------------------

export interface UserSettingsDoc {
  /** users/{uid} */
  readingLevel: "plain" | "standard" | "original";
  readerLang: string;
  recastEnabled: boolean;
}

export interface GlossaryDoc {
  /** users/{uid}/glossary/{termId} */
  term: string;
  plain: string;
  lang: string;
}

export interface FormGuideDoc {
  /** users/{uid}/formGuides/{fingerprint} - per person; a shared cache returns only behind a server-side check */
  structure: FormStructure;
  wizard: Wizard;
  updatedAt: string;
}

export const REMOTE_CONFIG_DEFAULTS = {
  prompt_version: "1",
  cloud_model: "gemini-3.5-flash-lite",
  inference_mode: "prefer_on_device",
  recast_kinds: "summary,keyFacts,steps,checklist,comparison,timeline,callout",
} as const;

export type RemoteConfigKey = keyof typeof REMOTE_CONFIG_DEFAULTS;

// ---------------------------------------------------------------------------------------------------------------
// Handrail (local agent bridge). Tool names are exact; MCP tool name = the string below.
// ---------------------------------------------------------------------------------------------------------------

export type HandrailTool = "distill_read" | "wayfill_schema" | "wayfill_propose" | "wayfill_next";

export interface HandrailProposal {
  proposalId: string;
  fieldId: string;
  value: string;
  /** Why the agent proposes this, shown beside Accept / Reject. */
  rationale: string;
}

export type ProposalVerdict = "accepted" | "rejected" | "pending";
