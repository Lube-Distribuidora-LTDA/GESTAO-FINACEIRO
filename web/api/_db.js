/* Conexão com o Supabase (projeto DATA WAREHOUSE, schema financeiro).
   O navegador nunca fala com o banco: só estas funções, no servidor. */
const { Pool } = require("pg");

/* O pooler do Supabase responde em IPv4. Em ambiente sem rota IPv6, tentar AAAA
   primeiro faz a conexão ficar pendurada até estourar o tempo da função — que foi
   exatamente o que aconteceu no primeiro deploy. */
try { require("dns").setDefaultResultOrder("ipv4first"); } catch (_) {}

/* ref do projeto DATA WAREHOUSE. A máquina do Júlio tem variáveis de ambiente
   apontando para OUTRO projeto (painel-icms-lube); sem esta conferência, um
   deploy mal configurado escreveria no banco errado sem avisar. */
const REF_ESPERADO = "ivcnotrynogaljrvvyes";

let pool;

function config() {
  const usuario = process.env.SUPABASE_DB_USER || "";
  const senha = process.env.SUPABASE_DB_PASSWORD || "";
  if (!senha) throw new Error("SUPABASE_DB_PASSWORD não está definida nas variáveis de ambiente");
  if (!usuario.endsWith(REF_ESPERADO))
    throw new Error(`SUPABASE_DB_USER aponta para outro projeto (esperado ...${REF_ESPERADO})`);

  return {
    host: process.env.SUPABASE_DB_HOST || "aws-0-sa-east-1.pooler.supabase.com",
    /* 5432 = session pooler. O padrão da casa para função serverless é o transaction
       pooler (6543), mas o deste projeto conecta e trava a consulta ("Query read
       timeout"); o 5432 responde em menos de 1s. Medido em 2026-09-25. */
    port: Number(process.env.SUPABASE_DB_PORT || 5432),
    database: process.env.SUPABASE_DB_NAME || "postgres",
    user: usuario,
    password: senha,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 10000,
    /* o primeiro handshake leva de 7 a 15s com o pooler frio; abaixo disso a conexão
       é cortada antes de autenticar. Duas tentativas cabem no limite da função. */
    connectionTimeoutMillis: 15000,
  };
}

function getPool() {
  if (!pool) pool = new Pool(config());
  return pool;
}

function erroDeConexao(e) {
  const m = String((e && e.message) || "");
  return /timeout|ECONNRESET|ECONNREFUSED|terminated|ETIMEDOUT/i.test(m);
}

/* A função e o pooler acordam juntos: a primeira conexão depois de um tempo parado
   leva de 10 a 20 segundos, e às vezes não completa. Quando isso acontece, o pool
   é descartado e a chamada refeita — a segunda tentativa costuma responder na hora. */
async function consultar(sql, params) {
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await getPool().query(sql, params);
      return r.rows;
    } catch (e) {
      if (tentativa >= 2 || !erroDeConexao(e)) throw e;
      try { await pool.end(); } catch (_) {}
      pool = null;
    }
  }
}

module.exports = { consultar };
