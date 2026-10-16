import { BRAND } from '@app/shared';
import { useState } from 'react';
import { KeyboardAvoidingView, ScrollView, View } from 'react-native';
import { ApiError, login, publicApi } from '../lib/api';
import { installedVersion } from '../lib/device';
import { isInsecureRemote, normalizeServer } from '../lib/server-url';
import { storage } from '../lib/storage';
import { Body, Button, Card, Field, Notice, Title } from '../ui/components';
import { space, useTheme } from '../ui/theme';

/** The server address (home network now, the hosted server later: same APK). */
export function ServerScreen({
  current,
  onSaved,
}: {
  current: string | null;
  onSaved: (server: string) => void;
}) {
  const t = useTheme();
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = normalizeServer(value);

  async function save() {
    if (!normalized) return setError('Digite o endereço, por exemplo 192.168.0.92:3000');
    setBusy(true);
    setError(null);
    const previous = await storage.getServer();
    await storage.setServer(normalized);
    try {
      await publicApi('/health');
      onSaved(normalized);
    } catch (e) {
      if (previous) await storage.setServer(previous);
      setError(
        e instanceof ApiError && e.status === 0
          ? 'Não encontrei o servidor nesse endereço. Confira se o celular está no mesmo Wi-Fi.'
          : 'Esse endereço não é do sistema.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 72, gap: space.lg }}>
        <Title>{`${BRAND.name} Entregas`}</Title>
        <Card>
          <Body bold>Endereço do servidor</Body>
          <Body muted>
            O mesmo endereço do painel. Na rede de casa, algo como 192.168.0.92:3000; depois da
            publicação, o endereço do painel na internet.
          </Body>
          <Field
            label="Endereço"
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="192.168.0.92:3000"
            error={error}
            onSubmitEditing={() => void save()}
          />
          {normalized && isInsecureRemote(normalized) && (
            <Notice tone="warning">
              Endereço sem https fora da rede de casa: a senha iria sem proteção. Use https.
            </Notice>
          )}
          <Button label="Salvar" busy={busy} onPress={() => void save()} big />
        </Card>
        <Body muted size="sm">{`Versão ${installedVersion()}`}</Body>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Same login as the panel (the courier's e-mail and password). */
export function LoginScreen({
  server,
  onLoggedIn,
  onChangeServer,
}: {
  server: string;
  onLoggedIn: () => void;
  onChangeServer: () => void;
}) {
  const t = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!email || !password) return setError('Digite o e-mail e a senha');
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
      onLoggedIn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível entrar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView behavior="height" style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingTop: 72, gap: space.lg }}>
        <Title>{`${BRAND.name} Entregas`}</Title>
        <Card>
          <Field
            label="E-mail"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Field
            label="Senha"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            onSubmitEditing={() => void submit()}
          />
          {error && <Notice tone="danger">{error}</Notice>}
          <Button label="Entrar" busy={busy} onPress={() => void submit()} big />
        </Card>
        <View style={{ gap: space.sm }}>
          <Body muted size="sm">{`Servidor: ${server}`}</Body>
          <Button label="Trocar servidor" variant="ghost" onPress={onChangeServer} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
