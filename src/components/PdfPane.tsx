import * as DocumentPicker from 'expo-document-picker';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { pdfJsItemsToDomain } from '../domain/pdfExtract';
import {
  DEFAULT_PDF_MEDIA,
  bodyItemsForOverlay,
  normalizeRect,
  pdfItemToView,
  viewRectToPdf,
} from '../domain/pdfLayout';
import { joinVerticalBody, rangeSelectBody } from '../domain/pdfText';
import { clampPdfPage, pdfPageRenderCommand, pdfPageViewerHtml, pdfPageViewerKey } from '../domain/pdfView';
import type { DocumentState, PdfTextItem, Rect } from '../domain/types';
import { createPointerKindTracker, pdfPointerPolicy } from '../input/nativePointer';
import { colors, spacing, touchTarget } from '../theme/tokens';

type PdfPaneProps = {
  doc: DocumentState;
  onLoad: (uri: string, pageCount: number, sourceTextByPage: Record<number, PdfTextItem[]>) => void;
  onView: (patch: { currentPage?: number; zoom?: number; panX?: number; panY?: number }) => void;
  onTextDragStart: (payload: { type: 'pdfText'; pdfPage: number; range: Rect; preview: string }) => void;
  onDragMove: (x: number, y: number) => void;
  onDragEnd: (x: number, y: number) => void;
};

const pdfB64Cache = new Map<string, string>();

const EXTRACTOR_HTML = `<!DOCTYPE html>
<html>
<body>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function go(b64) {
    const raw = atob(b64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    pdfjsLib.getDocument({ data: bytes }).promise.then(async (pdf) => {
      const pages = {};
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages[n] = content.items.filter(it => it.str !== undefined).map(it => ({
          str: it.str,
          transform: it.transform,
          width: it.width,
          height: it.height
        }));
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({ pageCount: pdf.numPages, pages }));
    }).catch(err => window.ReactNativeWebView.postMessage(JSON.stringify({ error: String(err) })));
  }
  document.addEventListener("message", (e) => go(e.data));
  window.addEventListener("message", (e) => go(e.data));
</script>
</body>
</html>`;

