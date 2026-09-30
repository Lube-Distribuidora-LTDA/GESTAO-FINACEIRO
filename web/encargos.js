/* Confere INSS e IRRF de cada recibo contra as tabelas oficiais do ano.
   Este arquivo é UM só para o navegador (web/encargos.js) e para a API
   (api/_encargos.js só faz require daqui): a regra existe em um lugar.
   Só calcula a partir do que está impresso no recibo; quando o recibo não traz o
   suficiente para refazer a conta (férias pagas em recibo à parte, por exemplo),
   diz que não dá para conferir — não chuta.

   Tabelas de 2026:
   - INSS: Portaria interministerial MPS/MF, DOU 09/01/2026 (progressiva por faixa, teto 8.475,55).
   - IRRF: Lei 15.191/2025 (tabela mensal) e Lei 15.270/2025 (redução a partir de jan/2026:
     zera o imposto até 5.000,00 e cai linearmente até 7.350,00).

   O que as 405 folhas de ago/set 2026 ensinaram, e está codificado aqui:
   - a contabilidade trunca cada faixa do INSS nos centavos antes de somar;
   - ajuda de custo (016), salário-família (599) e estorno de provisão (437) não entram
     em base nenhuma; prêmio (415) não entra no INSS mas entra no IR;
   - a "Base IRRF Folha" impressa só é confiável em quem paga imposto — em quem não paga
     ela não fecha com nada, então a base é refeita aqui a partir do próprio recibo. */

const TABELAS = {
  2026: {
    inss: { faixas: [[1621.00, 0.075], [2902.84, 0.09], [4354.27, 0.12], [8475.55, 0.14]], teto: 8475.55 },
    irrf: {
      faixas: [[2428.80, 0, 0], [2826.65, 0.075, 182.16], [3751.05, 0.15, 394.16], [4664.68, 0.225, 675.49], [Infinity, 0.275, 908.73]],
      dependente: 189.59,
      simplificado: 607.20,
      reducao: { ate: 5000.00, teto: 312.89, limite: 7350.00, a: 978.62, b: 0.133145 },
    },
  },
};

/* rubricas de provento fora das bases. 998 é a contrapartida contábil de quem está
   afastado (a empresa segue descontando o plano e o saldo negativo acumula): não é
   remuneração, então não tem INSS nem IR. */
const FORA_INSS = { "016": 1, "599": 1, "437": 1, "415": 1, "998": 1 };
const FORA_IRRF = { "016": 1, "599": 1, "437": 1, "998": 1 };

const r2 = (n) => Math.round(n * 100) / 100;
const trunc2 = (n) => Math.floor(n * 100 + 1e-9) / 100;

function tabelaDoAno(competencia) {
  const ano = Number(String(competencia || "").slice(0, 4));
  return TABELAS[ano] || null;
}

/* INSS progressivo, truncando cada faixa como a contabilidade faz
   (275,69 e não 275,71 para base 3.225,91). */
function inssDevido(base, t) {
  const b = Math.min(base, t.inss.teto);
  let total = 0, piso = 0;
  for (const [ate, aliq] of t.inss.faixas) {
    if (b <= piso) break;
    total += trunc2((Math.min(b, ate) - piso) * aliq);
    piso = ate;
  }
  return r2(total);
}

function irTabela(base, t) {
  if (base <= 0) return 0;
  const f = t.irrf.faixas.find(([ate]) => base <= ate);
  return Math.max(0, r2(base * f[1] - f[2]));
}
function irReducao(rendimento, t) {
  const r = t.irrf.reducao;
  if (rendimento <= r.ate) return r.teto;
  if (rendimento <= r.limite) return r2(r.a - r.b * rendimento);
  return 0;
}

/* Recebe uma pessoa no formato do leitor (rubricas com codigo/tipo/valor, bases, totais,
   dep_ir, evento) e devolve a conferência dos dois encargos. */
