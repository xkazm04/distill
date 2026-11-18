import type { Plugin } from "vite";

export const REPO_ROOT: string;
export const GUIDES_DIR: string;
export const LIBRARY_PATH: string;
export const VIRTUAL_ID: string;
export interface GuideFile { file: string; id: string; text: string; json: unknown; error: string | null }
export function readGuideFiles(dir?: string): GuideFile[];
export function shippable(g: unknown, drafts: boolean): boolean;
export function libraryJson(drafts?: boolean, dir?: string): { version: 1; guides: unknown[] };
export function guideLibrary(opts: { as: "asset" | "module"; drafts?: boolean; dir?: string }): Plugin;
