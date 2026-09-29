/* POST /api/importar — recebe o PDF da folha do DP.
   { arquivo: "<base64>", modo: "previa" | "gravar", departamento?: "ADMINISTRATIVO" }

   Em "previa" nada é gravado: devolve o que foi lido e a conferência contra o resumo
   impresso na folha. Só grava quando a conferência fecha — melhor não carregar do que
   carregar torto. */
const { consultar } = require("./_db");
const { lerFolhaPdf } = require("./_folha-pdf");

/* o PDF diz "ADMINISTRAÇÃO"; no sistema o departamento chama ADMINISTRATIVO */
const DEPARTAMENTOS = {
  ADMINISTRACAO: "ADMINISTRATIVO",
  ADMINISTRATIVO: "ADMINISTRATIVO",
  LOGISTICA: "LOGISTICA",
  TRANSPORTE: "TRANSPORTE",
};
function normalizar(nome) {
  const limpo = String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();
  return DEPARTAMENTOS[limpo] || limpo;
}

function corpo(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) return JSON.parse(req.body);
  return {};
}

const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const mesAno = (iso) => (iso ? MES[Number(iso.slice(5, 7)) - 1] + "/" + iso.slice(0, 4) : "—");

module.exports = async (req, res) => {
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");

  if (req.method !== "POST") {
    res.status(405).send(JSON.stringify({ erro: "use POST" }));
    return;
  }

  try {
    const b = corpo(req);
    if (!b.arquivo) throw new Error("nenhum arquivo recebido");

    const buffer = Buffer.from(String(b.arquivo).replace(/^data:[^,]+,/, ""), "base64");
    if (buffer.length < 1000) throw new Error("o arquivo chegou vazio ou não é um PDF");

    const folha = await lerFolhaPdf(buffer);
    const departamento = normalizar(b.departamento || folha.departamentoPdf);
    const podeGravar = folha.erros.length === 0 && !!folha.competencia && !!departamento;

    /* o que já existe para essa competência, para o usuário saber o que será substituído */
    let jaExiste = null;
    if (folha.competencia && departamento) {
      const r = await consultar(
        `select
           (select count(*) from financeiro.fato_folha_colaborador
             where competencia = $1::date and departamento = $2) as colaboradores,
           (select count(*) from financeiro.validacao_folha
             where competencia = $1::date and departamento = $2) as validacoes,
           (select count(*) from financeiro.correcao_folha
             where competencia = $1::date and departamento = $2) as correcoes`,
        [folha.competencia, departamento]
      );
      jaExiste = {
        colaboradores: Number(r[0].colaboradores),
        validacoes: Number(r[0].validacoes),
        correcoes: Number(r[0].correcoes),
      };
    }

    const resposta = {
      competencia: folha.competencia,
      competencia_rotulo: mesAno(folha.competencia),
      departamento,
      departamento_pdf: folha.departamentoPdf,
      colaboradores: folha.colaboradores.length,
      rubricas: folha.colaboradores.reduce((a, c) => a + c.rubricas.length, 0),
      conferencia: folha.conferencia,
      erros: folha.erros,
      pode_gravar: podeGravar,
      ja_existe: jaExiste,
      pessoas: folha.colaboradores.map((c) => ({
        matricula: c.matricula, nome: c.nome, funcao: c.funcao,
        salario_contratual: c.salario_contratual, liquido: c.totais ? c.totais.liquido : null,
      })),
    };

    if (b.modo !== "gravar") {
      res.status(200).send(JSON.stringify(resposta));
      return;
    }
    if (!podeGravar) {
      res.status(400).send(JSON.stringify({ ...resposta, erro: "a folha não passou na conferência; nada foi gravado" }));
      return;
    }

    const comp = folha.competencia;
    for (const c of folha.colaboradores) {
      await consultar(
        `insert into financeiro.fato_folha_colaborador
           (competencia, departamento, matricula, nome, funcao, admissao, salario_contratual,
            dep_ir, dep_sf, total_proventos, total_descontos, liquido,
            base_inss, aliquota_inss, base_fgts, valor_fgts, base_irrf, evento)
         values ($1::date,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         on conflict (competencia, departamento, matricula) do update set
           nome = excluded.nome, funcao = excluded.funcao, admissao = excluded.admissao,
           salario_contratual = excluded.salario_contratual, dep_ir = excluded.dep_ir, dep_sf = excluded.dep_sf,
           total_proventos = excluded.total_proventos, total_descontos = excluded.total_descontos,
           liquido = excluded.liquido, base_inss = excluded.base_inss, aliquota_inss = excluded.aliquota_inss,
           base_fgts = excluded.base_fgts, valor_fgts = excluded.valor_fgts, base_irrf = excluded.base_irrf,
           evento = excluded.evento, carregado_em = now()`,
        [comp, departamento, c.matricula, c.nome, c.funcao, c.admissao, c.salario_contratual,
         c.dep_ir, c.dep_sf, c.totais.proventos, c.totais.descontos, c.totais.liquido,
         c.bases.inss, c.bases.aliquota, c.bases.fgts, c.bases.fgts_valor, c.bases.irrf, c.evento]
      );
    }

    await consultar(
      `delete from financeiro.fato_folha_rubrica where competencia = $1::date and departamento = $2`,
      [comp, departamento]
    );
    for (const c of folha.colaboradores) {
      for (let i = 0; i < c.rubricas.length; i++) {
        const r = c.rubricas[i];
        await consultar(
          `insert into financeiro.fato_folha_rubrica
             (competencia, departamento, matricula, codigo, descricao, tipo, valor, referencia, ordem)
           values ($1::date,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [comp, departamento, c.matricula, r.codigo, r.descricao, r.tipo, r.valor, r.referencia || "", i + 1]
        );
      }
    }

    await consultar(
      `insert into financeiro.controle_carga (consulta, destino, linhas, linhas_esperadas, status, mensagem)
       values ($1, 'financeiro.fato_folha_colaborador', $2, $3, 'OK', $4)`,
      [
        `importacao_pdf_${departamento}_${comp}`,
        folha.colaboradores.length,
        folha.conferencia.pessoas_resumo,
        `PDF importado pelo painel. Proventos ${folha.conferencia.proventos_lidos}, descontos ${folha.conferencia.descontos_lidos}, liquido ${folha.conferencia.liquido_lido} - iguais ao resumo impresso.`,
      ]
    );

    res.status(200).send(JSON.stringify({ ...resposta, gravado: true }));
  } catch (e) {
    res.status(400).send(JSON.stringify({ erro: e.message }));
  }
};