function conferirEncargos(p, competencia) {
  const t = tabelaDoAno(competencia);
  const rubricas = p.rubricas || [];
  const soma = (cods) => rubricas.filter((r) => cods.indexOf(r.codigo) >= 0).reduce((a, r) => a + Number(r.valor), 0);
  const somaP = (fora) => r2(rubricas.filter((r) => r.tipo === "P" && !fora[r.codigo]).reduce((a, r) => a + Number(r.valor), 0));
  const inssFolha = r2(soma(["903"]));
  const irrfFolha = r2(soma(["914"]));
  const bases = p.bases || {};
  const baseInssImpressa = Number(bases.inss || 0);
  const baseIrrfImpressa = bases.irrf === null || bases.irrf === undefined ? null : Number(bases.irrf);
  const dependentes = Number(p.dep_ir || 0);

  if (!t) {
    return { inss: { situacao: "sem_tabela", folha: inssFolha }, irrf: { situacao: "sem_tabela", folha: irrfFolha },
             aviso: "Não tenho a tabela de INSS/IRRF de " + String(competencia).slice(0, 4) };
  }

  /* ---- INSS: sobre a base impressa (que é o que o recibo declara ter tributado) */
  const baseInss = baseInssImpressa;
  const inss = { folha: inssFolha, base: baseInss, base_calculada: somaP(FORA_INSS), devido: inssDevido(baseInss, t) };
  if (baseInss <= 0 && inssFolha === 0) inss.situacao = "sem_base";
  else if (Math.abs(inss.devido - inssFolha) <= 0.01) inss.situacao = "confere";
  else if (inssFolha > inss.devido + 0.01) {
    /* A base impressa não explica o desconto: férias pagas em recibo separado, com o INSS
       do mês calculado sobre a soma. Qual base explicaria o desconto? */
    inss.situacao = "acima_da_base";
    inss.diferenca = r2(inssFolha - inss.devido);
    let lo = baseInss, hi = t.inss.teto;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (inssDevido(m, t) < inssFolha) lo = m; else hi = m; }
    inss.base_implicita = r2(hi);
  } else {
    inss.situacao = "diverge";
    inss.diferenca = r2(inssFolha - inss.devido);
  }

  /* ---- IRRF: base refeita a partir do recibo; vale a dedução mais favorável
     (legal: INSS + dependentes; ou simplificada: 607,20) e depois a redução da lei. */
  const rendimento = somaP(FORA_IRRF);
  const irrf = { folha: irrfFolha, base_impressa: baseIrrfImpressa, dependentes, rendimento };
  irrf.base_legal = Math.max(0, r2(rendimento - inssFolha - dependentes * t.irrf.dependente));
  irrf.base_simplificada = Math.max(0, r2(rendimento - t.irrf.simplificado));
  const tabLegal = irTabela(irrf.base_legal, t), tabSimpl = irTabela(irrf.base_simplificada, t);
  irrf.deducao = tabSimpl < tabLegal ? "simplificada" : "legal";
  irrf.base = irrf.deducao === "simplificada" ? irrf.base_simplificada : irrf.base_legal;
  irrf.tabela = Math.min(tabLegal, tabSimpl);
  irrf.reducao = irReducao(rendimento, t);
  irrf.devido = Math.max(0, r2(irrf.tabela - irrf.reducao));
  if (inss.situacao === "acima_da_base") irrf.situacao = "nao_conferivel"; // parte do rendimento está fora do recibo
  else if (Math.abs(irrf.devido - irrfFolha) <= 0.01) irrf.situacao = rendimento === 0 && irrfFolha === 0 ? "sem_base" : "confere";
  else { irrf.situacao = "diverge"; irrf.diferenca = r2(irrfFolha - irrf.devido); }
  /* a base impressa só é comparável em quem paga imposto; a contabilidade imprime a base
     da dedução que usou (legal ou simplificada) */
  if (irrfFolha > 0 && baseIrrfImpressa !== null &&
      Math.abs(baseIrrfImpressa - irrf.base_legal) > 0.02 && Math.abs(baseIrrfImpressa - irrf.base_simplificada) > 0.02)
    irrf.base_impressa_diverge = r2(baseIrrfImpressa - irrf.base);

  return { inss, irrf, ano: Number(String(competencia).slice(0, 4)) };
}

var API_ENCARGOS = { conferirEncargos: conferirEncargos, inssDevido: inssDevido, irTabela: irTabela, irReducao: irReducao, TABELAS: TABELAS };
if (typeof module !== "undefined" && module.exports) module.exports = API_ENCARGOS;
else if (typeof window !== "undefined") window.Encargos = API_ENCARGOS;
