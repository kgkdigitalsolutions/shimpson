/**
 * Simpson Burguer - Leitor Automático de Pix via E-mail do Nubank
 * 
 * Conecta-se com segurança ao Gmail via IMAP com suporte híbrido:
 * 1. Push em tempo real (IMAP IDLE e evento 'exists')
 * 2. Checagem periódica a cada 5 segundos para máxima tolerância a falhas
 * 
 * Como rodar:
 *   npm run pix:listener
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

// Polyfill de compatibilidade para Node.js v18 e anteriores
if (!globalThis.crypto) {
  globalThis.crypto = crypto.webcrypto || {};
}
if (!globalThis.crypto.getRandomValues) {
  globalThis.crypto.getRandomValues = (arr) => crypto.randomFillSync(arr);
}

import 'dotenv/config';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jmycqwnuznwculqbgavy.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_MO2glC7v9Y16OMbO6mZT9Q_VTHeS3Q_";

const PROCESSED_FILE = path.resolve('.pix-processed-uids.json');

// Carrega histórico de e-mails já processados para nunca duplicar
let processedUids = new Set();
try {
  if (fs.existsSync(PROCESSED_FILE)) {
    const raw = fs.readFileSync(PROCESSED_FILE, 'utf-8');
    const list = JSON.parse(raw);
    if (Array.isArray(list)) {
      processedUids = new Set(list.map(String));
    }
  }
} catch (e) {
  processedUids = new Set();
}

// Histórico de tentativas por UID para evitar loop infinito em e-mails que não correspondem a pedidos
const retryCountByUid = new Map();
const MAX_RETRIES = 24; // 24 checagens x 5s = 2 minutos de tentativas antes de arquivar

function salvarUidsProcessados() {
  try {
    fs.writeFileSync(PROCESSED_FILE, JSON.stringify(Array.from(processedUids), null, 2), 'utf-8');
  } catch (e) {
    console.error("Erro ao salvar histórico de UIDs:", e.message);
  }
}

/**
 * Formata hora atual no formato HH:MM:SS
 */
function agora() {
  return new Date().toLocaleTimeString('pt-BR', { hour12: false });
}

/**
 * Extrai dados do e-mail do Nubank se for um Pix RECEBIDO
 */
export function extrairDadosEmailNubank(texto, assunto = "") {
  if (!texto) return null;

  const subject = String(assunto || "").trim();
  const body = String(texto || "");

  // 1. Blacklist expressa de assuntos do Nubank que NÃO são Pix recebido
  // Impede que acordos, parcelas, faturas, empréstimos ou comprovantes de envio sejam confundidos com Pix recebido
  const assuntoBlacklist = /(parcela|acordo|fatura|vencimento|vence|boleto|empr[eé]stimo|seguro|limite|cart[aã]o|bloqueio|investimento|novidade|comprovante|voc[eê] fez|voc[eê] enviou|transfer[eê]ncia enviada)/i;
  if (assuntoBlacklist.test(subject)) {
    return null;
  }

  // 2. O e-mail DEVE ser de recebimento de Pix
  const ehAssuntoPixRecebido = /transfer[eê]ncia via Pix/i.test(subject) ||
                              /Recebemos sua transfer[eê]ncia/i.test(subject) ||
                              /recebeu (uma transfer[eê]ncia|um Pix)/i.test(subject) ||
                              /Pix recebido/i.test(subject) ||
                              /chegou/i.test(subject);

  const ehCorpoPixRecebido = /Valor\s+recebido:?/i.test(body) ||
                             /recebemos sua transfer[eê]ncia/i.test(body) ||
                             /o valor j[aá] est[aá] dispon[ií]vel na sua conta/i.test(body) ||
                             /voc[eê] recebeu um Pix/i.test(body) ||
                             /transfer[eê]ncia recebida pelo Pix/i.test(body);

  if (!ehAssuntoPixRecebido && !ehCorpoPixRecebido) {
    return null;
  }

  // 3. Extração estrita do Valor Recebido:
  // No e-mail legítimo do Nubank, o valor vem associado a "Valor recebido:", "de R$ ..." ou "no valor de R$"
  const matchValor = body.match(/Valor\s+recebido:?[\s\r\n]*R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i)
                  || body.match(/(?:recebeu|transfer[eê]ncia)[^\n\r]{0,60}R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i)
                  || body.match(/Pix\s+(?:no valor\s+de\s+|de\s+)R\$\s*([0-9]{1,3}(?:\.[0-9]{3})*,[0-9]{2})/i);

  if (!matchValor) return null;

  const valorLimpo = matchValor[1].replace(/\./g, "").replace(",", ".");
  const valor = parseFloat(valorLimpo);
  if (isNaN(valor) || valor <= 0) return null;

  // 4. Extração de Data/Hora (ex: "10 NOV às 17:32")
  const matchData = body.match(/(\d{1,2}\s+(?:JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)(?:\s+às\s+\d{2}:\d{2})?)/i);
  const dataHora = matchData ? matchData[1].trim() : null;

  // 5. Extração de Remetente (quando disponível no texto ex: "transferência de Fulano")
  const matchPagador = body.match(/(?:enviad[ao] por|\bde)\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)(?:\s+no valor|\s+via Pix|[.,\n\r]|$)/i);
  const pagador = matchPagador ? matchPagador[1].trim() : null;

  return {
    valor,
    dataHora,
    pagador,
    valido: true
  };
}

