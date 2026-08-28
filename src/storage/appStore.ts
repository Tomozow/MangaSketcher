/**
 * Web storage replaces Expo AsyncStorage. Legacy imports should migrate to projectStore.
 */
export {
  createProject,
  deleteProject,
  listProjects,
  loadDocument,
  loadProjectRasters,
  renameProject,
  runStartupGc,
  saveProjectDocument,
  writeProjectPdf,
} from './projectStore';

export { loadEditorBoot, readPdfArrayBuffer, editorHistoryFromBoot } from './editorBoot';
export { AutosaveManager } from './autosave';
export {
  createEditorHistory,
  isViewOnlyHistoryAction,
  pushEditorHistory,
  redoEditorHistory,
  undoEditorHistory,
} from './history';
