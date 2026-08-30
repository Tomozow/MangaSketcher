import { HomeScreenInstallHint } from '@/src/web/HomeScreenInstallHint';
import { ProjectList } from '@/src/web/ProjectList';
import styles from './page.module.css';

export default function ProjectListPage() {
  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <h1 className={styles.title}>MangaSketcher</h1>
        <p className={styles.subtitle}>プロジェクト一覧</p>
      </header>
      <HomeScreenInstallHint />
      <ProjectList />
    </main>
  );
}