/**
 * Busca pedido no Supabase pelo valor exato e aprova
 * Filtra apenas pedidos recentes (últimos 30 minutos) e prioriza o mais recente (DESC)
 */
export async function aprovarPedidoPorValor(valorPix, infoPagador = null) {
  try {
    console.log(`\n[${agora()}] 🔍 [PIX SEARCH] Buscando pedido pendente com valor de R$ ${valorPix.toFixed(2)}...`);

    // Janela de validade: apenas pedidos criados nos últimos 30 minutos
    // Isso impede que pedidos antigos/abandonados de horas atrás 'roubem' o Pix de um novo cliente!
    const limite30Min = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const queryUrl = `${SUPABASE_URL}/rest/v1/orders?status=eq.0&payment=eq.pix&created_at=gte.${limite30Min}&order=created_at.desc&limit=20`;
    
    const res = await fetch(queryUrl, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!res.ok) {
      throw new Error(`Erro ao consultar Supabase: ${await res.text()}`);
    }

    const pedidosPendentes = await res.json();

    if (!pedidosPendentes || pedidosPendentes.length === 0) {
      console.log(`[${agora()}] ⚠️  [PIX SEARCH] Nenhum pedido recente (últimos 30 min) com status "Aguardando pagamento" foi encontrado.`);
      return null;
    }

    // Filtra todos os pedidos com esse mesmo valor exato (tolerância de R$ 0,009)
    const pedidosComMesmoValor = pedidosPendentes.filter(p => Math.abs(Number(p.total) - valorPix) < 0.01);

    if (pedidosComMesmoValor.length === 0) {
      console.log(`[${agora()}] ⚠️  [PIX SEARCH] Nenhum pedido recente com o total de R$ ${valorPix.toFixed(2)}.`);
      console.log(`   Pedidos recentes em aberto:`, pedidosPendentes.map(p => `#${p.id} (R$ ${Number(p.total).toFixed(2)})`).join(", "));
      return null;
    }

    // Se houver mais de um e tivermos o nome do pagador no e-mail, tenta casar com o cliente
    let pedidoCorrespondente = pedidosComMesmoValor[0]; // Mais recente por padrão (DESC)
    if (pedidosComMesmoValor.length > 1 && infoPagador) {
      const matchNome = pedidosComMesmoValor.find(p => 
        p.customer_name && infoPagador.toLowerCase().includes(p.customer_name.toLowerCase())
      );
      if (matchNome) {
        pedidoCorrespondente = matchNome;
      }
    }

    // Atualiza o status do pedido para 1 ("Pagamento aprovado")
    const updateUrl = `${SUPABASE_URL}/rest/v1/orders?id=eq.${pedidoCorrespondente.id}`;
    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        status: 1
      })
    });

    if (!updateRes.ok) {
      throw new Error(`Falha ao aprovar pedido no Supabase: ${await updateRes.text()}`);
    }

    console.log(`\n======================================================`);
    console.log(`🎉 [${agora()}] [PIX APROVADO COM SUCESSO!]`);
    console.log(`   Pedido: #${pedidoCorrespondente.id}`);
    console.log(`   Cliente: ${pedidoCorrespondente.customer_name}`);
    console.log(`   Valor: R$ ${Number(pedidoCorrespondente.total).toFixed(2)}`);
    console.log(`   Status: 1 (Pagamento confirmado)`);
    console.log(`   O cliente e o painel Admin foram notificados em tempo real!`);
    console.log(`======================================================\n`);

    return pedidoCorrespondente;
  } catch (err) {
    console.error(`[${agora()}] ❌ [PIX ERROR] Erro ao aprovar pedido:`, err.message);
    return null;
  }
}

