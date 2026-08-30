'use client';

import { useEffect, useState } from 'react';
import styles from '@/app/page.module.css';

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const standalone = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    'standalone' in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone);
  return standalone || iosStandalone;
}

export function HomeScreenInstallHint() {
  const [show, setShow] = useState(false);
  const [tunnel, setTunnel] = useState(false);

  useEffect(() => {
    setShow(!isStandaloneDisplay());
    setTunnel(/\.(trycloudflare\.com|ngrok-free\.app|ngrok\.io)$/i.test(window.location.hostname));
  }, []);

  if (!show) {
    return null;
  }

  if (tunnel) {
    return (
      <section className={styles.installHint} aria-labelledby="homescreen-install-heading">
        <h2 id="homescreen-install-heading" className={styles.installHintTitle}>
          この URL ではホーム画面に追加できません
        </h2>
        <p className={styles.installHintNote}>
          Safari が一時公開 URL（trycloudflare など）の追加を拒否します。同じ Wi-Fi の PC で証明書ページ
          http://192.168.0.2:3002/ を開き、手順どおり証明書を入れてから
          https://192.168.0.2:3443/ を Safari で開いて追加してください。
        </p>
      </section>
    );
  }

  return (
    <section className={styles.installHint} aria-labelledby="homescreen-install-heading">
      <h2 id="homescreen-install-heading" className={styles.installHintTitle}>
        ホーム画面に追加する
      </h2>
      <ol className={styles.installHintSteps}>
        <li>すでにホーム画面にある MangaSketcher を長押しして削除する</li>
        <li>このページを再読み込みし、数秒待つ</li>
        <li>
          <strong>Safari</strong>の共有 → 下へスクロール →「ホーム画面に追加」→「追加」
        </li>
      </ol>
      <p className={styles.installHintNote}>
        Chrome や「Dock に追加」では失敗します。証明書の警告が出ている間も失敗します。
      </p>
    </section>
  );
}
