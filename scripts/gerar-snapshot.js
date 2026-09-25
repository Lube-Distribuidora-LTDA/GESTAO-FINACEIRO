/* Gera web/snapshot.js a partir de dados/folha-administrativo-2026.json.
   O snapshot é o plano B do painel: se o banco não responder, a tela abre
   com estes números e avisa, em vez de mostrar erro em branco.
   Uso: node scripts/gerar-snapshot.js                                        */
const fs = require("fs");
const path = require("path");

const raiz = path.join(__dirname, "..");
const P = JSON.parse(fs.readFileSync(path.join(raiz, "dados", "folha-administrativo-2026.json"), "utf8"));

const COMP_ATUAL = "2026-09-01";
const COMP_ANT = "2026-08-01";

const BENEFICIOS = [
  { codigo: "600", descricao: "Assistência Odontológica — Titular", tipo: "fixo", valor: 0.95 },
  { codigo: "605", descricao: "Assistência Médica — Titular", tipo: "fixo", valor: 104.2 },
  { codigo: "640", descricao: "Assistência Médica — Dependente", tipo: "unitario", valor: 129.33 },
  { codigo: "642", descricao: "Contribuição Negocial", tipo: "percentual", valor: 2 },
  { codigo: "646", descricao: "Assistência Médica — Dependente", tipo: "unitario", valor: 129.33 },
  { codigo: "647", descricao: "Assistência Odontológica — Dependente", tipo: "unitario", valor: 12.06 },
];

const iso = (br) => (br ? br.slice(6, 10) + "-" + br.slice(3, 5) + "-" + br.slice(0, 2) : null);
const rubricas = (lista) =>
  (lista || []).map((r) => ({ codigo: r[0], descricao: r[1], tipo: r[2], valor: r[3], referencia: r[4] || "" }));
const bases = (b) =>
  b ? { inss: b.inss, aliquota: b.aliq, fgts: b.fgts, fgts_valor: b.fv, irrf: b.irrf } : {};

const colaboradores = P.map((p) => ({
  matricula: p.cod,
  nome: p.nome,
  funcao: p.fn.s,
  admissao: iso(p.adm),
  dep_ir: p.depIR,
  dep_sf: p.depSF,
  salario_contratual: p.ct.s,
  proventos: p.ts.p,
  descontos: p.ts.d,
  liquido: p.ts.l,
  evento: p.ev.s || null,
  bases: bases(p.bs),
  rubricas: rubricas(p.rs),
  anterior: p.ta
    ? {
        funcao: p.fn.a,
        salario_contratual: p.ct.a,
        proventos: p.ta.p,
        descontos: p.ta.d,
        liquido: p.ta.l,
        evento: p.ev.a || null,
        bases: bases(p.ba),
        rubricas: rubricas(p.ra),
      }
    : null,
  validacao: null,
  correcoes: [],
})).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

const soma = (lista, campo) => lista.reduce((a, x) => a + x[campo], 0);
const comAnterior = colaboradores.filter((c) => c.anterior);

const snapshot = {
  departamento: "ADMINISTRATIVO",
  competencia: COMP_ATUAL,
  competencia_anterior: COMP_ANT,
  gerado_em: new Date().toISOString(),
  competencias: [
    { competencia: COMP_ATUAL, pessoas: colaboradores.length },
    { competencia: COMP_ANT, pessoas: colaboradores.filter((c) => c.anterior).length },
  ],
  beneficios: BENEFICIOS,
  resumo: {
    pessoas: colaboradores.length,
    proventos: Math.round(soma(colaboradores, "proventos") * 100) / 100,
    descontos: Math.round(soma(colaboradores, "descontos") * 100) / 100,
    liquido: Math.round(soma(colaboradores, "liquido") * 100) / 100,
    pessoas_anterior: comAnterior.length,
    proventos_anterior: Math.round(comAnterior.reduce((a, x) => a + x.anterior.proventos, 0) * 100) / 100,
    liquido_anterior: Math.round(comAnterior.reduce((a, x) => a + x.anterior.liquido, 0) * 100) / 100,
  },
  colaboradores,
};

const destino = path.join(raiz, "web", "snapshot.js");
fs.writeFileSync(destino, "window.__SNAPSHOT__ = " + JSON.stringify(snapshot) + ";\n", "utf8");

console.log("snapshot gravado:", destino);
console.log(
  "  %d colaboradores | folha %s | líquido %s",
  colaboradores.length,
  snapshot.resumo.proventos.toFixed(2),
  snapshot.resumo.liquido.toFixed(2)
);
