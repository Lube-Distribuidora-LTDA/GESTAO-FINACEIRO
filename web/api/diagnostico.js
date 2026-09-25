/* TEMPORÁRIO — descobre por que a conexão com o banco falha, a partir da própria Vercel.
   Não devolve senha nem valor de variável: só presença, formato e o erro de cada porta.
   Apagar assim que a conexão estiver resolvida. */
const { Client } = require("pg");

async function tentar(host, port, user, password) {
  const t0 = Date.now();
  const c = new Client({
    host, port, user, password,
    database: process.env.SUPABASE_DB_NAME || "postgres",
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 9000,
    query_timeout: 5000,
  });
  try {
    await c.connect();
    const r = await c.query("select current_user as usuario, inet_server_addr()::text as servidor");
    await c.end();
    return { porta: port, ok: true, segundos: (Date.now() - t0) / 1000, retorno: r.rows[0] };
  } catch (e) {
    try { await c.end(); } catch (_) {}
    return { porta: port, ok: false, segundos: (Date.now() - t0) / 1000, erro: e.message };
  }
}

module.exports = async (req, res) => {
  const host = process.env.SUPABASE_DB_HOST || "(vazio)";
  const user = process.env.SUPABASE_DB_USER || "";
  const senha = process.env.SUPABASE_DB_PASSWORD || "";

  const aspas = /^["'].*["']$/.test(senha);
  const espacos = senha !== senha.trim();

  const resultado = {
    regiao: process.env.VERCEL_REGION || "(desconhecida)",
    host,
    porta_configurada: process.env.SUPABASE_DB_PORT || "(vazia)",
    usuario: user,
    senha: { presente: senha.length > 0, entre_aspas: aspas, com_espaco_nas_pontas: espacos },
    testes: [],
  };

  if (senha) {
    const limpa = aspas ? senha.slice(1, -1) : senha.trim();
    resultado.testes.push(await tentar(host, 6543, user, limpa));
    resultado.testes.push(await tentar(host, 5432, user, limpa));
  }

  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.status(200).send(JSON.stringify(resultado, null, 1));
};
