'use client';

import { useEffect, useState } from 'react';
import { encode } from 'uqr';
import { readAppleTouchDevice, readStandaloneDisplay, shouldShowIpadCaQr } from '@/src/web/displayMode';
import { loadCaPageUrl } from '@/src/web/lanPack/caPageUrl';
import styles from '@/app/page.module.css';

function QrSvg({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 2, ecc: 'M' });
  return (
    <svg
      className={styles.ipadCaQrSvg}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={text}
    >
      <rect width={size} height={size} fill="#fff" />
      {data.map((row, y) =>
        row.map((on, x) =>
          on ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1c1c22" /> : null,
        ),
      )}
    </svg>
  );
}

export function IpadCaQrButton() {
  const [open, setOpen] = useState(false);
  const [showOnPc, setShowOnPc] = useState(false);
  const [caPageUrl, setCaPageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setShowOnPc(
      shouldShowIpadCaQr({
        hostname: window.location.hostname,
        standalone: readStandaloneDisplay(),
        appleTouch: readAppleTouchDevice(),
      }),
    );
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    void loadCaPageUrl({ hostname: window.location.hostname }).then(
      (url) => {
        if (!cancelled) {
          setCaPageUrl(url);
          setLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!showOnPc) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        className={styles.ipadCaQrFab}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="iPad用証明書ページのQR"
        onClick={() => setOpen(true)}
      >
        iPad QR
      </button>
      {open ? (
        <div className={styles.lanModalRoot} role="dialog" aria-modal="true" aria-labelledby="ipad-ca-qr-title">
          <div className={styles.lanModalBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.lanModal}>
            <strong id="ipad-ca-qr-title" className={styles.exportReadyLabel}>
              iPad用セットアップ
            </strong>
            <p className={styles.ipadCaQrNote}>
              カメラで読み、証明書を入れてから同じページのアプリURLを開いてください。
            </p>
            {loading ? (
              <div className={styles.lanSpinnerWrap} role="status" aria-label="読み込み中">
                <span className={styles.lanSpinner} />
              </div>
            ) : caPageUrl ? (
              <>
                <QrSvg text={caPageUrl} />
                <p className={styles.ipadCaQrUrl}>{caPageUrl}</p>
              </>
            ) : (
              <p className={styles.error} role="alert">
                証明書ページのアドレスを取得できません。PCで LAN HTTPS（ポート3002）を起動してください。
              </p>
            )}
            <button type="button" className={styles.secondaryButton} onClick={() => setOpen(false)}>
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
