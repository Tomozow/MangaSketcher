import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { deleteProject, listProjects, renameProject, saveProject } from '../domain/projects';
import type { ProjectMeta } from '../domain/types';
import { newProjectDocument } from '../state/useEditorSession';
import { appStore } from '../storage/appStore';
import { colors, spacing, touchTarget } from '../theme/tokens';

type ProjectListScreenProps = {
  onOpen: (projectId: string) => void;
};

export function ProjectListScreen({ onOpen }: ProjectListScreenProps) {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [name, setName] = useState('無題のネーム');
  const [pageCount, setPageCount] = useState('5');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = useCallback(async () => {
    setProjects(await listProjects(appStore));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create() {
    const n = Number.parseInt(pageCount, 10);
    if (!Number.isFinite(n) || n < 1) {
      Alert.alert('ページ数', '1 以上の数字を指定してください。');
      return;
    }
    const doc = newProjectDocument(name.trim() || '無題のネーム', n);
    await saveProject(appStore, doc, new Date().toISOString());
    onOpen(doc.projectId);
  }

  async function commitRename() {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await renameProject(appStore, renamingId, renameValue.trim(), new Date().toISOString());
    setRenamingId(null);
    await reload();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <Text style={styles.heading}>MangaSketcher</Text>
      <Text style={styles.sub}>端末内に自動保存します。同時に開くプロジェクトは 1 つです。</Text>
      <View style={styles.create}>
        <Text style={styles.label}>ページ数（先に指定）</Text>
        <TextInput
          value={pageCount}
          onChangeText={setPageCount}
          keyboardType="number-pad"
          style={styles.input}
        />
        <Text style={styles.label}>タイトル</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} />
        <Pressable style={styles.primary} onPress={() => void create()}>
          <Text style={styles.primaryText}>新規作成（白紙）</Text>
        </Pressable>
      </View>
      <Text style={styles.section}>プロジェクト</Text>
      {projects.length === 0 ? (
        <Text style={styles.empty}>まだありません。</Text>
      ) : (
        projects.map((item) => (
          <View key={item.id} style={styles.row}>
            {renamingId === item.id ? (
              <View style={styles.open}>
                <TextInput value={renameValue} onChangeText={setRenameValue} style={styles.input} />
                <Pressable style={styles.side} onPress={() => void commitRename()}>
                  <Text>保存</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.open} onPress={() => onOpen(item.id)}>
                <Text style={styles.rowTitle}>{item.name}</Text>
                <Text style={styles.rowMeta}>
                  {item.pageCount}ページ · {item.updatedAt.replace('T', ' ').slice(0, 16)}
                </Text>
              </Pressable>
            )}
            <Pressable
              style={styles.side}
              onPress={() => {
                setRenamingId(item.id);
                setRenameValue(item.name);
              }}
            >
              <Text>改名</Text>
            </Pressable>
            <Pressable
              style={styles.side}
              onPress={() =>
                Alert.alert('削除', `${item.name} を削除しますか？`, [
                  { text: 'キャンセル', style: 'cancel' },
                  {
                    text: '削除',
                    style: 'destructive',
                    onPress: () => {
                      void (async () => {
                        await deleteProject(appStore, item.id);
                        await reload();
                      })();
                    },
                  },
                ])
              }
            >
              <Text>削除</Text>
            </Pressable>
          </View>
        ))
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.lg,
  },
  heading: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text,
  },
  sub: {
    marginTop: spacing.xs,
    color: colors.textMuted,
    marginBottom: spacing.lg,
  },
  create: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {
    color: colors.text,
    fontWeight: '600',
  },
  input: {
    minHeight: touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    color: colors.text,
  },
  primary: {
    minHeight: touchTarget,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  section: {
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  empty: {
    color: colors.textMuted,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
  },
  open: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text,
  },
  rowMeta: {
    color: colors.textMuted,
  },
  side: {
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
  },
});
