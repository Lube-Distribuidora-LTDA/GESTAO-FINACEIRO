/* Importa uma folha do DP (PDF) para o schema financeiro. É o mesmo caminho para o
   painel (/api/importar) e para carga em lote pela máquina: um código só, uma regra só.

   Um PDF traz uma empresa e um ou mais departamentos, cada um com seu resumo. Nada é
   gravado enquanto todos os recibos e todos os resumos não fecharem — melhor não
   carregar do que carregar torto. */
const { consultar } = require("./_db");
const { lerFolhaPdf } = require("./_folha-pdf");

/* Nome do departamento como fica no sistema. O PDF diz "ADMINISTRAÇÃO"; no sistema o
   Administrativo da LUBE sempre se chamou ADMINISTRATIVO e continua assim. Empresa de
   departamento único imprime "TODOS", que aqui vira GERAL. */
const DEPARTAMENTOS = { ADMINISTRACAO: "ADMINISTRATIVO", ADMINISTRATIVO: "ADMINISTRATIVO", TODOS: "GERAL" };
function normalizarDepartamento(nome) {
  const limpo = String(nome || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();
  return DEPARTAMENTOS[limpo] || limpo;
}

const MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const mesAno = (iso) => (iso ? MES[Number(iso.slice(5, 7)) - 1] + "/" + iso.slice(0, 4) : "—");

async function importarFolha(buffer, opcoes) {
  const modo = (opcoes && opcoes.modo) || "previa";
  const folha = await lerFolhaPdf(buffer);
  const erros = folha.erros.slice();

  /* a empresa vem do cabeçalho do PDF e tem que estar cadastrada */
  let empresa = null;
  if (folha.empresa_codigo) {
    const e = await consultar(`select sigla, razao_social from financeiro.empresa where codigo_dp = $1`, [folha.empresa_codigo]);
    if (e.length) empresa = e[0];
    else erros.push(`Empresa ${folha.empresa_codigo} (${folha.empresa}) não está cadastrada em financeiro.empresa`);
  }

  /* departamentos do arquivo, com o nome que ficam no sistema */
  const grupos = {};
  folha.colaboradores.forEach((c) => {
    const dep = normalizarDepartamento(c.departamento || folha.departamentoPdf);
    (grupos[dep] = grupos[dep] || []).push(c);
  });
  const departamentos = Object.keys(grupos);
  if (!departamentos.length) erros.push("Nenhum departamento lido");

  const podeGravar = erros.length === 0 && !!folha.competencia && !!empresa;

  /* o que já existe, para o usuário saber o que será substituído */
  const jaExiste = [];
  if (folha.competencia && empresa) {
    for (const dep of departamentos) {
      const r = await consultar(
        `select
           (select count(*) from financeiro.fato_folha_colaborador
             where competencia = $1::date and empresa = $2 and departamento = $3) as colaboradores,
           (select count(*) from financeiro.validacao_folha
             where competencia = $1::date and empresa = $2 and departamento = $3) as validacoes,
           (select count(*) from financeiro.correcao_folha
             where competencia = $1::date and empresa = $2 and departamento = $3) as correcoes`,
        [folha.competencia, empresa.sigla, dep]
      );
      jaExiste.push({ departamento: dep, colaboradores: Number(r[0].colaboradores),
                      validacoes: Number(r[0].validacoes), correcoes: Number(r[0].correcoes) });
    }
  }

  const resposta = {
    competencia: folha.competencia,
    competencia_rotulo: mesAno(folha.competencia),
    empresa: empresa ? empresa.sigla : null,
    empresa_pdf: folha.empresa,
    departamentos: departamentos.map((d) => ({ departamento: d, colaboradores: grupos[d].length })),
    /* compatibilidade com a tela: o primeiro departamento */
    departamento: departamentos[0] || null,
    departamento_pdf: folha.departamentoPdf,
    colaboradores: folha.colaboradores.length,
    rubricas: folha.colaboradores.reduce((a, c) => a + c.rubricas.length, 0),
    conferencia: folha.conferencia,
    resumos: folha.resumos,
    erros,
    pode_gravar: podeGravar,
    ja_existe: jaExiste.reduce((a, j) => ({
      colaboradores: a.colaboradores + j.colaboradores, validacoes: a.validacoes + j.validacoes, correcoes: a.correcoes + j.correcoes,
    }), { colaboradores: 0, validacoes: 0, correcoes: 0 }),
    ja_existe_por_departamento: jaExiste,
    pessoas: folha.colaboradores.map((c) => ({
      matricula: c.matricula, nome: c.nome, funcao: c.funcao, departamento: normalizarDepartamento(c.departamento),
      salario_contratual: c.salario_contratual, liquido: c.totais ? c.totais.liquido : null,
    })),
  };

  if (modo !== "gravar") return { status: 200, resposta };
  if (!podeGravar) return { status: 400, resposta: { ...resposta, erro: "a folha não passou na conferência; nada foi gravado" } };

  const comp = folha.competencia;
  const emp = empresa.sigla;
  for (const dep of departamentos) {
    for (const c of grupos[dep]) {
      await consultar(
        `insert into financeiro.fato_folha_colaborador
           (competencia, empresa, departamento, matricula, nome, funcao, admissao, salario_contratual,
            dep_ir, dep_sf, total_proventos, total_descontos, liquido,
            base_inss, aliquota_inss, base_fgts, valor_fgts, base_irrf, evento)
         values ($1::date,$2,$3,$4,$5,$6,$7::date,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         on conflict (competencia, empresa, departamento, matricula) do update set
           nome = excluded.nome, funcao = excluded.funcao, admissao = excluded.admissao,
           salario_contratual = excluded.salario_contratual, dep_ir = excluded.dep_ir, dep_sf = excluded.dep_sf,
           total_proventos = excluded.total_proventos, total_descontos = excluded.total_descontos,
           liquido = excluded.liquido, base_inss = excluded.base_inss, aliquota_inss = excluded.aliquota_inss,
           base_fgts = excluded.base_fgts, valor_fgts = excluded.valor_fgts, base_irrf = excluded.base_irrf,
           evento = excluded.evento, carregado_em = now()`,
        [comp, emp, dep, c.matricula, c.nome, c.funcao, c.admissao, c.salario_contratual,
         c.dep_ir, c.dep_sf, c.totais.proventos, c.totais.descontos, c.totais.liquido,
         c.bases.inss, c.bases.aliquota, c.bases.fgts, c.bases.fgts_valor, c.bases.irrf, c.evento]
      );
    }

    await consultar(
      `delete from financeiro.fato_folha_rubrica where competencia = $1::date and empresa = $2 and departamento = $3`,
      [comp, emp, dep]
    );
    for (const c of grupos[dep]) {
      for (let i = 0; i < c.rubricas.length; i++) {
        const r = c.rubricas[i];
        await consultar(
          `insert into financeiro.fato_folha_rubrica
             (competencia, empresa, departamento, matricula, codigo, descricao, tipo, valor, referencia, ordem)
           values ($1::date,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [comp, emp, dep, c.matricula, r.codigo, r.descricao, r.tipo, r.valor, r.referencia || "", i + 1]
        );
      }
    }

    const resumo = (folha.resumos || []).find((r) => r.departamentos.map(normalizarDepartamento).indexOf(dep) >= 0);
    await consultar(
      `insert into financeiro.controle_carga (consulta, destino, linhas, linhas_esperadas, status, mensagem)
       values ($1, 'financeiro.fato_folha_colaborador', $2, $3, 'OK', $4)`,
      [
        `importacao_pdf_${emp}_${dep}_${comp}`,
        grupos[dep].length,
        resumo ? resumo.pessoas : null,
        `PDF importado (${modo === "gravar" && opcoes && opcoes.origem ? opcoes.origem : "painel"}). ` +
          `Recibos e resumo impresso conferidos: proventos ${resumo ? resumo.proventos : "?"}, líquido ${resumo ? resumo.liquido : "?"}.`,
      ]
    );
  }

  return { status: 200, resposta: { ...resposta, gravado: true } };
}

module.exports = { importarFolha, normalizarDepartamento };
