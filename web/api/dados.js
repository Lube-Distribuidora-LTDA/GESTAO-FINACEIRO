/* GET /api/dados?dep=ADMINISTRATIVO[&competencia=2026-09-01]
   Devolve o payload inteiro do painel, montado por financeiro.painel_dados(). */
const { consultar } = require("./_db");

module.exports = async (req, res) => {
  try {
    const dep = (req.query && req.query.dep) || "ADMINISTRATIVO";
    const comp = (req.query && req.query.competencia) || null;

    const linhas = await consultar("select financeiro.painel_dados($1, $2::date) as dados", [dep, comp]);
    const dados = linhas[0] && linhas[0].dados;

    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=600, stale-while-revalidate=3600");
    res.status(200).send(JSON.stringify(dados));
  } catch (e) {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.status(500).send(JSON.stringify({ erro: e.message }));
  }
};
