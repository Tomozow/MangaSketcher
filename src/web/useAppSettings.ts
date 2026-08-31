'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  getAppSettingsServerSnapshot,
  getAppSettingsSnapshot,
  saveAppSettings,
  subscribeAppSettings,
  type AppSettings,
} from '@/src/storage/appSettings';

export function useAppSettings(): [AppSettings, (patch: Partial<AppSettings>) => AppSettings] {
  const settings = useSyncExternalStore(
    subscribeAppSettings,
    getAppSettingsSnapshot,
    getAppSettingsServerSnapshot,
  );

  const update = useCallback((patch: Partial<AppSettings>) => saveAppSettings(patch), []);

  return [settings, update];
}
