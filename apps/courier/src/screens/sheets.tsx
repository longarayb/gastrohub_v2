import {
  type CourierAppStopDto,
  DELIVERY_FAILURE_LABELS,
  DELIVERY_FAILURE_REASONS,
  type DeliveryFailureReason,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  TRACKING_CONSENT_TEXT,
  TRACKING_CONSENT_VERSION,
  formatBRL,
  formatDecimalBRL,
  parseBRL,
} from '@app/shared';
import * as Device from 'expo-device';
import { useState } from 'react';
import { View } from 'react-native';
import { batteryGuide } from '../lib/battery-guide';
import { askBatteryExemption, openAppSettings } from '../lib/device';
import { Body, Button, Card, Field, Notice, Sheet } from '../ui/components';
import { space } from '../ui/theme';

/** What the courier reads and accepts before the first position (LGPD, same text as /entregas). */
export function ConsentSheet({
  visible,
  storeName,
  busy,
  onAccept,
  onClose,
}: {
  visible: boolean;
  storeName: string;
  busy: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      visible={visible}
      title={`Compartilhar sua localização com ${storeName}`}
      onClose={onClose}
    >
      <Body muted>{`Leia antes de aceitar (versão ${TRACKING_CONSENT_VERSION}).`}</Body>
      {TRACKING_CONSENT_TEXT.map((line) => (
        <Body key={line}>{`• ${line}`}</Body>
      ))}
      <Body>
        • No celular, aparece a notificação fixa &quot;Compartilhando localização&quot; enquanto a
        rota estiver aberta, inclusive com a tela apagada ou com o Waze e o Maps na frente.
      </Body>
      <Button label="Concordo e iniciar a rota" busy={busy} onPress={onAccept} big />
      <Button label="Agora não" variant="outline" onPress={onClose} />
    </Sheet>
  );
}

/** Android 11+ only grants "o tempo todo" on the settings page: explained first. */
export function BackgroundPermissionSheet({
  visible,
  onContinue,
  onClose,
}: {
  visible: boolean;
  onContinue: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet visible={visible} title="Localização com a tela apagada" onClose={onClose}>
      <Body>
        Para a loja ver a rota com o celular no bolso ou com o Waze aberto, o app precisa da
        localização &quot;o tempo todo&quot;. Só é usada durante a rota.
      </Body>
      <Body>
        Na próxima tela, toque em <Body bold>Permitir o tempo todo</Body> e volte para o app.
      </Body>
      <Button label="Abrir a permissão" onPress={onContinue} big />
      <Button label="Agora não" variant="outline" onPress={onClose} />
    </Sheet>
  );
}

/** Battery saving: Android's own dialog, then the steps of the phone's brand. */
export function BatterySheet({
  visible,
  appName,
  onClose,
}: {
  visible: boolean;
  appName: string;
  onClose: () => void;
}) {
  const guide = batteryGuide(Device.manufacturer, appName);
  return (
    <Sheet visible={visible} title="Não deixe o celular fechar o app" onClose={onClose}>
      <Notice tone="warning">
        A economia de bateria do celular pode fechar o app no meio da rota, e a loja deixa de ver
        você. Libere o app uma vez:
      </Notice>
      <Button
        label="1. Permitir em segundo plano"
        onPress={() => void askBatteryExemption().catch(() => openAppSettings())}
        big
      />
      <Card label={`Passos para ${guide.title}`}>
        <Body bold>{`2. No seu celular (${guide.title})`}</Body>
        {guide.steps.map((step, i) => (
          <Body key={step}>{`${i + 1}) ${step}`}</Body>
        ))}
        <Button
          label="Abrir as configurações do app"
          variant="outline"
          onPress={() => void openAppSettings()}
        />
      </Card>
      <Button label="Pronto" onPress={onClose} />
    </Sheet>
  );
}

const DOOR_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'MEAL_VOUCHER'];

