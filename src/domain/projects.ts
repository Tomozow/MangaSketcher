import { rasterFromArray, rasterToArray } from './raster';
import type { DocumentState, ProjectMeta } from './types';
import { normalizeUiLayout } from './uiLayout';

type SerializedPage = {
  id: string;
  raster: { width: number; height: number; data: number[] };
  texts: DocumentState['pages'][string]['texts'];
};

type SerializedDocument = Omit<DocumentState, 'pages' | 'pasteboardClips'> & {
  pages: Record<string, SerializedPage>;
  pasteboardClips: Array<
    Omit<DocumentState['pasteboardClips'][number], 'raster'> & {
      raster: { width: number; height: number; data: number[] };
    }
  >;
};

export function serializeDocument(doc: DocumentState): string {
  const pages: SerializedDocument['pages'] = {};
  for (const [id, page] of Object.entries(doc.pages)) {
    pages[id] = {
      id: page.id,
      raster: { width: page.raster.width, height: page.raster.height, data: rasterToArray(page.raster) },
      texts: page.texts,
    };
  }
  const payload: SerializedDocument = {
    ...doc,
    pages,
    pasteboardClips: doc.pasteboardClips.map((clip) => ({
      ...clip,
      raster: { width: clip.raster.width, height: clip.raster.height, data: rasterToArray(clip.raster) },
    })),
  };
  return JSON.stringify(payload);
}

export function deserializeDocument(raw: string): DocumentState {
  const parsed = JSON.parse(raw) as SerializedDocument;
  const pages: DocumentState['pages'] = {};
  for (const [id, page] of Object.entries(parsed.pages)) {
    pages[id] = {
      id: page.id,
      raster: rasterFromArray(page.raster.width, page.raster.height, page.raster.data),
      texts: page.texts,
    };
  }
  return {
    ...parsed,
    pages,
    trash: [...(parsed.trash ?? [])],
    trashClips: [...(parsed.trashClips ?? [])],
    trashTexts: [...(parsed.trashTexts ?? [])],
    pasteboardClips: parsed.pasteboardClips.map((clip) => ({
      ...clip,
      raster: rasterFromArray(clip.raster.width, clip.raster.height, clip.raster.data),
    })),
    ...normalizeUiLayout(parsed),
  };
}

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const INDEX_KEY = 'mangasketcher.projects.index';
const docKey = (id: string) => `mangasketcher.project.${id}`;

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map(Object.entries(initial));
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}

async function readIndex(store: KeyValueStore): Promise<ProjectMeta[]> {
  const raw = await store.getItem(INDEX_KEY);
  if (!raw) {
    return [];
  }
  return JSON.parse(raw) as ProjectMeta[];
}

async function writeIndex(store: KeyValueStore, index: ProjectMeta[]): Promise<void> {
  await store.setItem(INDEX_KEY, JSON.stringify(index));
}

export async function listProjects(store: KeyValueStore): Promise<ProjectMeta[]> {
  const index = await readIndex(store);
  return [...index].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveProject(
  store: KeyValueStore,
  doc: DocumentState,
  nowIso: string,
): Promise<ProjectMeta> {
  const meta: ProjectMeta = {
    id: doc.projectId,
    name: doc.name,
    updatedAt: nowIso,
    pageCount: Object.keys(doc.pages).length,
  };
  const index = await readIndex(store);
  const next = index.filter((p) => p.id !== doc.projectId);
  next.push(meta);
  await writeIndex(store, next);
  await store.setItem(docKey(doc.projectId), serializeDocument(doc));
  return meta;
}

export async function loadProject(store: KeyValueStore, id: string): Promise<DocumentState | null> {
  const raw = await store.getItem(docKey(id));
  if (!raw) {
    return null;
  }
  return deserializeDocument(raw);
}

export async function renameProject(
  store: KeyValueStore,
  id: string,
  name: string,
  nowIso: string,
): Promise<void> {
  const index = await readIndex(store);
  const item = index.find((p) => p.id === id);
  if (item) {
    item.name = name;
    item.updatedAt = nowIso;
    await writeIndex(store, index);
  }
  const doc = await loadProject(store, id);
  if (doc) {
    doc.name = name;
    await store.setItem(docKey(id), serializeDocument(doc));
  }
}

export async function deleteProject(store: KeyValueStore, id: string): Promise<void> {
  const index = (await readIndex(store)).filter((p) => p.id !== id);
  await writeIndex(store, index);
  await store.removeItem(docKey(id));
}
