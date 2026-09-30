/* GET /api/departamentos — empresas e departamentos que têm folha carregada.
   É o que monta o menu lateral: ele mostra só o que existe. */
const { consultar } = require("./_db");

module.exports = async (req, res) => {
  try {
    const linhas = await consultar("select financeiro.painel_departamentos() as lista");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "public, s-maxage=300, stale-while-revalidate=3600");
    res.status(200).send(JSON.stringify(linhas[0] ? linhas[0].lista : []));
  } catch (e) {
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.status(500).send(JSON.stringify({ erro: e.message }));
  }
};
