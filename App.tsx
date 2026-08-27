import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

import { HomeScreen } from './src/screens/HomeScreen';
import { ProjectListScreen } from './src/screens/ProjectListScreen';
import { useEditorSession } from './src/state/useEditorSession';
import { colors } from './src/theme/tokens';

export default function App() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const session = useEditorSession(projectId);

  useEffect(() => {
    void ScreenOrientation.unlockAsync();
  }, []);

  return (
    <>
      {projectId === null ? (
        <ProjectListScreen onOpen={setProjectId} />
      ) : session.error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
          <Text>{session.error}</Text>
        </View>
      ) : session.history ? (
        <HomeScreen history={session.history} dispatch={session.dispatch} onBack={() => setProjectId(null)} />
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.background }} />
      )}
      <StatusBar style="dark" />
    </>
  );
}
