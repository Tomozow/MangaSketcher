import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

import { PageThumb } from './PageThumb';
import type { DocumentState, PageId, StockLayout } from '../domain/types';
import { createPointerKindTracker, stockPointerPolicy } from '../input/nativePointer';
import { pointerPanGesture, pointerPinchGesture } from '../input/pointerGestures';
import { colors, spacing, touchTarget } from '../theme/tokens';

type NameStockProps = {
  doc: DocumentState;
  compact: boolean;
  layout: StockLayout;
  onToggleLayout: () => void;
  onPlace: (pageId: PageId, x: number, y: number) => void;
  onDelete: (pageId: PageId) => void;
  onPanZoom: (zoom: number, panX: number, panY: number) => void;
  onDragStart: (payload: { type: 'stockPage'; pageId: PageId }) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
};

export function NameStock({
  doc,
  compact,
  layout,
  onToggleLayout,
  onPlace,
  onDelete,
  onPanZoom,
  onDragStart,
  onDragMove,
  onDragEnd,
}: NameStockProps) {
  const origin = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const draggingId = useRef<PageId | null>(null);
  const kindTracker = useRef(createPointerKindTracker()).current;
  const panHeld = useRef(false);
  const pinchStartZoom = useRef(1);

  function boardPoint(pageX: number, pageY: number) {
    const lx = (pageX - origin.current.x - doc.stockPanX) / doc.stockZoom;
    const ly = (pageY - origin.current.y - doc.stockPanY) / doc.stockZoom;
    return { x: lx, y: ly };
  }

  const grid = layout === 'grid';
  const thumbW = compact ? 56 : 72;
  const thumbH = compact ? 78 : 100;

  function startPageDrag(pageId: PageId, pageX: number, pageY: number) {
    draggingId.current = pageId;
    onDragStart({ type: 'stockPage', pageId });
    onDragMove(pageX, pageY);
  }

  const boardPan = pointerPanGesture({
    tracker: kindTracker,
    heldRef: panHeld,
    shouldCapture: (sample) => sample.kind === 'finger',
    onGrant: (sample) => {
      last.current = { x: sample.pageX, y: sample.pageY };
      draggingId.current = null;
      const policy = stockPointerPolicy(sample.kind);
      if (!policy.dragPage && !policy.pan) {
        return;
      }
      const pt = boardPoint(sample.pageX, sample.pageY);
      const hit = [...doc.stock].reverse().find(
        (item) => pt.x >= item.x && pt.x <= item.x + 88 && pt.y >= item.y && pt.y <= item.y + 120,
      );
      if (hit && policy.dragPage) {
        startPageDrag(hit.pageId, sample.pageX, sample.pageY);
      }
    },
    onMove: (sample) => {
      if (sample.pointerCount >= 2) {
        return;
      }
      const policy = stockPointerPolicy(sample.kind);
      const dx = sample.pageX - last.current.x;
      const dy = sample.pageY - last.current.y;
      if (draggingId.current && policy.dragPage) {
        const pt = boardPoint(sample.pageX, sample.pageY);
        onPlace(draggingId.current, pt.x - 40, pt.y - 50);
        onDragMove(sample.pageX, sample.pageY);
      } else if (policy.pan && !draggingId.current) {
        onPanZoom(doc.stockZoom, doc.stockPanX + dx, doc.stockPanY + dy);
      }
      last.current = { x: sample.pageX, y: sample.pageY };
    },
    onRelease: (sample) => {
      kindTracker.release(sample.native);
      onDragEnd(sample.pageX, sample.pageY);
      draggingId.current = null;
    },
  });
  const boardPinch = pointerPinchGesture({
    onStart: () => {
      pinchStartZoom.current = doc.stockZoom;
    },
    onPinch: (scale) => {
      onPanZoom(
        Math.min(3, Math.max(0.4, pinchStartZoom.current * scale)),
        doc.stockPanX,
        doc.stockPanY,
      );
    },
  });
  const boardGesture = Gesture.Simultaneous(boardPan, boardPinch);

  return (
    <View style={[styles.panel, compact && styles.panelCompact]}>
      <View style={styles.titleRow}>
        {compact ? null : <Text style={styles.title}>ネームストック</Text>}
        <Pressable onPress={onToggleLayout} style={styles.modeBtn} accessibilityLabel="ストックの並び">
          <Text style={styles.modeBtnText}>{grid ? '自由' : '整列'}</Text>
        </Pressable>
      </View>
      {compact ? null : (
        <Text style={styles.hint}>
          {grid
            ? '登録順のサムネイル。列へドロップで復帰。'
            : 'ページのみ・自由配置。ピンチとパン可。列へドロップで復帰。'}
        </Text>
      )}
      {grid ? (
        <View style={styles.grid}>
          {doc.stock.length === 0 ? (
            <Text style={styles.empty}>ワークスペースからページをドロップするとここに置かれます。</Text>
          ) : (
            doc.stock.map((item, index) => {
              const page = doc.pages[item.pageId];
              return (
                <View key={item.pageId} style={styles.gridCard}>
                  <GestureDetector
                    gesture={pointerPanGesture({
                      tracker: kindTracker,
                      heldRef: panHeld,
                      shouldCapture: (sample) => sample.kind === 'finger',
                      onGrant: (sample) => {
                        if (stockPointerPolicy(sample.kind).dragPage) {
                          startPageDrag(item.pageId, sample.pageX, sample.pageY);
                        }
                      },
                      onMove: (sample) => onDragMove(sample.pageX, sample.pageY),
                      onRelease: (sample) => {
                        kindTracker.release(sample.native);
                        onDragEnd(sample.pageX, sample.pageY);
                        draggingId.current = null;
                      },
                    })}
                  >
                    <View>
                      <PageThumb page={page} width={thumbW} height={thumbH} />
                    </View>
                  </GestureDetector>
                  <Text style={styles.order}>{index + 1}</Text>
                  <Pressable style={styles.del} onPress={() => onDelete(item.pageId)}>
                    <Text style={styles.delText}>削除</Text>
                  </Pressable>
                </View>
              );
            })
          )}
        </View>
      ) : (
        <GestureDetector gesture={boardGesture}>
        <View
          style={styles.board}
          onLayout={(e) => {
            e.currentTarget.measureInWindow((x, y) => {
              origin.current = { x, y };
            });
          }}
        >
          <View
            style={{
              flex: 1,
              transform: [
                { translateX: doc.stockPanX },
                { translateY: doc.stockPanY },
                { scale: doc.stockZoom },
              ],
            }}
          >
            {doc.stock.length === 0 ? (
              <Text style={styles.empty}>ワークスペースからページをドロップするとここに置かれます。</Text>
            ) : (
              doc.stock.map((item) => {
                const page = doc.pages[item.pageId];
                return (
                  <View key={item.pageId} style={[styles.card, { left: item.x, top: item.y }]}>
                    <View style={styles.thumb}>
                      <PageThumb page={page} width={72} height={100} />
                    </View>
                    <Pressable style={styles.del} onPress={() => onDelete(item.pageId)}>
                      <Text style={styles.delText}>削除</Text>
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        </View>
        </GestureDetector>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    minHeight: 120,
    padding: spacing.md,
    backgroundColor: colors.surface,
  },
  panelCompact: {
    padding: spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  title: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  modeBtn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
  },
  modeBtnText: {
    color: colors.text,
    fontWeight: '600',
  },
  hint: {
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  board: {
    flex: 1,
    minHeight: touchTarget * 3,
    borderRadius: 8,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  grid: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    alignContent: 'flex-start',
  },
  gridCard: {
    width: 80,
    alignItems: 'center',
  },
  empty: {
    padding: spacing.md,
    color: colors.textMuted,
  },
  card: {
    position: 'absolute',
    width: 88,
  },
  thumb: {
    width: 72,
    height: 100,
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  order: {
    fontSize: 12,
    color: colors.textMuted,
  },
  del: {
    minHeight: touchTarget,
    justifyContent: 'center',
  },
  delText: {
    color: colors.text,
    fontWeight: '600',
  },
});
