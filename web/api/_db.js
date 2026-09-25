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
    port: Number(process.env.SUPABASE_DB_PORT || 6543), // transaction pooler
    database: process.env.SUPABASE_DB_NAME || "postgres",
    user: usuario,
    password: senha,
    ssl: { rejectUnauthorized: false },
    max: 1,
    idleTimeoutMillis: 10000,
    /* o primeiro handshake no transaction pooler leva ~7s quando ele está frio;
       com 8s aqui a função morria com "connection timeout" antes de autenticar. */
    connectionTimeoutMillis: 20000,
  };
}

function getPool() {
  if (!pool) pool = new Pool(config());
  return pool;
}

async function consultar(sql, params) {
  const r = await getPool().query(sql, params);
  return r.rows;
}

module.exports = { consultar };
