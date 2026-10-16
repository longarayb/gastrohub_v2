import {
  type CourierAppDto,
  type CourierAppReleaseDto,
  type CourierAppStopDto,
  BRAND,
  DELIVERY_FAILURE_LABELS,
  PAYMENT_METHOD_LABELS,
  TRACKING_CONSENT_VERSION,
  formatBRL,
  formatPhone,
  formatTime,
} from '@app/shared';
import NetInfo from '@react-native-community/netinfo';
import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, ScrollView, View } from 'react-native';
import { ApiError, SessionEndedError, api, logout } from '../lib/api';
import { fetchRoute, flush, newAction, queueAction, readQueue } from '../lib/courier';
import {
  type NoticeState,
  batteryOptimized,
  call,
  downloadRelease,
  installedVersion,
  navigate,
  newerRelease,
  registerNotices,
} from '../lib/device';
import { type QueueState, emptyQueue } from '../lib/queue';
import { storage } from '../lib/storage';
import {
  askPermission,
  isSharing,
  missingPermission,
  startSharing,
  stopSharing,
} from '../lib/tracking';
import { Badge, Body, Button, Card, Notice, Title } from '../ui/components';
import { space, useTheme } from '../ui/theme';
import {
  BackgroundPermissionSheet,
  BatterySheet,
  type Collection,
  CollectionSheet,
  ConsentSheet,
  FailureSheet,
} from './sheets';

const APP_NAME = `${BRAND.name} Entregas`;
const REFRESH_MS = 30_000;

type StopStatus = CourierAppStopDto['status'];

/** Status shown: what the server says, or what is waiting in the queue to be sent. */
function statusOf(
  stop: CourierAppStopDto,
  queue: QueueState,
): { status: StopStatus; waiting: boolean } {
  const queued = queue.actions.find((a) => a.stopId === stop.stopId);
  if (stop.status === 'PENDING' && queued) {
    return { status: queued.kind === 'deliver' ? 'DELIVERED' : 'FAILED', waiting: true };
  }
  return { status: stop.status, waiting: false };
}

