/* Lê o PDF da folha do DP e devolve os colaboradores, as rubricas e o resumo.
   Só interpreta o que está impresso: não calcula nada e não completa nada.
   O que não der para ler com certeza vira erro, não vira chute. */
const { PDFParse } = require("pdf-parse");

const num = (s) => {
  if (s === undefined || s === null) return null;
  const t = String(s).trim().replace(/\./g, "").replace(",", ".");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
};
const dataISO = (br) =>
  /^\d{2}\/\d{2}\/\d{4}$/.test(br || "") ? br.slice(6) + "-" + br.slice(3, 5) + "-" + br.slice(0, 2) : null;

/* o PDF vem todo em caixa alta; na tela isso vira grito e não bate com o que já
   está gravado. "ANA MARIA FIRME LUBE" → "Ana Maria Firme Lube" */
const MINUSCULAS = { DE: 1, DA: 1, DO: 1, DAS: 1, DOS: 1, E: 1 };
const SIGLAS = { DP: 1, TI: 1, RH: 1, PCP: 1, CD: 1, SAC: 1, NF: 1, CPD: 1, EPI: 1 };
function titulo(texto) {
  if (!texto) return texto;
  return String(texto)
    .split(/\s+/)
    .map(function (palavra, i) {
      const alta = palavra.toLocaleUpperCase("pt-BR");
      if (SIGLAS[alta]) return alta;
      if (i > 0 && MINUSCULAS[alta]) return palavra.toLocaleLowerCase("pt-BR");
      return palavra.toLocaleLowerCase("pt-BR").replace(/^[\wÀ-ÿ]/, (c) => c.toLocaleUpperCase("pt-BR"));
    })
    .join(" ");
}

/* "Salário Base \t4.500,00\t220:00\t001"  →  código no fim, valor no meio.
   A referência pode estar na descrição (Parc. 8/18, Dep.00001) ou num campo próprio (220:00). */
function lerRubrica(linha) {
  const campos = linha.split("\t").map((c) => c.trim()).filter(Boolean);
  if (campos.length < 3) return null;

  const codigo = campos[campos.length - 1];
  if (!/^\d{3}$/.test(codigo)) return null;

  const valor = num(campos[1]);
  if (valor === null) return null;

  let descricao = campos[0];
  let referencia = campos.length >= 4 ? campos[2] : "";

  const parc = descricao.match(/\s*(Parc\.\s*\d+\/\d+)\s*$/);
  if (parc) {
    referencia = parc[1].replace(/\s+/g, " ");
    descricao = descricao.slice(0, parc.index).trim();
  } else {
    const dep = descricao.match(/\s*-?\s*(Dep\.\d+)\s*$/);
    if (dep) {
      referencia = dep[1];
      descricao = descricao.slice(0, dep.index).replace(/\s*-\s*$/, "").trim();
    }
  }

  return { codigo, descricao, valor, referencia };
}

/* Proventos e descontos são separados pelo código, como no recibo:
   001 salário, 016 ajuda de custo, 056 atestado e 437 estorno entram como provento. */
const PROVENTOS = { "001": 1, "016": 1, "056": 1, "437": 1 };

