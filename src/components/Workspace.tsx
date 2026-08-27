import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PageThumb } from './PageThumb';
import { InkLayer } from './InkLayer';
import { VerticalText } from './VerticalText';
import type { DocumentAction } from '../domain/reducer';
import type { StrokePoint } from '../domain/stroke';
import {
  APPEND_W,
  PAGE_DISPLAY_H,
  PAGE_DISPLAY_W,
  buildStripFrames,
  hitStripFrame,
  pageLocalFromWorld,
  screenToWorld,
} from '../domain/stripGeometry';
import { LONG_PRESS_MS, PAN_SLOP, canGrabPage } from '../domain/workspaceGestures';
import { findText, hitTextBox, selectedTextForEditor, uniformResizeFromSE } from '../domain/text';
import { type DocumentState, type PageId, type Rect, type TextId } from '../domain/types';
import { createPointerKindTracker, pressureFromNative, workspacePointerPolicy } from '../input/nativePointer';
import { colors, spacing, touchTarget } from '../theme/tokens';

type WorkspaceProps = {
  doc: DocumentState;
  dispatch: (action: DocumentAction | { type: 'undo' } | { type: 'redo' }) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
  onDragStart: (payload: {
    type: 'workspacePage';
    pageId: PageId;
    fromIndex: number;
  } | {
    type: 'clip';
    clipId: string;
  } | {
    type: 'pasteboardText';
    textId: string;
  }) => void;
};

