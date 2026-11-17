// JSON Schemas of every model output. Common subset only (type / properties / required / items / enum), so the same
// object works as a Prompt API `responseConstraint` and as a Gemini `responseSchema`. No $ref, no oneOf.

const str = { type: "string" };
const strList = { type: "array", items: str };

export const schemas: Record<"recast" | "wizard" | "classify" | "letter", object> = {
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
  letter: {
    type: "object",
    properties: {
      sender: str,
      subject: str,
      summary: str,
      deadline: str,
      amountDue: str,
      actions: { type: "array", items: { type: "object", properties: { what: str, by: str }, required: ["what"] } },
    },
    required: ["summary", "actions"],
  },
};
