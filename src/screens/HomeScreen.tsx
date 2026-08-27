import { useRef, useState } from 'react';
import { Pressable, SafeAreaView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { NameStock } from '../components/NameStock';
import { PageThumb } from '../components/PageThumb';
import { PdfPane } from '../components/PdfPane';
import { SplitHandle } from '../components/SplitHandle';
import { ToolPalette } from '../components/ToolPalette';
import { Workspace } from '../components/Workspace';
import { dropActions, pageIdFromDrag, pointInRect, type DragPayload, type DropTarget } from '../domain/drop';
import { mainPaneFlex, nextSplitFromDrag, sidebarPaneFlex } from '../domain/uiLayout';
import type { DocumentAction } from '../domain/reducer';
import { buildStripFrames, hitStripFrame, pageLocalFromWorld, screenToWorld } from '../domain/stripGeometry';
import { selectedTextForEditor } from '../domain/text';
import type { HistoryState } from '../domain/types';
import { colors, layout, spacing } from '../theme/tokens';

type HomeScreenProps = {
  history: HistoryState;
  dispatch: (action: DocumentAction | { type: 'undo' } | { type: 'redo' }) => void;
  onBack: () => void;
};

type WinRect = { x: number; y: number; width: number; height: number };

export function HomeScreen({ history, dispatch, onBack }: HomeScreenProps) {
  const { width } = useWindowDimensions();
  const doc = history.present;
  const sidebarWidth = doc.sidebarCompact
    ? layout.sidebarCompactWidth
    : Math.min(layout.sidebarMaxWidth, Math.max(layout.sidebarMinWidth, Math.round(width * 0.28)));
  const selectedClip = doc.pasteboardClips.find((c) => c.id === doc.selectedClipId);
  const selectedText = selectedTextForEditor(doc);
  const [drag, setDrag] = useState<{ payload: DragPayload; x: number; y: number } | null>(null);
  const stockRect = useRef<WinRect>({ x: 0, y: 0, width: 0, height: 0 });
  const workspaceRect = useRef<WinRect>({ x: 0, y: 0, width: 0, height: 0 });
  const mainH = useRef(600);
  const sidebarH = useRef(600);
  const mainFlex = mainPaneFlex(doc);
  const sideFlex = sidebarPaneFlex(doc);
  const dragPageId = drag ? pageIdFromDrag(drag.payload) : null;

  function startDrag(payload: DragPayload) {
    setDrag((prev) => ({ payload, x: prev?.x ?? 0, y: prev?.y ?? 0 }));
  }

  function moveDrag(x: number, y: number) {
    setDrag((prev) => (prev ? { ...prev, x, y } : prev));
  }

  function hitTarget(x: number, y: number): DropTarget | null {
    if (pointInRect(x, y, stockRect.current)) {
      const localX = x - stockRect.current.x;
      const localY = y - stockRect.current.y;
      const world = screenToWorld(localX, localY, doc.stockPanX, doc.stockPanY, doc.stockZoom);
      return { zone: 'stock', x: world.x, y: world.y };
    }
    if (pointInRect(x, y, workspaceRect.current)) {
      const localX = x - workspaceRect.current.x;
      const localY = y - workspaceRect.current.y;
      const world = screenToWorld(localX, localY, doc.workspacePanX, doc.workspacePanY, doc.workspaceZoom);
      const { frames } = buildStripFrames(doc.workspaceOrder);
      const frame = hitStripFrame(frames, world.x, world.y);
      if (
        frame &&
        frame.slot.kind === 'page' &&
        (drag?.payload.type === 'pdfText' ||
          drag?.payload.type === 'clip' ||
          drag?.payload.type === 'pasteboardText')
      ) {
        const local = pageLocalFromWorld(frame, world.x, world.y, doc.rasterWidth, doc.rasterHeight);
        return { zone: 'page', pageId: frame.slot.pageId, localX: local.x, localY: local.y };
      }
      if (frame) {
        return { zone: 'workspaceInsert', readingIndex: frame.insertIndex };
      }
      return { zone: 'pasteboard', x: world.x, y: world.y };
    }
    return null;
  }

  function endDrag(x: number, y: number) {
    if (!drag) {
      return;
    }
    const target = hitTarget(x, y);
    if (target) {
      for (const action of dropActions(drag.payload, target)) {
        dispatch(action);
      }
    }
    setDrag(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.row}>
        <View
          style={[styles.sidebar, { width: sidebarWidth }]}
          onLayout={(e) => {
            sidebarH.current = e.nativeEvent.layout.height;
          }}
        >
            <View style={{ flex: sideFlex.palette }}>
            <ToolPalette
              tool={doc.tool}
              tools={doc.tools}
              compact={doc.sidebarCompact}
              selectedText={
                selectedText
                  ? {
                      id: selectedText.id,
                      color: selectedText.color,
                      fontSize: selectedText.fontSize,
                      content: selectedText.content,
                    }
                  : null
              }
              canUndo={history.past.length > 0}
              canRedo={history.future.length > 0}
              onToggleCompact={() =>
                dispatch({ type: 'setUiLayout', sidebarCompact: !doc.sidebarCompact })
              }
              onTool={(tool) => dispatch({ type: 'setTool', tool })}
              onPatch={(patch) => dispatch({ type: 'setToolProperties', patch })}
              onSelectedTextColor={(color) => {
                if (selectedText) {
                  dispatch({ type: 'setTextColor', textId: selectedText.id, color });
                }
              }}
              onSelectedTextFontSize={(fontSize) => {
                if (selectedText) {
                  dispatch({ type: 'setTextFontSize', textId: selectedText.id, fontSize });
                }
              }}
              onSelectedTextContent={(content) => {
                if (selectedText) {
                  dispatch({ type: 'editText', textId: selectedText.id, content });
                }
              }}
              onUndo={() => dispatch({ type: 'undo' })}
              onRedo={() => dispatch({ type: 'redo' })}
              onBack={onBack}
            />
          </View>
          <SplitHandle
            accessibilityLabel="パレットとストックの分割"
            onDrag={(dy) =>
              dispatch({
                type: 'setUiLayout',
                paletteStockSplit: nextSplitFromDrag(doc.paletteStockSplit, dy, sidebarH.current),
              })
            }
          />
          <View
            style={{ flex: sideFlex.stock }}
            onLayout={(e) => {
              e.currentTarget.measureInWindow((x, y, w, h) => {
                stockRect.current = { x, y, width: w, height: h };
              });
            }}
          >
            <NameStock
              doc={doc}
              compact={doc.sidebarCompact}
              layout={doc.stockLayout}
              onToggleLayout={() =>
                dispatch({
                  type: 'setUiLayout',
                  stockLayout: doc.stockLayout === 'grid' ? 'free' : 'grid',
                })
              }
              onPlace={(pageId, x, y) => dispatch({ type: 'placeStock', pageId, x, y })}
              onDelete={(pageId) => dispatch({ type: 'deleteStockPage', pageId })}
              onPanZoom={(zoom, panX, panY) => dispatch({ type: 'setStockView', zoom, panX, panY })}
              onDragStart={startDrag}
              onDragMove={moveDrag}
              onDragEnd={endDrag}
            />
          </View>
        </View>
        <View
          style={styles.main}
          onLayout={(e) => {
            mainH.current = e.nativeEvent.layout.height;
          }}
        >
          <View
            style={{ flex: mainFlex.workspace }}
            onLayout={(e) => {
              e.currentTarget.measureInWindow((x, y, w, h) => {
                workspaceRect.current = { x, y, width: w, height: h };
              });
            }}
          >
            <Workspace
              doc={doc}
              dispatch={dispatch}
              onDragStart={startDrag}
              onDragMove={moveDrag}
              onDragEnd={endDrag}
            />
          </View>
          {selectedClip ? (
            <View style={styles.clipBar}>
              <Text style={styles.clipText}>台紙クリップ</Text>
              <Pressable
                style={styles.clipBtn}
                onPress={() =>
                  dispatch({ type: 'transformClip', clipId: selectedClip.id, scale: selectedClip.scale * 1.15 })
                }
              >
                <Text>拡大</Text>
              </Pressable>
              <Pressable
                style={styles.clipBtn}
                onPress={() =>
                  dispatch({ type: 'transformClip', clipId: selectedClip.id, scale: selectedClip.scale / 1.15 })
                }
              >
                <Text>縮小</Text>
              </Pressable>
              <Pressable
                style={styles.clipBtn}
                onPress={() =>
                  dispatch({
                    type: 'transformClip',
                    clipId: selectedClip.id,
                    rotation: selectedClip.rotation + Math.PI / 8,
                  })
                }
              >
                <Text>回転</Text>
              </Pressable>
              <Text style={styles.clipText}>ページへドロップで焼き込み</Text>
            </View>
          ) : null}
          {doc.pdfViewerVisible ? (
            <>
              <SplitHandle
                accessibilityLabel="ワークスペースとPDFの分割"
                onDrag={(dy) =>
                  dispatch({
                    type: 'setUiLayout',
                    workspacePdfSplit: nextSplitFromDrag(doc.workspacePdfSplit, dy, mainH.current),
                  })
                }
              />
              <View style={{ flex: mainFlex.pdf }}>
                <PdfPane
                  doc={doc}
                  onLoad={(uri, pageCount, sourceTextByPage) =>
                    dispatch({ type: 'loadPdf', uri, pageCount, sourceTextByPage })
                  }
                  onView={(patch) => dispatch({ type: 'setPdfView', ...patch })}
                  onTextDragStart={startDrag}
                  onDragMove={moveDrag}
                  onDragEnd={endDrag}
                />
              </View>
            </>
          ) : null}
        </View>
      </View>
      {drag ? (
        <View pointerEvents="none" style={[styles.ghost, { left: drag.x + 8, top: drag.y + 8 }]}>
          {dragPageId ? (
            <View style={styles.ghostThumb}>
              <PageThumb page={doc.pages[dragPageId]} width={72} height={100} />
            </View>
          ) : (
            <Text style={styles.ghostText}>
              {drag.payload.type === 'pdfText'
                ? drag.payload.preview
                : drag.payload.type === 'clip'
                  ? 'クリップ'
                  : 'テキスト'}
            </Text>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    padding: spacing.sm,
    gap: spacing.sm,
  },
  sidebar: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  main: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  clipBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xs,
    alignItems: 'center',
  },
  clipText: {
    color: colors.textMuted,
  },
  clipBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
  },
  ghost: {
    position: 'absolute',
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 8,
  },
  ghostThumb: {
    width: 72,
    height: 100,
    overflow: 'hidden',
    borderRadius: 4,
  },
  ghostText: {
    color: colors.text,
    fontWeight: '600',
  },
});
