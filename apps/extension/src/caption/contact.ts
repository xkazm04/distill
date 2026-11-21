// #5 Call, write or find them: the page side of the contact card. Reads the whole page with the engine's findContacts
// (the parts Clean hid included) and keeps the elements to show where each item was found. STUB: owned by W3.
import type { ContactItem } from "../messages";

/** The contact items of the page; `removed`: what Clean hid, to mark the items found there. */
export function readContacts(doc: Document, removed: readonly Element[]): ContactItem[] { void doc; void removed; return []; }
/** Scrolls to the element item `id` was found in and marks it for a moment. */
export function showContact(doc: Document, id: string): void { void doc; void id; }
