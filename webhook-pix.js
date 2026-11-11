/**
 * Simpson Burguer - Servidor de Webhook para Confirmação Automática de Pix
 * 
 * Este servidor recebe notificações de pagamento (webhooks) de gateways/bancos
 * (como Mercado Pago, EFI/Gerencianet, Asaas, Woovi/OpenPix ou webhook bancário próprio)
 * e atualiza o status do pedido no Supabase para 1 ("Pagamento aprovado").
 * 
 * Como o frontend já usa Supabase Realtime, a tela do cliente e o painel de pedidos
 * serão atualizados automaticamente em tempo real assim que o webhook disparar!
 * 
 * Como rodar:
 *   node webhook-pix.js
 * 
 * Porta padrão: 3000 (ou a definida na variável de ambiente PORT)
 */

import http from 'http';

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jmycqwnuznwculqbgavy.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_KEY || "sb_publishable_MO2glC7v9Y16OMbO6mZT9Q_VTHeS3Q_";
const PORT = process.env.PORT || 3000;

/**
 * Atualiza o status do pedido para 1 ("Pagamento aprovado") no Supabase
 */
export async function aprovarPedidoPix(orderId) {
  try {
    const url = `${SUPABASE_URL}/rest/v1/orders?id=eq.${orderId}`;
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        status: 1 // 1 = "Pagamento aprovado"
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Falha ao atualizar pedido #${orderId} no Supabase: ${err}`);
    }

    const data = await response.json();
    console.log(`[PIX WEBHOOK] ✓ Pedido #${orderId} aprovado com sucesso no Supabase!`);
    return data;
  } catch (error) {
    console.error(`[PIX WEBHOOK] ✕ Erro ao aprovar pedido #${orderId}:`, error.message);
    throw error;
  }
}

/**
 * Extrai o ID do pedido a partir de diferentes formatos de webhook bancário
 */
export function extrairOrderId(body) {
  if (!body) return null;

  // 1. Formato direto: { "order_id": 123 } ou { "id": 123 }
  if (body.order_id) return Number(body.order_id);

  // 2. Formato por txid: "SIMP123" ou "123"
  if (body.txid) {
    const num = String(body.txid).replace(/\D/g, '');
    if (num) return Number(num);
  }

  // 3. Formato EFI / Gerencianet: { "pix": [ { "txid": "SIMP123" } ] }
  if (Array.isArray(body.pix) && body.pix.length > 0) {
    const txid = body.pix[0].txid;
    const num = String(txid).replace(/\D/g, '');
    if (num) return Number(num);
  }

  // 4. Formato Mercado Pago ou Asaas: { "external_reference": "123" }
  if (body.external_reference) {
    const num = String(body.external_reference).replace(/\D/g, '');
    if (num) return Number(num);
  }

  // 5. Formato Woovi / OpenPix: { "charge": { "correlationID": "SIMP123" } }
  if (body.charge && body.charge.correlationID) {
    const num = String(body.charge.correlationID).replace(/\D/g, '');
    if (num) return Number(num);
  }

  return null;
}

export const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  // Healthcheck
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      service: 'Simpson Burguer Pix Webhook Server',
      status: 'online',
      time: new Date().toISOString()
    }));
  }

  // Endpoint do Webhook
  if (req.method === 'POST') {
    let rawData = '';

    req.on('data', chunk => {
      rawData += chunk;
      // Prevenção contra payloads gigantes (> 1MB)
      if (rawData.length > 1e6) {
        req.destroy();
      }
    });

    req.on('end', async () => {
      try {
        let body = {};
        if (rawData) {
          try {
            body = JSON.parse(rawData);
          } catch (e) {
            body = {};
          }
        }

        console.log(`[PIX WEBHOOK] Notificação recebida em ${req.url}:`, JSON.stringify(body));

        const orderId = extrairOrderId(body);

        if (!orderId) {
          console.warn('[PIX WEBHOOK] Aviso: Não foi possível identificar o order_id no payload.');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({
            received: true,
            warning: 'order_id not detected in payload'
          }));
        }

        await aprovarPedidoPix(orderId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
          status: 'success',
          order_id: orderId,
          message: 'Pedido marcado como pago no Supabase'
        }));
      } catch (err) {
        console.error('[PIX WEBHOOK] Erro ao processar:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint não encontrado' }));
});

// Inicialização automática se executado diretamente
if (process.argv[1] && process.argv[1].endsWith('webhook-pix.js')) {
  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`  SIMPSON BURGUER - SERVIDOR DE WEBHOOK PIX`);
    console.log(`  Rodando na porta ${PORT}`);
    console.log(`  Endpoint para Webhook: POST http://localhost:${PORT}/webhook/pix`);
    console.log(`======================================================\n`);
  });
}
