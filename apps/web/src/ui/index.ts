// The shared UI. The web app and the extension side panel both import from here; nothing is duplicated.
export { Workspace, type Tab } from "./Workspace";
export { sessionGuideStore, type GuideState, type GuideStore } from "./guideStore";
export { fetchedLibrary, guideLibrary, type GuideLibrary } from "./guides";
export { formProblemOf, type FormProblem, type LocateTarget, type PageHost } from "./host";
export type { HandrailPort, HostToPanel, PanelToHost, Envelope, ToolResult } from "./handrailTypes";
export { newId } from "./handrailTypes";
export { applyHighlight, textToHtml, looksLikeHtml, looksLikeUrl } from "./dom";