export function Workspace({ doc, dispatch, onDragStart, onDragMove, onDragEnd }: WorkspaceProps) {
  const { frames, contentWidth, contentHeight } = buildStripFrames(doc.workspaceOrder);
  const editor = selectedTextForEditor(doc);
  const [askInsert, setAskInsert] = useState(false);
  const [liveStroke, setLiveStroke] = useState<{ pageId: PageId; points: StrokePoint[]; erase: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ pageId: PageId; rect: Rect } | null>(null);
  const longTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{
    kind: 'finger' | 'pencil';
    x: number;
    y: number;
    hitPage: PageId | null;
    fromIndex: number;
    moved: boolean;
    skipPan: boolean;
  } | null>(null);
  const lastPan = useRef({ x: 0, y: 0 });
  const grabbing = useRef(false);
  const pinch = useRef({ d: 0, z: 1 });
  const marqueeOrigin = useRef<{ pageId: PageId; x: number; y: number } | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const textDrag = useRef<{
    textId: TextId;
    mode: 'move' | 'resize' | 'pendingMove';
    originBox: Rect;
    offX: number;
    offY: number;
    pageId: PageId | null;
  } | null>(null);
  const kindTracker = useRef(createPointerKindTracker()).current;

  useEffect(() => {
    setAskInsert(false);
  }, [doc.selectedPageId]);

  function toLocal(pageX: number, pageY: number) {
    return { x: pageX - origin.current.x, y: pageY - origin.current.y };
  }

  function worldOf(pageX: number, pageY: number) {
    const local = toLocal(pageX, pageY);
    return screenToWorld(local.x, local.y, doc.workspacePanX, doc.workspacePanY, doc.workspaceZoom);
  }

  function hitPageAt(pageX: number, pageY: number) {
    const world = worldOf(pageX, pageY);
    const frame = hitStripFrame(frames, world.x, world.y);
    if (!frame || frame.slot.kind !== 'page') {
      return { frame, pageId: null as PageId | null, local: { x: 0, y: 0 } };
    }
    return {
      frame,
      pageId: frame.slot.pageId,
      local: pageLocalFromWorld(frame, world.x, world.y, doc.rasterWidth, doc.rasterHeight),
    };
  }

  function hitTextAt(pageX: number, pageY: number): {
    textId: TextId;
    handle: 'body' | 'se';
    x: number;
    y: number;
  } | null {
    const world = worldOf(pageX, pageY);
    const pbHandle = 14;
    for (let i = doc.pasteboardTexts.length - 1; i >= 0; i -= 1) {
      const t = doc.pasteboardTexts[i];
      const kind = hitTextBox(t.box, world.x, world.y, pbHandle);
      if (kind) {
        return { textId: t.id, handle: kind, x: world.x, y: world.y };
      }
    }
    const pageHit = hitPageAt(pageX, pageY);
    if (pageHit.pageId) {
      const page = doc.pages[pageHit.pageId];
      const handle = (12 / PAGE_DISPLAY_W) * doc.rasterWidth;
      const texts = page?.texts ?? [];
      for (let i = texts.length - 1; i >= 0; i -= 1) {
        const t = texts[i];
        const kind = hitTextBox(t.box, pageHit.local.x, pageHit.local.y, handle);
        if (kind) {
          return { textId: t.id, handle: kind, x: pageHit.local.x, y: pageHit.local.y };
        }
      }
    }
    return null;
  }

  function commitStroke() {
    if (!liveStroke || liveStroke.points.length === 0) {
      setLiveStroke(null);
      return;
    }
    dispatch({
      type: 'strokeInk',
      target: { kind: 'page', pageId: liveStroke.pageId },
      points: liveStroke.points,
      pointerKind: 'pencil',
      erase: liveStroke.erase,
    });
    setLiveStroke(null);
  }

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>ワークスペース</Text>
        <Pressable
          onPress={() =>
            dispatch({ type: 'setUiLayout', pdfViewerVisible: !doc.pdfViewerVisible })
          }
          style={styles.smallBtn}
          accessibilityLabel={doc.pdfViewerVisible ? 'PDFビューアを隠す' : 'PDFビューアを表示'}
        >
          <Text style={styles.smallBtnText}>{doc.pdfViewerVisible ? 'PDFを隠す' : 'PDFを表示'}</Text>
        </Pressable>
        {doc.selectedPageId ? (
          <Pressable
            onPress={() => dispatch({ type: 'deleteWorkspacePage', pageId: doc.selectedPageId! })}
            style={styles.smallBtn}
          >
            <Text style={styles.smallBtnText}>ページ削除</Text>
          </Pressable>
        ) : null}
        {askInsert ? (
          <Pressable
            onPress={() => {
              dispatch({ type: 'insertAfterSelected' });
              setAskInsert(false);
            }}
            style={styles.smallBtn}
          >
            <Text style={styles.smallBtnText}>後ろに挿入</Text>
          </Pressable>
        ) : null}
      </View>
      <View
        style={styles.canvas}
        onLayout={(e) => {
          e.currentTarget.measureInWindow((x, y) => {
            origin.current = { x, y };
          });
        }}
        onPointerDown={(evt) => {
          kindTracker.classify(evt.nativeEvent);
        }}
        onStartShouldSetResponder={(evt) => {
          const kind = kindTracker.classify(evt.nativeEvent);
          if (kind === 'finger' && doc.selectedTextId) {
            const hit = hitTextAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            if (hit && hit.textId === doc.selectedTextId && hit.handle === 'body') {
              return false;
            }
          }
          return true;
        }}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(evt) => {
          const kind = kindTracker.classify(evt.nativeEvent);
          const policy = workspacePointerPolicy(kind);
          const { pageId } = hitPageAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          pending.current = {
            kind,
            x: evt.nativeEvent.pageX,
            y: evt.nativeEvent.pageY,
            hitPage: pageId,
            fromIndex: pageId ? doc.workspaceOrder.indexOf(pageId) : -1,
            moved: false,
            skipPan: false,
          };
          lastPan.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
          if (longTimer.current) {
            clearTimeout(longTimer.current);
          }
          if (kind === 'finger') {
            const textHit = hitTextAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            if (textHit && textHit.handle === 'body' && pending.current) {
              dispatch({ type: 'selectText', textId: textHit.textId });
              pending.current.skipPan = true;
            }
            const foundText = textHit ? findText(doc, textHit.textId) : null;
            if (foundText?.where === 'pasteboard') {
              longTimer.current = setTimeout(() => {
                const p = pending.current;
                if (!p || p.moved || p.kind !== 'finger' || !textHit) {
                  return;
                }
                onDragStart({ type: 'pasteboardText', textId: textHit.textId });
              }, LONG_PRESS_MS);
            } else if (
              pageId &&
              canGrabPage('finger', 'longpress') &&
              !(textHit && textHit.handle === 'body')
            ) {
              longTimer.current = setTimeout(() => {
                const p = pending.current;
                if (!p || p.moved || p.kind !== 'finger' || !p.hitPage) {
                  return;
                }
                onDragStart({ type: 'workspacePage', pageId: p.hitPage, fromIndex: p.fromIndex });
                grabbing.current = true;
              }, LONG_PRESS_MS);
            }
          }
          if (kind === 'pencil' && (policy.ink || policy.marquee || policy.text)) {
            const hit = hitPageAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            const pressure = pressureFromNative(evt.nativeEvent);
            if ((doc.tool === 'pen' || doc.tool === 'eraser') && pageId) {
              setLiveStroke({
                pageId,
                erase: doc.tool === 'eraser',
                points: [{ x: hit.local.x, y: hit.local.y, pressure }],
              });
            } else if (doc.tool === 'select' && pageId) {
              marqueeOrigin.current = { pageId, x: hit.local.x, y: hit.local.y };
              setMarquee({
                pageId,
                rect: { x: hit.local.x, y: hit.local.y, width: 0, height: 0 },
              });
            } else if (doc.tool === 'text') {
              const textHit = hitTextAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
              if (textHit) {
                const found = findText(doc, textHit.textId);
                if (!found) {
                  return;
                }
                dispatch({ type: 'selectText', textId: textHit.textId });
                textDrag.current = {
                  textId: textHit.textId,
                  mode: textHit.handle === 'se' ? 'resize' : 'pendingMove',
                  originBox: { ...found.node.box },
                  offX: textHit.x - found.node.box.x,
                  offY: textHit.y - found.node.box.y,
                  pageId: found.pageId ?? null,
                };
              } else if (pageId) {
                dispatch({
                  type: 'createText',
                  attachment: { kind: 'page', pageId },
                  box: { x: hit.local.x, y: hit.local.y, width: 8, height: 22 },
                });
              } else {
                const world = worldOf(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
                dispatch({
                  type: 'createText',
                  attachment: { kind: 'pasteboard' },
                  box: { x: world.x, y: world.y, width: 12, height: 36 },
                });
              }
            }
          }
        }}
        onResponderMove={(evt) => {
          const touches = evt.nativeEvent.touches ?? [];
          if (touches.length >= 2) {
            if (longTimer.current) {
              clearTimeout(longTimer.current);
            }
            const dist = Math.hypot(
              touches[0].pageX - touches[1].pageX,
              touches[0].pageY - touches[1].pageY,
            );
            if (pinch.current.d > 0) {
              dispatch({
                type: 'setWorkspaceView',
                zoom: Math.min(4, Math.max(0.4, pinch.current.z * (dist / pinch.current.d))),
                panX: doc.workspacePanX,
                panY: doc.workspacePanY,
              });
            } else {
              pinch.current = { d: dist, z: doc.workspaceZoom };
            }
            return;
          }
          const kind = kindTracker.classify(evt.nativeEvent);
          const policy = workspacePointerPolicy(kind);
          const dx = evt.nativeEvent.pageX - lastPan.current.x;
          const dy = evt.nativeEvent.pageY - lastPan.current.y;
          if (pending.current && Math.hypot(dx, dy) > PAN_SLOP) {
            pending.current.moved = true;
            if (longTimer.current) {
              clearTimeout(longTimer.current);
            }
          }
          if (kind === 'finger' && policy.pan) {
            onDragMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            if (
              !grabbing.current &&
              !liveStroke &&
              !marquee &&
              !textDrag.current &&
              !pending.current?.skipPan
            ) {
              dispatch({
                type: 'setWorkspaceView',
                zoom: doc.workspaceZoom,
                panX: doc.workspacePanX + dx,
                panY: doc.workspacePanY + dy,
              });
            }
          } else if (kind === 'pencil') {
            const hit = hitPageAt(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
            const pressure = pressureFromNative(evt.nativeEvent);
            if (textDrag.current) {
              const session = textDrag.current;
              let x = session.originBox.x;
              let y = session.originBox.y;
              if (session.pageId) {
                const world = worldOf(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
                const frame = frames.find(
                  (f) => f.slot.kind === 'page' && f.slot.pageId === session.pageId,
                );
                if (frame) {
                  const local = pageLocalFromWorld(
                    frame,
                    world.x,
                    world.y,
                    doc.rasterWidth,
                    doc.rasterHeight,
                  );
                  x = local.x;
                  y = local.y;
                }
              } else {
                const world = worldOf(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
                x = world.x;
                y = world.y;
              }
              if (session.mode === 'pendingMove') {
                if (Math.hypot(dx, dy) > PAN_SLOP) {
                  session.mode = 'move';
                } else {
                  lastPan.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
                  return;
                }
              }
              if (session.mode === 'move') {
                dispatch({
                  type: 'moveText',
                  textId: session.textId,
                  x: x - session.offX,
                  y: y - session.offY,
                });
              } else if (session.mode === 'resize') {
                dispatch({
                  type: 'resizeText',
                  textId: session.textId,
                  box: uniformResizeFromSE(session.originBox, x, y),
                });
              }
            } else if (liveStroke && hit.pageId === liveStroke.pageId) {
              setLiveStroke({
                ...liveStroke,
                points: [...liveStroke.points, { x: hit.local.x, y: hit.local.y, pressure }],
              });
            } else if (marquee && marqueeOrigin.current && hit.pageId === marquee.pageId) {
              const o = marqueeOrigin.current;
              setMarquee({
                pageId: marquee.pageId,
                rect: {
                  x: Math.min(o.x, hit.local.x),
                  y: Math.min(o.y, hit.local.y),
                  width: Math.abs(hit.local.x - o.x),
                  height: Math.abs(hit.local.y - o.y),
                },
              });
            } else if (doc.tool === 'select' && doc.selectedClipId) {
              const world = worldOf(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
              dispatch({ type: 'transformClip', clipId: doc.selectedClipId, x: world.x, y: world.y });
            }
          }
          lastPan.current = { x: evt.nativeEvent.pageX, y: evt.nativeEvent.pageY };
        }}
        onResponderRelease={(evt) => {
          if (longTimer.current) {
            clearTimeout(longTimer.current);
          }
          pinch.current = { d: 0, z: doc.workspaceZoom };
          commitStroke();
          if (marquee && marquee.rect.width > 1 && marquee.rect.height > 1) {
            const frame = frames.find(
              (f) => f.slot.kind === 'page' && f.slot.pageId === marquee.pageId,
            );
            dispatch({
              type: 'marqueeCut',
              pageId: marquee.pageId,
              rect: marquee.rect,
              workspaceX: frame ? frame.x + 8 : 20,
              workspaceY: frame ? frame.y + 8 : 20,
            });
          }
          setMarquee(null);
          marqueeOrigin.current = null;
          grabbing.current = false;
          textDrag.current = null;
          onDragEnd(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
          const kind = kindTracker.classify(evt.nativeEvent);
          if (kind === 'finger' && pending.current && !pending.current.moved && pending.current.hitPage) {
            dispatch({ type: 'selectPage', pageId: pending.current.hitPage });
          }
          kindTracker.release(evt.nativeEvent);
          pending.current = null;
        }}
      >
        <View
          style={{
            width: contentWidth,
            height: contentHeight,
            transform: [
              { translateX: doc.workspacePanX },
              { translateY: doc.workspacePanY },
              { scale: doc.workspaceZoom },
            ],
          }}
        >
          {frames.map((frame) => {
            if (frame.slot.kind === 'append') {
              return (
                <Pressable
                  key={frame.key}
                  onPress={() => dispatch({ type: 'appendPage' })}
                  style={[styles.append, { left: frame.x, top: frame.y, width: APPEND_W, height: PAGE_DISPLAY_H }]}
                  accessibilityLabel="ページを追加"
                >
                  <Text style={styles.appendText}>＋</Text>
                </Pressable>
              );
            }
            if (frame.slot.kind === 'blank') {
              return (
                <View key={frame.key} style={[styles.page, styles.blank, { left: frame.x, top: frame.y }]}>
                  <Text style={styles.muted}>余白</Text>
                </View>
              );
            }
            if (frame.slot.kind !== 'page') {
              return null;
            }
            const pageId = frame.slot.pageId;
            const selected = doc.selectedPageId === pageId;
            const page = doc.pages[pageId];
            const strokeOnThis = liveStroke?.pageId === pageId ? liveStroke : null;
            const marqueeOnThis = marquee?.pageId === pageId ? marquee.rect : null;
            return (
              <View key={frame.key} style={{ position: 'absolute', left: frame.x, top: frame.y }}>
                <View style={[styles.page, selected && styles.pageOn]}>
                  <PageThumb page={page} width={PAGE_DISPLAY_W} height={PAGE_DISPLAY_H} />
                  {strokeOnThis
                    ? strokeOnThis.points.map((p, i) => (
                        <View
                          key={`live-${i}`}
                          pointerEvents="none"
                          style={{
                            position: 'absolute',
                            left: (p.x / doc.rasterWidth) * PAGE_DISPLAY_W - 2,
                            top: (p.y / doc.rasterHeight) * PAGE_DISPLAY_H - 2,
                            width: 5,
                            height: 5,
                            borderRadius: 2.5,
                            backgroundColor: strokeOnThis.erase ? 'rgba(255,255,255,0.8)' : doc.tools.penColor,
                            opacity: doc.tools.penOpacity,
                          }}
                        />
                      ))
                    : null}
                  {marqueeOnThis ? (
                    <View
                      pointerEvents="none"
                      style={{
                        position: 'absolute',
                        left: (marqueeOnThis.x / doc.rasterWidth) * PAGE_DISPLAY_W,
                        top: (marqueeOnThis.y / doc.rasterHeight) * PAGE_DISPLAY_H,
                        width: (marqueeOnThis.width / doc.rasterWidth) * PAGE_DISPLAY_W,
                        height: (marqueeOnThis.height / doc.rasterHeight) * PAGE_DISPLAY_H,
                        borderWidth: 1,
                        borderColor: colors.accent,
                        backgroundColor: 'rgba(61,90,128,0.15)',
                      }}
                    />
                  ) : null}
                  {page?.texts.map((t) => {
                    const selectedText = doc.selectedTextId === t.id;
                    return (
                      <View
                        key={t.id}
                        pointerEvents={selectedText ? 'box-none' : 'none'}
                        style={[
                          styles.textBox,
                          selectedText && styles.textBoxOn,
                          {
                            left: (t.box.x / doc.rasterWidth) * PAGE_DISPLAY_W,
                            top: (t.box.y / doc.rasterHeight) * PAGE_DISPLAY_H,
                            width: (t.box.width / doc.rasterWidth) * PAGE_DISPLAY_W,
                            height: (t.box.height / doc.rasterHeight) * PAGE_DISPLAY_H,
                          },
                        ]}
                      >
                        <VerticalText
                          content={t.content}
                          color={t.color}
                          fontSize={Math.max(8, t.fontSize * 0.7)}
                          editable={selectedText}
                          onChangeText={(content) =>
                            dispatch({ type: 'editText', textId: t.id, content })
                          }
                          accessibilityLabel="ページのテキスト本文"
                        />
                        {selectedText ? <View pointerEvents="none" style={styles.resizeHandle} /> : null}
                      </View>
                    );
                  })}
                </View>
                <Pressable
                  onPress={() => {
                    if (selected) {
                      setAskInsert(true);
                    } else {
                      dispatch({ type: 'selectPage', pageId });
                    }
                  }}
                  style={styles.numHit}
                >
                  <Text style={[styles.num, selected && styles.numOn]}>{frame.slot.number}</Text>
                </Pressable>
              </View>
            );
          })}
          {doc.pasteboardClips.map((clip) => (
            <Pressable
              key={clip.id}
              onPress={() => dispatch({ type: 'selectClip', clipId: clip.id })}
              onLongPress={() => onDragStart({ type: 'clip', clipId: clip.id })}
              style={{
                position: 'absolute',
                left: clip.x,
                top: clip.y,
                width: PAGE_DISPLAY_W * 0.45 * clip.scale,
                height: PAGE_DISPLAY_H * 0.45 * clip.scale,
                transform: [{ rotate: `${clip.rotation}rad` }],
                borderWidth: doc.selectedClipId === clip.id ? 2 : 1,
                borderColor: colors.accent,
                backgroundColor: 'rgba(255,255,255,0.7)',
                overflow: 'hidden',
              }}
            >
              <InkLayer
                raster={clip.raster}
                width={PAGE_DISPLAY_W * 0.45 * clip.scale}
                height={PAGE_DISPLAY_H * 0.45 * clip.scale}
              />
            </Pressable>
          ))}
          {doc.pasteboardTexts.map((t) => {
            const selectedText = doc.selectedTextId === t.id;
            return (
              <View
                key={t.id}
                pointerEvents={selectedText ? 'box-none' : 'none'}
                style={[
                  styles.textBox,
                  selectedText && styles.textBoxOn,
                  {
                    position: 'absolute',
                    left: t.box.x,
                    top: t.box.y,
                    width: Math.max(24, t.box.width),
                    height: Math.max(24, t.box.height),
                  },
                ]}
              >
                <VerticalText
                  content={t.content}
                  color={t.color}
                  fontSize={t.fontSize}
                  editable={selectedText}
                  onChangeText={(content) => dispatch({ type: 'editText', textId: t.id, content })}
                  accessibilityLabel="台紙のテキスト本文"
                />
                {selectedText ? <View pointerEvents="none" style={styles.resizeHandle} /> : null}
              </View>
            );
          })}
        </View>
      </View>
      {editor ? (
        <TextInput
          accessibilityLabel="テキスト本文"
          value={editor.content}
          onChangeText={(content) => dispatch({ type: 'editText', textId: editor.id, content })}
          placeholder="本文を入力（縦書きで枠に表示。空でも可）"
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          style={styles.bodyInput}
        />
      ) : (
        <Text style={styles.hint}>
          指: パン／ピンチ。Pencil＋テキストで枠を移動・右下ハンドルでリサイズ。選択した枠の本文を編集（回転なし）。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    minHeight: 220,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  smallBtn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  smallBtnText: {
    color: colors.text,
    fontWeight: '600',
  },
  canvas: {
    flex: 1,
    minHeight: PAGE_DISPLAY_H + 40,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    borderRadius: 8,
  },
  page: {
    position: 'absolute',
    width: PAGE_DISPLAY_W,
    height: PAGE_DISPLAY_H,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  pageOn: {
    borderColor: colors.accent,
    borderWidth: 2,
  },
  blank: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  muted: {
    color: colors.textMuted,
  },
  numHit: {
    minHeight: touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text,
  },
  numOn: {
    color: colors.accent,
  },
  append: {
    position: 'absolute',
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appendText: {
    fontSize: 28,
    color: colors.accent,
  },
  hint: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.textMuted,
  },
  bodyInput: {
    minHeight: 72,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    fontSize: 16,
    backgroundColor: colors.surfaceMuted,
  },
  textBox: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  textBoxOn: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  resizeHandle: {
    position: 'absolute',
    right: -6,
    bottom: -6,
    width: 14,
    height: 14,
    borderRadius: 2,
    backgroundColor: colors.accent,
    borderWidth: 1,
    borderColor: '#fff',
  },
});