let checagemEmAndamento = false;

/**
 * Verifica novos e-mails do Nubank e processa
 */
async function verificarNovosPix(client, origem = "rotina") {
  if (checagemEmAndamento || !client.usable) return;
  checagemEmAndamento = true;

  let lock = null;
  try {
    lock = await client.getMailboxLock('INBOX');

    // Sincroniza a caixa com o servidor Gmail (NOOP força o Gmail a enviar e-mails recém-chegados)
    await client.noop();

    // Busca e-mails do Nubank recebidos nas últimas 24 horas
    const sinceDate = new Date(Date.now() - 24 * 3600 * 1000);
    const uids = await client.search({ from: 'nubank', since: sinceDate }, { uid: true });

    if (!uids || uids.length === 0) {
      return;
    }

    // Filtra apenas UIDs que ainda não foram processados
    const uidsPendentes = uids.filter(uid => !processedUids.has(String(uid)));

    if (uidsPendentes.length > 0) {
      console.log(`\n[${agora()}] 📬 [RECEBIDO: ${origem}] Encontrados ${uidsPendentes.length} novo(s) e-mail(s) do Nubank.`);

      for (const uid of uidsPendentes) {
        try {
          const uidStr = String(uid);
          const raw = await client.download(uidStr, undefined, { uid: true });
          if (!raw || !raw.content) continue;

          const parsed = await simpleParser(raw.content);
          const subject = parsed.subject || "";
          const bodyText = parsed.text || parsed.html || "";

          console.log(`[${agora()}] 📩 Analisando: "${subject}" (Data: ${parsed.date ? parsed.date.toLocaleTimeString('pt-BR') : 'recente'})`);

          const dados = extrairDadosEmailNubank(bodyText, subject);

          if (dados && dados.valido) {
            console.log(`[${agora()}] 💰 [PIX DETECTADO] R$ ${dados.valor.toFixed(2)}${dados.dataHora ? ` (${dados.dataHora})` : ""}`);

            // Se o e-mail for mais antigo que 30 minutos, descarta pois o Supabase só busca pedidos recentes
            const emailAgeMin = parsed.date ? (Date.now() - parsed.date.getTime()) / (60 * 1000) : 0;
            if (emailAgeMin > 30) {
              console.log(`[${agora()}] ℹ️  [PIX EXPIRADO] E-mail recebido há mais de 30 min (${Math.round(emailAgeMin)} min atrás). Ignorando.`);
              processedUids.add(uidStr);
              salvarUidsProcessados();
              continue;
            }

            const aprovado = await aprovarPedidoPorValor(dados.valor, dados.pagador);
            
            if (aprovado) {
              processedUids.add(uidStr);
              salvarUidsProcessados();
              retryCountByUid.delete(uidStr);
              await client.messageFlagsAdd({ uid: uidStr }, ['\\Seen'], { uid: true });
            } else {
              const attempts = (retryCountByUid.get(uidStr) || 0) + 1;
              retryCountByUid.set(uidStr, attempts);

              if (attempts >= MAX_RETRIES) {
                console.log(`[${agora()}] ℹ️  [PIX SEM PEDIDO] E-mail de R$ ${dados.valor.toFixed(2)} atingiu o limite de ${MAX_RETRIES} tentativas sem encontrar pedido. Finalizando checagem.`);
                processedUids.add(uidStr);
                salvarUidsProcessados();
                retryCountByUid.delete(uidStr);
              } else {
                console.log(`[${agora()}] ⏳ E-mail mantido na fila para tentar novamente (tentativa ${attempts}/${MAX_RETRIES}).`);
              }
            }
          } else {
            // E-mail informativo, fatura, acordo ou marketing do Nubank, marca como processado para não reler
            processedUids.add(uidStr);
            salvarUidsProcessados();
          }
        } catch (msgErr) {
          console.error(`[${agora()}] ✕ Erro ao processar UID ${uid}:`, msgErr.message);
        }
      }
    }
  } catch (err) {
    console.error(`[${agora()}] ⚠️ Erro ao verificar caixa de entrada:`, err.message);
  } finally {
    if (lock) {
      try {
        lock.release();
      } catch (e) {}
    }
    checagemEmAndamento = false;
  }
}