export interface Collection {
  method: PaymentMethod;
  amountCents: number;
  receivedCents: number | null;
  note: null;
}

/** "Entregue" with how the customer paid (same rules as /entregas). */
export function CollectionSheet({
  stop,
  onConfirm,
  onClose,
}: {
  stop: CourierAppStopDto | null;
  onConfirm: (collection: Collection) => void;
  onClose: () => void;
}) {
  const charge = stop?.chargeCents ?? 0;
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [received, setReceived] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  if (stop && shown !== stop.stopId) {
    setShown(stop.stopId);
    setMethod(
      stop.expectedPaymentMethod && DOOR_METHODS.includes(stop.expectedPaymentMethod)
        ? stop.expectedPaymentMethod
        : null,
    );
    setReceived(stop.changeForCents ? formatDecimalBRL(stop.changeForCents) : '');
    setError(null);
  }
  const receivedCents = parseBRL(received);
  const cash = method === 'CASH';

  function confirm() {
    if (!method) return setError('Escolha como o cliente pagou');
    if (cash && receivedCents != null && receivedCents < charge) {
      return setError('O valor recebido é menor que o cobrado');
    }
    onConfirm({
      method,
      amountCents: charge,
      receivedCents: cash ? (receivedCents ?? charge) : null,
      note: null,
    });
  }

  return (
    <Sheet visible={!!stop} title={`Entregue · #${stop?.orderNumber ?? ''}`} onClose={onClose}>
      <Body size="lg">{`A cobrar: ${formatBRL(charge)}`}</Body>
      {stop?.pixReportedAt && (
        <Notice tone="warning">O cliente informou que pagou por PIX: não cobre de novo.</Notice>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {DOOR_METHODS.map((m) => (
          <View key={m} style={{ width: '48%' }}>
            <Button
              label={PAYMENT_METHOD_LABELS[m]}
              variant={method === m ? 'primary' : 'outline'}
              onPress={() => {
                setMethod(m);
                setError(null);
              }}
            />
          </View>
        ))}
      </View>
      {cash && (
        <Field
          label="Recebido em dinheiro"
          value={received}
          onChangeText={setReceived}
          keyboardType="decimal-pad"
          placeholder={formatDecimalBRL(charge)}
        />
      )}
      {cash && receivedCents != null && receivedCents > charge && (
        <Body bold size="lg">{`Troco: ${formatBRL(receivedCents - charge)}`}</Body>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      <Button label="Confirmar entrega" onPress={confirm} big />
      <Button label="Voltar" variant="outline" onPress={onClose} />
    </Sheet>
  );
}

/** "Não entregue" with the reason (the order goes back to the store). */
export function FailureSheet({
  stop,
  onConfirm,
  onClose,
}: {
  stop: CourierAppStopDto | null;
  onConfirm: (input: { reason: DeliveryFailureReason; note: string | null }) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<DeliveryFailureReason | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    if (!reason) return setError('Escolha o motivo');
    if (reason === 'OTHER' && !note.trim()) return setError('Descreva o motivo');
    onConfirm({ reason, note: note.trim() || null });
    setReason(null);
    setNote('');
  }

  return (
    <Sheet visible={!!stop} title={`Não entregue · #${stop?.orderNumber ?? ''}`} onClose={onClose}>
      {DELIVERY_FAILURE_REASONS.map((r) => (
        <Button
          key={r}
          label={DELIVERY_FAILURE_LABELS[r]}
          variant={reason === r ? 'primary' : 'outline'}
          onPress={() => {
            setReason(r);
            setError(null);
          }}
        />
      ))}
      <Field label="Observação" value={note} onChangeText={setNote} maxLength={200} />
      {error && <Notice tone="danger">{error}</Notice>}
      <Button label="Registrar" variant="danger" onPress={confirm} big />
      <Button label="Voltar" variant="outline" onPress={onClose} />
    </Sheet>
  );
}