export function PdfPane({ doc, onLoad, onView, onTextDragStart, onDragMove, onDragEnd }: PdfPaneProps) {
  const [busy, setBusy] = useState(false);
  const [pdfBytes, setPdfBytes] = useState<string | null>(null);
  const [extractBytes, setExtractBytes] = useState<string | null>(null);
  const [viewSize, setViewSize] = useState({ width: 400, height: 280 });
  const [range, setRange] = useState<Rect | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const overlayOrigin = useRef({ x: 0, y: 0 });
  const extractor = useRef<WebView>(null);
  const viewer = useRef<WebView>(null);
  const lastPinch = useRef({ d: 0, z: 1 });
  const kindTracker = useRef(createPointerKindTracker()).current;

  const pdf = doc.pdf;
  const current = pdf ? clampPdfPage(pdf.currentPage, pdf.pageCount) : 1;
  const viewerKey = pdf ? pdfPageViewerKey(pdf.uri, current) : 'empty';

  useEffect(() => {
    if (!pdf?.uri) {
      setPdfBytes(null);
      return;
    }
    const cached = pdfB64Cache.get(pdf.uri);
    if (cached) {
      setPdfBytes(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const b64 = await FileSystem.readAsStringAsync(pdf.uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        pdfB64Cache.set(pdf.uri, b64);
        if (!cancelled) {
          setPdfBytes(b64);
        }
      } catch {
        if (!cancelled) {
          setPdfBytes(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf?.uri]);

  useEffect(() => {
    if (!pdfBytes || !pdf) {
      return;
    }
    viewer.current?.postMessage(pdfPageRenderCommand(current, pdfBytes));
  }, [current, pdfBytes, pdf]);

  async function pick() {
    setBusy(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) {
        return;
      }
      const asset = result.assets[0];
      const FileSystem = await import('expo-file-system/legacy');
      const b64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      pdfB64Cache.set(asset.uri, b64);
      setPdfBytes(b64);
      setExtractBytes(b64);
      onLoad(asset.uri, 1, { 1: [] });
    } finally {
      setBusy(false);
    }
  }

  const total = pdf?.pageCount ?? 0;
  const source = pdf?.sourceTextByPage[current] ?? [];
  const body = bodyItemsForOverlay(source);
  const pdfRange = range
    ? viewRectToPdf(range, viewSize.width, viewSize.height, DEFAULT_PDF_MEDIA, pdf?.zoom ?? 1, pdf?.panX ?? 0, pdf?.panY ?? 0)
    : null;
  const preview = pdfRange ? joinVerticalBody(rangeSelectBody(source, pdfRange)) : '';

  return (
    <View style={styles.panel}>
      {!pdf ? (
        <View style={styles.empty}>
          <Text style={styles.pdfLabel}>PDF</Text>
          <Text style={styles.hint}>このペインからファイルを選びます。本文は範囲選択してワークスペースへドラッグします。</Text>
          <Pressable style={styles.btn} onPress={() => void pick()} disabled={busy}>
            <Text style={styles.btnText}>{busy ? '読込中…' : 'PDFを選ぶ'}</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.stage}>
            {pdfBytes ? (
              <WebView
                ref={viewer}
                key={viewerKey}
                style={styles.viewer}
                originWhitelist={['*']}
                javaScriptEnabled
                source={{ html: pdfPageViewerHtml(pdfBytes, current) }}
              />
            ) : (
              <View style={styles.loading}>
                <Text style={styles.hint}>ページ {current} を描画中…</Text>
              </View>
            )}
            <View
              style={styles.overlay}
              onLayout={(e) => {
                setViewSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
                e.currentTarget.measureInWindow((x, y) => {
                  overlayOrigin.current = { x, y };
                });
              }}
              onStartShouldSetResponder={(evt) => {
                const kind = kindTracker.classify(evt.nativeEvent);
                const touches = evt.nativeEvent.touches ?? [];
                if (touches.length >= 2) {
                  return true;
                }
                return pdfPointerPolicy(kind).rangeSelect;
              }}
              onMoveShouldSetResponder={() => true}
              onResponderGrant={(evt) => {
                const kind = kindTracker.classify(evt.nativeEvent);
                if (!pdfPointerPolicy(kind).rangeSelect) {
                  return;
                }
                const localX = evt.nativeEvent.pageX - overlayOrigin.current.x;
                const localY = evt.nativeEvent.pageY - overlayOrigin.current.y;
                dragOrigin.current = { x: localX, y: localY };
                setRange({ x: localX, y: localY, width: 0, height: 0 });
              }}
              onResponderMove={(evt) => {
                const touches = evt.nativeEvent.touches ?? [];
                if (touches.length >= 2) {
                  const dist = Math.hypot(
                    touches[0].pageX - touches[1].pageX,
                    touches[0].pageY - touches[1].pageY,
                  );
                  if (lastPinch.current.d > 0) {
                    onView({
                      zoom: Math.min(4, Math.max(0.5, lastPinch.current.z * (dist / lastPinch.current.d))),
                    });
                  } else {
                    lastPinch.current = { d: dist, z: pdf.zoom };
                  }
                  return;
                }
                const kind = kindTracker.classify(evt.nativeEvent);
                if (pdfPointerPolicy(kind).rangeSelect && dragOrigin.current) {
                  const localX = evt.nativeEvent.pageX - overlayOrigin.current.x;
                  const localY = evt.nativeEvent.pageY - overlayOrigin.current.y;
                  setRange(normalizeRect(dragOrigin.current.x, dragOrigin.current.y, localX, localY));
                }
                onDragMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
              }}
              onResponderRelease={(evt) => {
                lastPinch.current = { d: 0, z: pdf.zoom };
                dragOrigin.current = null;
                kindTracker.release(evt.nativeEvent);
                onDragEnd(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
              }}
            >
              {body.slice(0, 80).map((item, i) => {
                const box = pdfItemToView(item, viewSize.width, viewSize.height);
                return (
                  <View
                    key={`${item.str}-${i}`}
                    pointerEvents="none"
                    style={[
                      styles.glyph,
                      { left: box.x, top: box.y, width: box.width, height: box.height },
                    ]}
                  />
                );
              })}
              {range && range.width > 2 && range.height > 2 ? (
                <View
                  pointerEvents="none"
                  style={[
                    styles.range,
                    { left: range.x, top: range.y, width: range.width, height: range.height },
                  ]}
                />
              ) : null}
            </View>
          </View>
          {extractBytes ? (
            <WebView
              ref={extractor}
              style={styles.hidden}
              originWhitelist={['*']}
              source={{ html: EXTRACTOR_HTML }}
              onLoadEnd={() => {
                extractor.current?.postMessage(extractBytes);
              }}
              onMessage={(event) => {
                try {
                  const payload = JSON.parse(event.nativeEvent.data) as {
                    pageCount?: number;
                    pages?: Record<
                      number,
                      Array<{ str: string; transform: number[]; width: number; height: number }>
                    >;
                  };
                  if (!payload.pages || !payload.pageCount) {
                    return;
                  }
                  const sourceTextByPage: Record<number, PdfTextItem[]> = {};
                  for (const [k, items] of Object.entries(payload.pages)) {
                    sourceTextByPage[Number(k)] = pdfJsItemsToDomain(items);
                  }
                  onLoad(pdf.uri, payload.pageCount, sourceTextByPage);
                  setExtractBytes(null);
                } catch {
                  setExtractBytes(null);
                }
              }}
            />
          ) : null}
          <View style={styles.toolbar}>
            <Pressable style={styles.btn} onPress={() => onView({ currentPage: Math.max(1, current - 1) })}>
              <Text style={styles.btnText}>前</Text>
            </Pressable>
            <View style={styles.pageBadge} accessibilityLabel={`PDFのページ ${current} / ${total}`}>
              <Text style={styles.pageText}>
                {current}/{total || 1}
              </Text>
            </View>
            <Pressable
              style={styles.btn}
              onPress={() => onView({ currentPage: Math.min(Math.max(total, 1), current + 1) })}
            >
              <Text style={styles.btnText}>次</Text>
            </Pressable>
            <Pressable style={styles.btn} onPress={() => void pick()}>
              <Text style={styles.btnText}>差し替え</Text>
            </Pressable>
            <Pressable
              disabled={!pdfRange || preview.length === 0}
              style={styles.btn}
              onStartShouldSetResponder={() => Boolean(pdfRange && preview.length > 0)}
              onResponderGrant={(evt) => {
                if (!pdfRange || preview.length === 0) {
                  return;
                }
                onTextDragStart({
                  type: 'pdfText',
                  pdfPage: current,
                  range: pdfRange,
                  preview: preview.slice(0, 24),
                });
                onDragMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY);
              }}
              onResponderMove={(evt) => onDragMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY)}
              onResponderRelease={(evt) => onDragEnd(evt.nativeEvent.pageX, evt.nativeEvent.pageY)}
            >
              <Text style={styles.btnText}>
                {preview ? `選択をドラッグ（${preview.slice(0, 8)}…）` : '範囲をドラッグ選択'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    position: 'relative',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  stage: {
    flex: 1,
    position: 'relative',
  },
  viewer: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  glyph: {
    position: 'absolute',
    backgroundColor: 'rgba(61,90,128,0.12)',
  },
  range: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: colors.accent,
    backgroundColor: 'rgba(61,90,128,0.18)',
  },
  hidden: {
    height: 1,
    width: 1,
    opacity: 0,
  },
  pdfLabel: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.textMuted,
  },
  hint: {
    color: colors.textMuted,
    textAlign: 'center',
  },
  toolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    padding: spacing.sm,
    alignItems: 'center',
  },
  pageBadge: {
    minHeight: touchTarget,
    minWidth: touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
  },
  btn: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  btnText: {
    fontWeight: '600',
    color: colors.text,
  },
});
