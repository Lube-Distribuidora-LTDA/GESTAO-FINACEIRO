/* POST /api/importar — recebe o PDF da folha do DP.
   { arquivo: "<base64>", modo: "previa" | "gravar" }

   Em "previa" nada é gravado: devolve o que foi lido e a conferência contra os resumos
   impressos na folha. Só grava quando tudo fecha. A regra inteira está em
   _importar-folha.js, que é a mesma usada na carga em lote. */
const { importarFolha } = require("./_importar-folha");

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
    if (!b.arquivo) throw new Error("nenhum arquivo recebido");

    const buffer = Buffer.from(String(b.arquivo).replace(/^data:[^,]+,/, ""), "base64");
    if (buffer.length < 1000) throw new Error("o arquivo chegou vazio ou não é um PDF");

    const { status, resposta } = await importarFolha(buffer, { modo: b.modo === "gravar" ? "gravar" : "previa", origem: "painel" });
    res.status(status).send(JSON.stringify(resposta));
  } catch (e) {
    res.status(400).send(JSON.stringify({ erro: e.message }));
  }
};
