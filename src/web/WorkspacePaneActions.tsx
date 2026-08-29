'use client';

import { useEffect, useState } from 'react';
import type { EditorDocumentAction } from '@/src/domain/editorReducer';
import type { EditorDocument } from '@/src/storage/types';
import type { InkEngine } from '@/src/web/ink/InkEngine';
import { styles } from './editorStyles';
import { WorkspaceExportControls, type ExportUiPhase } from './WorkspaceExportControls';
import { WorkspaceLayoutMenu } from './WorkspaceLayoutMenu';

type WorkspacePaneActionsProps = {
  doc: EditorDocument;
  dispatch: (action: EditorDocumentAction) => void;
  inkEngine: InkEngine | null;
};

export function WorkspacePaneActions({ doc, dispatch, inkEngine }: WorkspacePaneActionsProps) {
  const [layoutOpen, setLayoutOpen] = useState(false);
  const [exportPhase, setExportPhase] = useState<ExportUiPhase>('idle');
  const layoutLocked = exportPhase === 'generating' || exportPhase === 'ready';

  useEffect(() => {
    if (layoutLocked) {
      setLayoutOpen(false);
    }
  }, [layoutLocked]);

  return (
    <div className={styles.workspacePaneActions} data-ms-shell="workspace-pane-actions">
      <div className={styles.workspacePaneActionRow}>
        <WorkspaceLayoutMenu
          doc={doc}
          dispatch={dispatch}
          open={layoutOpen && !layoutLocked}
          onOpenChange={(next) => {
            if (layoutLocked && next) {
              return;
            }
            setLayoutOpen(next);
          }}
        />
        <WorkspaceExportControls doc={doc} inkEngine={inkEngine} onPhaseChange={setExportPhase} />
      </div>
    </div>
  );
}
