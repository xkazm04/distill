// JSON Schemas of every model output. Common subset only (type / properties / required / items / enum), so the same
// object works as a Prompt API `responseConstraint` and as a Gemini `responseSchema`. No $ref, no oneOf.

const str = { type: "string" };
const strList = { type: "array", items: str };

export const schemas: Record<"recast" | "wizard" | "classify" | "simplify" | "letter" | "replyWizard" | "replyDraft" | "translate" | "claims" | "check" | "gist", object> = {
  recast: {
    type: "object",
    properties: {
      version: { type: "integer" },
      nodes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["summary", "keyFacts", "steps", "checklist", "comparison", "timeline", "callout"] },
            title: str,
            text: str,
            facts: { type: "array", items: { type: "object", properties: { label: str, value: str }, required: ["label", "value"] } },
            items: strList,
            columns: strList,
            rows: { type: "array", items: strList },
            events: { type: "array", items: { type: "object", properties: { when: str, what: str }, required: ["when", "what"] } },
            tone: { type: "string", enum: ["info", "warning", "deadline"] },
            sourceBlockIds: strList,
          },
          required: ["kind", "sourceBlockIds"],
        },
      },
    },
    required: ["version", "nodes"],
  },
  wizard: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stepId: str,
            fieldIds: strList,
            question: str,
            explanation: str,
            example: str,
            expectedFormat: str,
          },
          required: ["stepId", "fieldIds", "question", "explanation"],
        },
      },
    },
    required: ["steps"],
  },
  classify: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["article", "form", "product", "docs", "thread", "listing", "letter", "other"] },
      reason: str,
    },
    required: ["kind"],
  },
  // The focus view's rewrite: one entry per rewritten block, keyed by the block's id ("b3"). A block left out stays as
  // written. An array of {id, text} because the common subset has no additionalProperties for id-keyed objects.
  simplify: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: { type: "object", properties: { id: str, text: str }, required: ["id", "text"] },
      },
    },
    required: ["blocks"],
  },
  letter: {
    type: "object",
    properties: {
      sender: str,
      subject: str,
      lang: str,
      summary: str,
      deadline: str,
      amountDue: str,
      actions: { type: "array", items: { type: "object", properties: { what: str, by: str }, required: ["what"] } },
    },
    required: ["summary", "actions"],
  },
  replyWizard: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          properties: {
            stepId: str,
            question: str,
            explanation: str,
            example: str,
            expectedFormat: str,
          },
          required: ["stepId", "question", "explanation"],
        },
      },
    },
    required: ["steps"],
  },
  replyDraft: {
    type: "object",
    properties: {
      reply: str,
      translation: str,
    },
    required: ["reply"],
  },
  // The caption's Translate: one entry per translated block, keyed by the block's id ("t3"), the same shape as simplify.
  translate: {
    type: "object",
    properties: {
      blocks: {
        type: "array",
        items: { type: "object", properties: { id: str, text: str }, required: ["id", "text"] },
      },
    },
    required: ["blocks"],
  },
  // Round 2: findClaims keeps candidates by id with a reason from a closed set (claims.ts CLAIM_WHY).
  claims: {
    type: "object",
    properties: {
      claims: {
        type: "array",
        items: { type: "object", properties: { id: str, why: { type: "string", enum: ["number", "date", "quote", "source", "cause"] } }, required: ["id", "why"] },
      },
    },
    required: ["claims"],
  },
  // Round 2: checkClaim's verdict (check.ts CLAIM_VERDICTS). Sources are NOT in the schema: they come only from the
  // service's grounding metadata.
  check: {
    type: "object",
    properties: { verdict: { type: "string", enum: ["supported", "disputed", "mixed", "notFound"] }, reason: str },
    required: ["verdict", "reason"],
  },
  // Round 2: the gist, each point with the block and the exact sentence it came from (gist.ts).
  gist: {
    type: "object",
    properties: {
      points: {
        type: "array",
        items: { type: "object", properties: { text: str, blockId: str, sentence: str }, required: ["text", "blockId", "sentence"] },
      },
    },
    required: ["points"],
  },
};

const FIELD_KINDS = ["text", "textarea", "email", "tel", "number", "date", "select", "radio", "checkbox", "file", "other"];
const guideWizard = {
  type: "object",
  properties: {
    notes: strList,
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          stepId: str,
          fieldIds: strList,
          question: str,
          explanation: str,
          example: str,
          expectedFormat: str,
          official: { type: "object", properties: { text: str, lang: str, url: str }, required: ["text", "lang"] },
        },
        required: ["stepId", "fieldIds", "question", "explanation"],
      },
    },
  },
  required: ["notes", "steps"],
};

// JSON Schemas of the shared FILE formats (not model output): what a file in the guide library must look like. Same
// common subset, so every consumer (Android included) reads them with the same small walker. What the subset cannot
// say (https addresses, YYYY-MM-DD dates, a reviewed guide naming its reviewer) is checked by parseGuide and
// `npm run check-guides`.
export const fileSchemas: Record<"guide", object> = {
  guide: {
    type: "object",
    properties: {
      guideVersion: { type: "integer", enum: [1] },
      id: str,
      status: { type: "string", enum: ["draft", "reviewed"] },
      demo: { type: "boolean" },
      authority: { type: "object", properties: { name: str, nameEn: str }, required: ["name", "nameEn"] },
      formName: { type: "object", properties: { cs: str, en: str, uk: str }, required: ["cs", "en", "uk"] },
      formLang: str,
      officialFormUrl: str,
      instructionsUrl: str,
      draftedOn: str,
      reviewer: str,
      reviewedOn: str,
      match: {
        type: "object",
        properties: {
          format: { type: "string", enum: ["html", "pdf"] },
          fingerprints: strList,
          urls: strList,
          titles: strList,
          reader: str,
          source: str,
          fields: {
            type: "array",
            items: {
              type: "object",
              properties: { fieldId: str, kind: { type: "string", enum: FIELD_KINDS }, label: str },
              required: ["fieldId", "kind", "label"],
            },
          },
        },
        required: ["format", "fingerprints", "fields"],
      },
      wizards: { type: "object", properties: { en: guideWizard, uk: guideWizard }, required: ["en", "uk"] },
      reviewNotes: strList,
    },
    required: ["guideVersion", "id", "status", "authority", "formName", "formLang", "officialFormUrl", "instructionsUrl", "draftedOn", "match", "wizards"],
  },
};