function StopCard({
  stop,
  status,
  waiting,
  onDeliver,
  onFail,
}: {
  stop: CourierAppStopDto;
  status: StopStatus;
  waiting: boolean;
  onDeliver: () => void;
  onFail: () => void;
}) {
  const t = useTheme();
  const a = stop.address;
  const pending = status === 'PENDING';
  return (
    <Card
      label={`Entrega do pedido ${stop.orderNumber}`}
      accent={status === 'DELIVERED' ? t.success : status === 'FAILED' ? t.danger : t.info}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Body bold size="xxl">{`#${stop.orderNumber}`}</Body>
          <Body bold>{stop.customerName ?? 'Cliente'}</Body>
        </View>
        <Badge
          label={
            waiting
              ? 'Aguardando sinal'
              : pending
                ? 'A entregar'
                : status === 'DELIVERED'
                  ? 'Entregue'
                  : 'Não entregue'
          }
          tone={
            waiting ? 'warning' : pending ? 'info' : status === 'DELIVERED' ? 'success' : 'danger'
          }
        />
      </View>
      {a && (
        <View>
          <Body
            bold
            size="lg"
          >{`${a.street}, ${a.number}${a.complement ? ` — ${a.complement}` : ''}`}</Body>
          <Body muted>{`${a.neighborhood} · ${a.city}`}</Body>
          {a.reference ? <Body muted size="sm">{`Ref.: ${a.reference}`}</Body> : null}
        </View>
      )}
      {pending && stop.etaAt && (
        <Body muted bold>{`Chegada prevista por volta de ${formatTime(stop.etaAt)}`}</Body>
      )}
      {stop.notes && <Notice tone="info">{`Obs.: ${stop.notes}`}</Notice>}
      {pending && stop.pixReportedAt && stop.chargeCents > 0 && (
        <Notice tone="warning">O cliente informou que pagou por PIX: não cobre de novo.</Notice>
      )}
      {pending &&
        (stop.chargeCents > 0 ? (
          <Body size="lg">
            {`Cobrar ${formatBRL(stop.chargeCents)}`}
            {stop.expectedPaymentMethod
              ? ` · ${PAYMENT_METHOD_LABELS[stop.expectedPaymentMethod]}`
              : ''}
            {stop.changeForCents != null && stop.changeForCents > stop.chargeCents
              ? `\nTroco para ${formatBRL(stop.changeForCents)} (levar ${formatBRL(stop.changeForCents - stop.chargeCents)})`
              : ''}
          </Body>
        ) : (
          <Body bold size="lg">
            Já pago
          </Body>
        ))}
      {status === 'FAILED' && stop.failureReason && (
        <Body muted>{DELIVERY_FAILURE_LABELS[stop.failureReason]}</Body>
      )}
      {pending && (
        <View style={{ gap: space.sm }}>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Google Maps"
                variant="outline"
                onPress={() => void navigate(stop, 'google')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button label="Waze" variant="outline" onPress={() => void navigate(stop, 'waze')} />
            </View>
          </View>
          {stop.customerPhone && (
            <Button
              label={`Ligar ${formatPhone(stop.customerPhone)}`}
              variant="outline"
              onPress={() => void call(stop.customerPhone!)}
            />
          )}
          <Button label="Entregue" onPress={onDeliver} big />
          <Button label="Não entregue" variant="outline" onPress={onFail} />
        </View>
      )}
    </Card>
  );
}

/**
 * The courier's route (D050): same rules as /entregas — only the own open route, delivered with
 * how the customer paid, not delivered with a reason, the return — plus location in the
 * background during the route and an offline queue for everything.
 */
export function RouteScreen({
  onSignedOut,
  onChangeServer,
}: {
  onSignedOut: () => void;
  onChangeServer: () => void;
}) {
  const t = useTheme();
  const [route, setRoute] = useState<CourierAppDto | null>(null);
  const [queue, setQueue] = useState<QueueState>(emptyQueue());
  const [sharing, setSharing] = useState(false);
  const [notices, setNotices] = useState<NoticeState | null>(null);
  const [release, setRelease] = useState<CourierAppReleaseDto | null>(null);
  const [message, setMessage] = useState<{
    tone: 'info' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sheet, setSheet] = useState<'consent' | 'background' | 'battery' | null>(null);
  const [delivering, setDelivering] = useState<CourierAppStopDto | null>(null);
  const [failing, setFailing] = useState<CourierAppStopDto | null>(null);
  const [session, setSession] = useState<{ userName: string; storeName: string } | null>(null);
  const resumeChecked = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const outcome = await flush();
      if (outcome.refused.length) {
        setMessage({
          tone: 'danger',
          text: outcome.refused.map((r) => `${r.label}: ${r.message}`).join('\n'),
        });
      }
      setOffline(outcome.offline);
      setRoute(await fetchRoute());
      setOffline(false);
    } catch (error) {
      if (error instanceof SessionEndedError) return onSignedOut();
      if (error instanceof ApiError && error.status === 0) setOffline(true);
    } finally {
      setQueue(await readQueue());
      setSharing(await isSharing());
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    void storage.getSession().then(setSession);
    void refresh();
    void newerRelease().then(setRelease);
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, REFRESH_MS);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    // Signal back: whatever waited goes out now.
    const net = NetInfo.addEventListener((s) => {
      if (s.isConnected) void refresh();
    });
    // "Rota nova" tapped or received with the app open.
    const tapped = Notifications.addNotificationResponseReceivedListener(() => void refresh());
    const received = Notifications.addNotificationReceivedListener(() => void refresh());
    return () => {
      clearInterval(timer);
      appState.remove();
      net();
      tapped.remove();
      received.remove();
    };
  }, [refresh]);

  const run = route?.run ?? null;
  const shown = (run?.stops ?? []).map((s) => ({ stop: s, ...statusOf(s, queue) }));
  const pending = shown.filter((s) => s.status === 'PENDING').length;

  // The route ended (last stop concluded or closed at the store): sharing stops by itself.
  useEffect(() => {
    if (sharing && route && (!run || pending === 0)) {
      void stopSharing().then(() => setSharing(false));
    }
  }, [sharing, route, run, pending]);

  // The phone restarted or the system closed the app mid-route: resume what the courier started.
  useEffect(() => {
    if (resumeChecked.current || !run || pending === 0) return;
    resumeChecked.current = true;
    void (async () => {
      if (
        (await storage.getSharing()) &&
        !(await isSharing()) &&
        (await missingPermission()) === 'granted'
      ) {
        await startSharing().catch(() => undefined);
        setSharing(await isSharing());
      }
    })();
  }, [run, pending]);

  async function continueStart() {
    setStarting(true);
    try {
      let step = await missingPermission();
      if (step === 'foreground') {
        if (!(await askPermission('foreground'))) {
          setMessage({
            tone: 'warning',
            text: 'Sem a localização a loja não vê sua rota. Libere nas configurações do app.',
          });
          return;
        }
        step = await missingPermission();
      }
      if (step === 'background') {
        setSheet('background');
        return;
      }
      setNotices(await registerNotices().catch(() => 'unavailable' as const));
      await startSharing();
      setSharing(true);
      setMessage({
        tone: 'info',
        text: 'Rota iniciada: localização compartilhada até a última entrega.',
      });
      if (await batteryOptimized()) setSheet('battery');
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof Error ? error.message : 'Não foi possível iniciar',
      });
    } finally {
      setStarting(false);
    }
  }

  function startRoute() {
    if (route?.tracking?.consentVersion !== TRACKING_CONSENT_VERSION) setSheet('consent');
    else void continueStart();
  }

  async function acceptConsent() {
    setStarting(true);
    try {
      await api('/courier/tracking/consent', {
        method: 'POST',
        body: { version: TRACKING_CONSENT_VERSION },
      });
      setRoute(await fetchRoute());
      setSheet(null);
      await continueStart();
    } catch (error) {
      setMessage({
        tone: 'danger',
        text: error instanceof ApiError ? error.message : 'Sem conexão: tente de novo',
      });
    } finally {
      setStarting(false);
    }
  }

  async function act(
    kind: 'deliver' | 'fail' | 'return',
    stop: CourierAppStopDto | null,
    body: Record<string, unknown>,
    label: string,
  ) {
    await queueAction(newAction(kind, stop?.stopId ?? null, body, label));
    setQueue(await readQueue());
    await refresh();
  }

  async function backAtStore() {
    await act('return', null, {}, 'Voltei para a loja');
    await stopSharing();
    setSharing(false);
  }

  async function signOut() {
    if (queue.actions.length) {
      setMessage({
        tone: 'warning',
        text: 'Ainda há ações aguardando sinal. Saia depois que forem enviadas.',
      });
      return;
    }
    await stopSharing();
    await logout();
    onSignedOut();
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <ScrollView
        contentContainerStyle={{ padding: space.lg, paddingTop: 56, gap: space.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void refresh()} />}
      >
        <Title>Minhas entregas</Title>
        <Body muted>
          {route?.courier
            ? `${route.courier.name}${run ? ` · saiu às ${formatTime(run.departedAt)} · ${pending} a entregar` : ''}`
            : (session?.userName ?? '')}
        </Body>

        {release && (
          <Card accent={t.info} label="Versão nova">
            <Body bold>{`Versão nova do app: ${release.versionName}`}</Body>
            {release.notes ? <Body muted>{release.notes}</Body> : null}
            <Button label="Baixar e instalar" onPress={() => void downloadRelease(release)} />
          </Card>
        )}
        {offline && (
          <Notice tone="warning">
            Sem sinal. As ações ficam guardadas e são enviadas quando a conexão voltar.
          </Notice>
        )}
        {queue.actions.length > 0 && (
          <Notice tone="warning">
            {`Aguardando sinal para enviar: ${queue.actions.map((a) => a.label).join(', ')}`}
          </Notice>
        )}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}

        {route && !route.courier && (
          <Notice tone="warning">
            Seu usuário não está vinculado a um entregador. Peça ao gerente.
          </Notice>
        )}
        {route?.courier && !run && (
          <Card>
            <Body bold>Nenhuma entrega em andamento</Body>
            <Body muted>
              Quando a loja registrar sua saída, as entregas aparecem aqui e o celular avisa.
            </Body>
            {notices !== 'on' && (
              <Button
                label="Ativar avisos de rota nova"
                variant="outline"
                onPress={() => void registerNotices().then(setNotices)}
              />
            )}
          </Card>
        )}

        {run && (
          <Card accent={sharing ? t.success : t.warning} label="Localização">
            <Body bold>
              {sharing
                ? `Compartilhando localização com ${route?.tracking?.storeName ?? 'a loja'}`
                : `Rota com ${pending} ${pending === 1 ? 'entrega' : 'entregas'}`}
            </Body>
            <Body muted>
              {sharing
                ? 'Funciona com a tela apagada e com o Waze ou o Maps abertos. Para sozinho depois da última entrega.'
                : 'Toque para iniciar: a loja vê sua posição e a chegada prevista de cada entrega.'}
            </Body>
            {sharing ? (
              <View style={{ gap: space.sm }}>
                <Button
                  label="Celular fechando o app? Ver economia de bateria"
                  variant="ghost"
                  onPress={() => setSheet('battery')}
                />
                <Button
                  label="Encerrar rota (parar localização)"
                  variant="outline"
                  onPress={() => void stopSharing().then(() => setSharing(false))}
                />
              </View>
            ) : (
              pending > 0 && (
                <Button label="Iniciar rota" busy={starting} onPress={startRoute} big />
              )
            )}
            {notices === 'denied' && (
              <Notice tone="warning">
                Os avisos estão bloqueados nas configurações do celular.
              </Notice>
            )}
            {notices === 'unavailable' && (
              <Notice tone="info">
                Esta versão do app não recebe avisos; a rota se atualiza sozinha.
              </Notice>
            )}
          </Card>
        )}

        {shown
          .slice()
          .sort((a, b) => Number(a.status !== 'PENDING') - Number(b.status !== 'PENDING'))
          .map(({ stop, status, waiting }) => (
            <StopCard
              key={stop.stopId}
              stop={stop}
              status={status}
              waiting={waiting}
              onDeliver={() =>
                stop.chargeCents > 0
                  ? setDelivering(stop)
                  : void act('deliver', stop, { collection: null }, `Entregue #${stop.orderNumber}`)
              }
              onFail={() => setFailing(stop)}
            />
          ))}

        {run && (
          <Button
            label="Voltei para a loja"
            variant={pending ? 'outline' : 'primary'}
            disabled={pending > 0}
            onPress={() => void backAtStore()}
            big
          />
        )}
        {run && pending > 0 && (
          <Body muted size="sm">
            Marque todas as entregas para registrar a volta.
          </Body>
        )}

        <View style={{ gap: space.sm, marginTop: space.xl }}>
          <Body muted size="sm">
            {`${session?.userName ?? ''} · ${session?.storeName ?? ''} · versão ${installedVersion()}`}
          </Body>
          {route?.tracking && (
            <Body
              muted
              size="sm"
            >{`${route.tracking.storedPositions} posições guardadas das suas rotas (apagadas em 7 dias).`}</Body>
          )}
          <Button label="Sair" variant="ghost" onPress={() => void signOut()} />
          <Button label="Trocar servidor" variant="ghost" onPress={onChangeServer} />
        </View>
      </ScrollView>

      <ConsentSheet
        visible={sheet === 'consent'}
        storeName={route?.tracking?.storeName ?? session?.storeName ?? 'a loja'}
        busy={starting}
        onAccept={() => void acceptConsent()}
        onClose={() => setSheet(null)}
      />
      <BackgroundPermissionSheet
        visible={sheet === 'background'}
        onClose={() => setSheet(null)}
        onContinue={() => {
          setSheet(null);
          void askPermission('background').then((granted) =>
            granted
              ? continueStart()
              : setMessage({
                  tone: 'warning',
                  text: 'Sem "Permitir o tempo todo" a localização para quando a tela apaga ou o Waze abre.',
                }),
          );
        }}
      />
      <BatterySheet
        visible={sheet === 'battery'}
        appName={APP_NAME}
        onClose={() => setSheet(null)}
      />
      <CollectionSheet
        stop={delivering}
        onClose={() => setDelivering(null)}
        onConfirm={(collection: Collection) => {
          const stop = delivering!;
          setDelivering(null);
          void act('deliver', stop, { collection }, `Entregue #${stop.orderNumber}`);
        }}
      />
      <FailureSheet
        stop={failing}
        onClose={() => setFailing(null)}
        onConfirm={(input) => {
          const stop = failing!;
          setFailing(null);
          void act('fail', stop, input, `Não entregue #${stop.orderNumber}`);
        }}
      />
    </View>
  );
}
