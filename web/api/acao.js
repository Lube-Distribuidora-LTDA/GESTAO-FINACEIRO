/* POST /api/acao — grava o que o usuário decide na tela.
   tipo: "validacao"  { matricula, status: confirmado|verificar|corrigido|null }
         "correcao"   { matricula, codigo, referencia, valor_original, valor_corrigido, observacao, status }
         "beneficios" { beneficios: [{ codigo, valor }] }                                                  */
const { consultar } = require("./_db");

const STATUS_VALIDOS = ["confirmado", "verificar", "corrigido"];

function corpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  return {};
}

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ erro: "use POST" }));
    return;
  }

  try {
    const b = corpo(req);
    const dep = b.departamento || "ADMINISTRATIVO";
    const comp = b.competencia;

    if (b.tipo === "beneficios") {
      const lista = Array.isArray(b.beneficios) ? b.beneficios : [];
      for (const item of lista) {
        const valor = Number(item.valor);
        if (!item.codigo || !isFinite(valor)) continue;
        await consultar(
          `update financeiro.beneficio_referencia
              set valor = $2, atualizado_em = now(), atualizado_por = 'painel'
            where codigo = $1`,
          [String(item.codigo), valor]
        );
      }
      res.status(200).send(JSON.stringify({ ok: true, atualizados: lista.length }));
      return;
    }

    if (!comp || !b.matricula) throw new Error("competência e matrícula são obrigatórias");

    if (b.tipo === "validacao") {
      if (b.status === null || b.status === undefined || b.status === "") {
        await consultar(
          `delete from financeiro.validacao_folha
            where competencia = $1::date and departamento = $2 and matricula = $3`,
          [comp, dep, b.matricula]
        );
      } else {
        if (!STATUS_VALIDOS.includes(b.status)) throw new Error("status inválido");
        await consultar(
          `insert into financeiro.validacao_folha
             (competencia, departamento, matricula, status, observacao, usuario, atualizado_em)
           values ($1::date, $2, $3, $4, $5, 'painel', now())
           on conflict (competencia, departamento, matricula)
           do update set status = excluded.status, observacao = excluded.observacao,
                         usuario = excluded.usuario, atualizado_em = now()`,
          [comp, dep, b.matricula, b.status, b.observacao || null]
        );
      }
      res.status(200).send(JSON.stringify({ ok: true }));
      return;
    }

    if (b.tipo === "correcao") {
      const ref = b.referencia || "";
      if (b.valor_corrigido === null || b.valor_corrigido === undefined) {
        await consultar(
          `delete from financeiro.correcao_folha
            where competencia = $1::date and departamento = $2 and matricula = $3
              and codigo = $4 and referencia = $5`,
          [comp, dep, b.matricula, b.codigo, ref]
        );
      } else {
        const valor = Number(b.valor_corrigido);
        if (!isFinite(valor)) throw new Error("valor corrigido inválido");
        await consultar(
          `insert into financeiro.correcao_folha
             (competencia, departamento, matricula, codigo, referencia,
              valor_original, valor_corrigido, observacao, usuario, atualizado_em)
           values ($1::date, $2, $3, $4, $5, $6, $7, $8, 'painel', now())
           on conflict (competencia, departamento, matricula, codigo, referencia)
           do update set valor_original = excluded.valor_original,
                         valor_corrigido = excluded.valor_corrigido,
                         observacao = excluded.observacao, atualizado_em = now()`,
          [comp, dep, b.matricula, b.codigo, ref,
           b.valor_original === undefined ? null : Number(b.valor_original), valor, b.observacao || null]
        );
      }

      if (b.status && STATUS_VALIDOS.includes(b.status)) {
        await consultar(
          `insert into financeiro.validacao_folha
             (competencia, departamento, matricula, status, usuario, atualizado_em)
           values ($1::date, $2, $3, $4, 'painel', now())
           on conflict (competencia, departamento, matricula)
           do update set status = excluded.status, usuario = excluded.usuario, atualizado_em = now()`,
          [comp, dep, b.matricula, b.status]
        );
      } else if (b.status === null) {
        await consultar(
          `delete from financeiro.validacao_folha
            where competencia = $1::date and departamento = $2 and matricula = $3 and status = 'corrigido'`,
          [comp, dep, b.matricula]
        );
      }

      res.status(200).send(JSON.stringify({ ok: true }));
      return;
    }

    throw new Error("tipo desconhecido");
  } catch (e) {
    res.status(400).send(JSON.stringify({ erro: e.message }));
  }
};