function lerTexto(texto) {
  const linhas = texto.split("\n").map((l) => l.replace(/\s+$/, ""));

  let competencia = null;
  let departamentoPdf = null;
  const colaboradores = [];
  let atual = null;
  const erros = [];

  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];

    if (!competencia) {
      const ref = l.match(/^(\d{2}\/\d{2}\/\d{4})\s+(\d{2}\/\d{2}\/\d{4})/);
      if (ref) competencia = dataISO(ref[1]);
    }
    if (!departamentoPdf && /^Código\s*\t/.test(l)) {
      const proxima = (linhas[i + 1] || "").trim();
      if (proxima && !/\d/.test(proxima)) departamentoPdf = proxima;
    }

    /* Cabeçalho da pessoa: "001037 ALI PEREIRA DE JESUS \t4.500,00 \t723\t0000".
       Quando o nome é longo, o PDF gruda o valor nele ("...JULIANI1.928,14"), então
       o corte é feito no primeiro valor com centavos, não no tabulador. */
    const pessoa = l.match(/^(\d{6})\s+(.*?)(\d{1,3}(?:\.\d{3})*,\d{2})(?:\s|\t|$)/);
    if (pessoa) {
      atual = {
        matricula: pessoa[1],
        nome: titulo(pessoa[2].replace(/\t/g, " ").trim()),
        salario_contratual: num(pessoa[3]),
        funcao: null,
        admissao: null,
        dep_ir: 0,
        dep_sf: 0,
        evento: null,
        rubricas: [],
        totais: null,
        bases: {},
      };
      colaboradores.push(atual);
      continue;
    }
    if (!atual) continue;

    const adm = l.match(/^(\d{2}\/\d{2}\/\d{4})\s*\tAdmissão/);
    if (adm) { atual.admissao = dataISO(adm[1]); continue; }

    const dep = l.match(/^Dep IR\s*:\s*Dep SF\s*:\s*\t\s*(\d+)\s*\t\s*(\d+)/);
    if (dep) { atual.dep_ir = Number(dep[1]); atual.dep_sf = Number(dep[2]); continue; }

    const fun = l.match(/^Função\s*:\s*(.+)$/);
    if (fun) { atual.funcao = titulo(fun[1].trim()); continue; }

    if (/^(ATESTADO|Férias|FÉRIAS|AFASTAMENTO)/i.test(l.trim())) {
      atual.evento = l.trim();
      continue;
    }

    const bases = l.match(
      /Base INSS:\s*([\d.,]+)\s*\(Aliq\.:\s*([^)]+)\)\s*\tBase FGTS:\s*([\d.,]+)\s*\(Valor:\s*([\d.,]+)\)(?:\s*\tBase IRRF Folha:\s*([\d.,]+))?/
    );
    if (bases) {
      atual.bases = {
        inss: num(bases[1]),
        aliquota: bases[2].trim(),
        fgts: num(bases[3]),
        fgts_valor: num(bases[4]),
        irrf: bases[5] ? num(bases[5]) : null,
      };
      atual = null; // o recibo dessa pessoa terminou
      continue;
    }

    /* totais do recibo: vêm logo depois da linha de assinatura */
    if (/^_+\/_+\/_+/.test(l.trim())) {
      const t = (linhas[i + 1] || "").split("\t").map((c) => c.trim()).filter(Boolean);
      if (t.length === 3) {
        const [p, d, liq] = t.map(num);
        if (p !== null && d !== null && liq !== null) atual.totais = { proventos: p, descontos: d, liquido: liq };
      }
      continue;
    }

    const rub = lerRubrica(l);
    if (rub) {
      rub.tipo = PROVENTOS[rub.codigo] ? "P" : "D";
      atual.rubricas.push(rub);
    }
  }

  /* resumo impresso no fim: acha o trio geral / descontos / líquido pela própria identidade */
  const fim = linhas.slice(linhas.findIndex((l) => /Resumo da folha/i.test(l)));
  const numeros = [];
  fim.forEach((l) =>
    l.split(/\s|\t/).forEach((p) => {
      const v = num(p.replace(/\*/g, ""));
      if (v !== null) numeros.push(v);
    })
  );
  let resumo = null;
  for (let i = 0; i + 2 < numeros.length; i++) {
    const [g, d, liq] = [numeros[i], numeros[i + 1], numeros[i + 2]];
    if (g > 0 && d >= 0 && Math.abs(g - d - liq) < 0.005) {
      const pessoas = numeros.slice(i + 3).find((v) => Number.isInteger(v) && v > 0 && v < 10000);
      resumo = { proventos: g, descontos: d, liquido: liq, pessoas: pessoas ?? null };
      break;
    }
  }
  if (!resumo) erros.push("Não encontrei o resumo da folha no fim do PDF");
  if (!competencia) erros.push("Não encontrei a competência (linha Ref.: do cabeçalho)");
  if (!departamentoPdf) erros.push("Não encontrei o departamento no cabeçalho");

  colaboradores.forEach((c) => {
    if (!c.totais) erros.push(`${c.matricula} ${c.nome}: não li os totais do recibo`);
    else {
      const p = c.rubricas.filter((r) => r.tipo === "P").reduce((a, r) => a + r.valor, 0);
      const d = c.rubricas.filter((r) => r.tipo === "D").reduce((a, r) => a + r.valor, 0);
      if (Math.abs(p - c.totais.proventos) > 0.005)
        erros.push(`${c.matricula} ${c.nome}: proventos das rubricas (${p.toFixed(2)}) diferem do total do recibo (${c.totais.proventos.toFixed(2)})`);
      if (Math.abs(d - c.totais.descontos) > 0.005)
        erros.push(`${c.matricula} ${c.nome}: descontos das rubricas (${d.toFixed(2)}) diferem do total do recibo (${c.totais.descontos.toFixed(2)})`);
      if (Math.abs(c.totais.proventos - c.totais.descontos - c.totais.liquido) > 0.005)
        erros.push(`${c.matricula} ${c.nome}: o recibo não fecha (proventos − descontos ≠ líquido)`);
    }
  });

  /* a soma dos recibos tem que bater com o resumo impresso — senão faltou gente ou sobrou */
  const soma = colaboradores.reduce(
    (a, c) => ({
      proventos: a.proventos + ((c.totais && c.totais.proventos) || 0),
      descontos: a.descontos + ((c.totais && c.totais.descontos) || 0),
      liquido: a.liquido + ((c.totais && c.totais.liquido) || 0),
    }),
    { proventos: 0, descontos: 0, liquido: 0 }
  );
  const r2 = (n) => Math.round(n * 100) / 100;
  const conferencia = {
    pessoas_lidas: colaboradores.length,
    pessoas_resumo: resumo ? resumo.pessoas : null,
    proventos_lidos: r2(soma.proventos),
    proventos_resumo: resumo ? resumo.proventos : null,
    descontos_lidos: r2(soma.descontos),
    descontos_resumo: resumo ? resumo.descontos : null,
    liquido_lido: r2(soma.liquido),
    liquido_resumo: resumo ? resumo.liquido : null,
  };
  if (resumo) {
    if (resumo.pessoas !== null && resumo.pessoas !== colaboradores.length)
      erros.push(`Li ${colaboradores.length} colaboradores, mas o resumo da folha diz ${resumo.pessoas}`);
    if (Math.abs(r2(soma.proventos) - resumo.proventos) > 0.005)
      erros.push(`Total de proventos lido (${r2(soma.proventos)}) diferente do resumo impresso (${resumo.proventos})`);
    if (Math.abs(r2(soma.descontos) - resumo.descontos) > 0.005)
      erros.push(`Total de descontos lido (${r2(soma.descontos)}) diferente do resumo impresso (${resumo.descontos})`);
    if (Math.abs(r2(soma.liquido) - resumo.liquido) > 0.005)
      erros.push(`Total líquido lido (${r2(soma.liquido)}) diferente do resumo impresso (${resumo.liquido})`);
  }

  return { competencia, departamentoPdf, colaboradores, resumo, conferencia, erros };
}

async function lerFolhaPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const { text } = await parser.getText();
    return lerTexto(text);
  } finally {
    try { await parser.destroy(); } catch (_) {}
  }
}

module.exports = { lerFolhaPdf, lerTexto };
