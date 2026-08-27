import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createDocument,
  createHistory,
  reduceHistory,
  sequentialIds,
  type DocumentAction,
  type HistoryState,
} from '../domain';
import { loadProject, saveProject } from '../domain/projects';
import { appStore } from '../storage/appStore';

function nowIso(): string {
  return new Date().toISOString();
}

export function useEditorSession(projectId: string | null) {
  const ids = useRef(sequentialIds(`live_${projectId ?? 'x'}`)).current;
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setHistory(null);
      return undefined;
    }
    void (async () => {
      const loaded = await loadProject(appStore, projectId);
      if (cancelled) {
        return;
      }
      if (!loaded) {
        setError('プロジェクトを開けませんでした');
        return;
      }
      setHistory(createHistory(loaded));
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const dispatch = useCallback(
    (action: DocumentAction | { type: 'undo' } | { type: 'redo' }) => {
      setHistory((current) => {
        if (!current) {
          return current;
        }
        return reduceHistory(current, action, ids);
      });
    },
    [ids],
  );

  useEffect(() => {
    if (!history) {
      return undefined;
    }
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
    }
    saveTimer.current = setTimeout(() => {
      void saveProject(appStore, history.present, nowIso());
    }, 400);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
      }
    };
  }, [history]);

  return { history, dispatch, error };
}

export function newProjectDocument(name: string, pageCount: number) {
  return createDocument({
    projectId: `proj_${Date.now()}`,
    name,
    pageCount,
    ids: sequentialIds('page'),
  });
}