/**
 * Inicia o cliente IMAP com Gmail
 */
export async function iniciarLeitorEmail() {
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    console.error("\n======================================================");
    console.error("❌ ERRO DE CONFIGURAÇÃO: GMAIL_USER ou GMAIL_APP_PASSWORD ausentes!");
    console.error("   Crie um arquivo .env na raiz do projeto com:");
    console.error("   GMAIL_USER=seu-email@gmail.com");
    console.error("   GMAIL_APP_PASSWORD=abcd efgh ijkl mnop");
    console.error("======================================================\n");
    process.exit(1);
  }

  // Se estiver em ambiente de nuvem (Render, Railway, Fly.io) que fornece PORT,
  // inicia um servidor HTTP simples para healthcheck e manter o serviço acordado
  const PORT = process.env.PORT;
  if (PORT) {
    http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        service: 'Simpson Burguer Pix Listener',
        time: new Date().toISOString()
      }));
    }).listen(PORT, () => {
      console.log(`✓ [Healthcheck] Servidor HTTP ativo na porta ${PORT} para manter o serviço no ar.`);
    });
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD.replace(/\s+/g, '')
    },
    logger: false
  });

  client.on('error', err => {
    console.error(`[${agora()}] ⚠️ [IMAP ERROR]`, err.message);
  });

  client.on('close', () => {
    console.log(`[${agora()}] 🔄 [IMAP CONEXÃO ENCERRADA] Reconectando em 5 segundos...`);
    setTimeout(iniciarLeitorEmail, 5000);
  });

  try {
    console.log(`\n⏳ Conectando ao Gmail (${GMAIL_USER})...`);
    await client.connect();
    console.log(`✓ Conectado ao Gmail com sucesso!`);

    console.log(`\n======================================================`);
    console.log(`  🍔 SIMPSON BURGUER - ROBÔ PIX NUBANK ATIVO`);
    console.log(`  Conta: ${GMAIL_USER}`);
    console.log(`  Origem: Nubank <todomundo@nubank.com.br>`);
    console.log(`  Modo: Push em tempo real (IMAP IDLE) + Polling (5s)`);
    console.log(`  Janela: Pedidos recentes (últimos 30 min)`);
    console.log(`======================================================\n`);

    // 1. Checagem inicial na inicialização
    await verificarNovosPix(client, "inicialização");

    console.log(`[${agora()}] 🟢 Robô em escuta contínua. Faça um Pix de teste que o pedido aprovará na hora!\n`);

    // 2. Escuta notificações em tempo real enviadas pelo Gmail
    client.on('exists', (data) => {
      console.log(`[${agora()}] ⚡ Notificação push do Gmail recebida! Verificando...`);
      verificarNovosPix(client, "Push em tempo real");
    });

    // 3. Checagem periódica a cada 5 segundos como garantia de contingência
    setInterval(() => {
      verificarNovosPix(client, "polling 5s");
    }, 5000);

    // 4. Batimento cardíaco a cada 60 segundos para confirmação visual no terminal
    setInterval(() => {
      if (client.usable) {
        console.log(`[${agora()}] 🟢 Robô ativo | Monitorando e-mails do Nubank...`);
      }
    }, 60000);

  } catch (err) {
    console.error(`[${agora()}] ❌ Falha na conexão IMAP:`, err.message);
    console.log('   Dica: Certifique-se de que a "Senha de App" de 16 letras foi gerada no Google.');
    setTimeout(iniciarLeitorEmail, 10000);
  }
}

// Executa diretamente caso chamado via terminal
if (process.argv[1] && process.argv[1].endsWith('pix-email-listener.js')) {
  if (process.argv.includes('--test')) {
    console.log("--- Executando teste do parser ---");
    const exemploTexto = `
Recebemos sua transferência via Pix
Inbox
Nubank <todomundo@nubank.com.br>
Sua transferência via Pix já chegou.
Olá, Gustavo.
Recebemos sua transferência via Pix e o valor já está disponível na sua conta do Nubank.
	
Valor recebido:
R$ 0,01
10 NOV às 17:32
`;
    const resultado = extrairDadosEmailNubank(exemploTexto, "Recebemos sua transferência via Pix");
    console.log("Resultado do parser:", resultado);
  } else {
    iniciarLeitorEmail();
  }
}
