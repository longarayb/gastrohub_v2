import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { storage } from './src/lib/storage';
import { RouteScreen } from './src/screens/route';
import { LoginScreen, ServerScreen } from './src/screens/setup';
import { useTheme } from './src/ui/theme';

type Screen =
  { name: 'loading' } | { name: 'server' } | { name: 'login'; server: string } | { name: 'route' };

/** Courier app (D050): server address → login → the route. */
export default function App() {
  const t = useTheme();
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [server, setServer] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = await storage.getServer();
      setServer(saved);
      if (!saved) return setScreen({ name: 'server' });
      setScreen(
        (await storage.getRefresh()) ? { name: 'route' } : { name: 'login', server: saved },
      );
    })();
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <StatusBar style="auto" />
      {screen.name === 'loading' && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.primary} />
        </View>
      )}
      {screen.name === 'server' && (
        <ServerScreen
          current={server}
          onSaved={(saved) => {
            setServer(saved);
            void storage
              .getRefresh()
              .then((refresh) =>
                setScreen(refresh ? { name: 'route' } : { name: 'login', server: saved }),
              );
          }}
        />
      )}
      {screen.name === 'login' && (
        <LoginScreen
          server={screen.server}
          onLoggedIn={() => setScreen({ name: 'route' })}
          onChangeServer={() => setScreen({ name: 'server' })}
        />
      )}
      {screen.name === 'route' && (
        <RouteScreen
          onSignedOut={() => setScreen(server ? { name: 'login', server } : { name: 'server' })}
          onChangeServer={() => setScreen({ name: 'server' })}
        />
      )}
    </View>
  );
}
