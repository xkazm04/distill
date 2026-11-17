import { useCallback, useEffect, useState } from "react";
import type { LocalModelState } from "@distill/engine";
import { downloadLocalModel, localModelState } from "../ai";

export function useLocalModel() {
  const [state, setState] = useState<LocalModelState | "checking">("checking");
  const [progress, setProgress] = useState<number | null>(null);

  const refresh = useCallback(() => localModelState().then(setState), []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (state !== "downloading") return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [state, refresh]);

  const download = useCallback(async () => {
    setState("downloading");
    setProgress(0);
    try {
      await downloadLocalModel(setProgress);
    } finally {
      setProgress(null);
      await refresh();
    }
  }, [refresh]);

  return { state, progress, download, refresh };
}

export type LocalModel = ReturnType<typeof useLocalModel>;
