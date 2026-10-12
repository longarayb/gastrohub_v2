/** pt-BR labels of the platform audit actions (apps/api PlatformAuditAction). */
const LABELS: Record<string, string> = {
  'auth.password_failed': 'Senha errada no login',
  'auth.locked': 'Acesso bloqueado por tentativas',
  'auth.totp_failed': 'Código de verificação errado',
  'auth.login': 'Login',
  'auth.recovery_code_used': 'Login com código de recuperação',
  'auth.logout': 'Saída',
  'auth.totp_enrolled': 'Verificação em duas etapas ativada',
  'auth.totp_reset_emergency': '2FA redefinido no servidor (emergência)',
  'auth.recovery_codes_regenerated': 'Novos códigos de recuperação',
  'auth.password_changed': 'Senha alterada',
  'admin.created': 'Administrador criado',
  'customer.created': 'Cliente cadastrado',
  'customer.updated': 'Dados do cliente alterados',
  'customer.disabled': 'Cliente desativado',
  'customer.enabled': 'Cliente reativado',
  'customer.invite_sent': 'Convite enviado',
  'plan.created': 'Plano criado',
  'plan.updated': 'Plano alterado',
  'subscription.created': 'Assinatura criada',
  'subscription.plan_changed': 'Troca de plano',
  'subscription.price_changed': 'Preço alterado',
  'subscription.trial_changed': 'Período de teste alterado',
  'subscription.grace_changed': 'Tolerância alterada',
  'subscription.suspended': 'Assinatura suspensa',
  'subscription.reactivated': 'Assinatura reativada',
  'subscription.canceled': 'Assinatura cancelada',
  'invoice.generated': 'Mensalidade gerada',
  'invoice.paid': 'Pagamento registrado',
  'invoice.canceled': 'Mensalidade cancelada',
  'settings.updated': 'Configurações alteradas',
  'support.started': 'Acesso de suporte iniciado',
  'support.ended': 'Acesso de suporte encerrado',
};

export const actionLabel = (action: string): string => LABELS[action] ?? action;

/** Filters of the audit screen (action prefixes). */
export const AUDIT_FILTERS = [
  { value: '', label: 'Tudo' },
  { value: 'auth.', label: 'Acessos' },
  { value: 'customer.', label: 'Clientes' },
  { value: 'subscription.', label: 'Assinaturas' },
  { value: 'invoice.', label: 'Mensalidades' },
  { value: 'support.', label: 'Suporte' },
  { value: 'plan.', label: 'Planos' },
  { value: 'settings.', label: 'Configurações' },
] as const;
