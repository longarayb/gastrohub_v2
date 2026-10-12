import { BRAND } from '../brand.js';
import { PLATFORM_PRIVACY_VERSION, PLATFORM_TERMS_VERSION } from '../domain/platform.js';

/**
 * Platform terms of use and privacy policy accepted by the restaurant owner (D043).
 * MODEL TEXTS: they must be reviewed by a lawyer before any real customer uses the platform.
 * Changing a text = bumping its version in domain/platform.ts (owners accept again).
 */
export const LEGAL_REVIEW_NOTICE =
  'Modelo de texto — revisar com apoio jurídico antes do uso com clientes reais.';

export interface LegalDocument {
  version: string;
  title: string;
  /** Paragraphs; a line starting with "## " is a section title. */
  body: string[];
}

export const PLATFORM_TERMS: LegalDocument = {
  version: PLATFORM_TERMS_VERSION,
  title: 'Termos de uso da plataforma',
  body: [
    `Estes termos regulam o uso do sistema ${BRAND.name} (a "plataforma") pelo restaurante contratante (o "cliente"), representado pelo seu responsável legal.`,
    '## 1. Objeto',
    'A plataforma oferece ferramentas de gestão para food service: cardápio, pedidos, salão, caixa, cozinha, entregas, impressão e relatórios, conforme o plano contratado.',
    '## 2. Cadastro e acesso',
    'O cliente é responsável pela veracidade dos dados informados, pela guarda das senhas dos seus usuários e por todas as operações feitas com elas. Os acessos devem ser pessoais.',
    '## 3. Planos, mensalidades e inadimplência',
    'O uso é cobrado conforme o plano contratado e a periodicidade escolhida. Em caso de atraso, o cliente é avisado no painel; terminado o prazo de tolerância, a conta passa a modo somente leitura (consultas e relatórios continuam disponíveis, novas vendas não), sempre fora do horário de funcionamento, e volta ao normal assim que o pagamento é registrado.',
    '## 4. Suporte',
    'Para prestar suporte, a equipe da plataforma pode acessar a conta do cliente por tempo limitado, com motivo registrado e aviso visível no painel. Todos os acessos ficam na auditoria.',
    '## 5. Dados',
    'Os dados cadastrados pelo cliente pertencem a ele. A plataforma os trata conforme a Política de Privacidade e a legislação aplicável (LGPD). O cliente é o controlador dos dados pessoais dos seus consumidores; a plataforma atua como operadora.',
    '## 6. Disponibilidade',
    'A plataforma busca funcionar de forma contínua, mas pode passar por manutenções e interrupções. Recursos que dependem de terceiros (internet, impressoras, marketplaces, serviços de pagamento) podem ficar indisponíveis por motivos alheios à plataforma.',
    '## 7. Encerramento',
    'O cliente pode cancelar a qualquer momento. Após o cancelamento, os dados ficam disponíveis para consulta e exportação por um prazo definido e depois são excluídos ou anonimizados, salvo o que a lei obrigar a guardar.',
    '## 8. Alterações',
    'Estes termos podem ser atualizados. Quando isso acontecer, o responsável pela conta será solicitado a aceitar a nova versão no próximo acesso.',
  ],
};

export const PLATFORM_PRIVACY: LegalDocument = {
  version: PLATFORM_PRIVACY_VERSION,
  title: 'Política de privacidade da plataforma',
  body: [
    `Esta política explica como a plataforma ${BRAND.name} trata os dados pessoais dos usuários dos restaurantes clientes e, em nome deles, dos seus consumidores.`,
    '## 1. Dados tratados',
    'Dados de cadastro do cliente e dos usuários (nome, e-mail, telefone, CPF/CNPJ), registros de acesso (data, hora e IP) e os dados de operação inseridos pelo restaurante (pedidos, clientes finais, endereços de entrega).',
    '## 2. Finalidades',
    'Prestar o serviço contratado, cobrar as mensalidades, emitir notas fiscais, dar suporte, garantir a segurança (auditoria e prevenção de fraudes) e cumprir obrigações legais.',
    '## 3. Compartilhamento',
    'Somente com prestadores necessários ao serviço (hospedagem, envio de e-mails, cobrança, geocodificação de endereços) e com autoridades quando a lei exigir.',
    '## 4. Retenção',
    'Os dados são mantidos enquanto durar o contrato e, depois, pelo prazo necessário para exportação pelo cliente e para cumprir obrigações legais (por exemplo, fiscais).',
    '## 5. Direitos dos titulares',
    'Os titulares podem pedir acesso, correção, portabilidade e exclusão dos seus dados. Pedidos de consumidores dos restaurantes são encaminhados ao restaurante, que é o controlador.',
    '## 6. Segurança',
    'Senhas guardadas de forma irreversível, acesso administrativo com verificação em duas etapas, isolamento entre restaurantes e registro de auditoria das ações sensíveis.',
    '## 7. Contato',
    'Dúvidas e pedidos sobre dados pessoais podem ser enviados ao canal de atendimento indicado no painel.',
  ],
};
