/* Validação de Folha — painel do Sistema Financeiro da Lube.
   Lê de /api/dados (função financeiro.painel_dados no Supabase).
   Sem conexão com o banco, cai no snapshot embutido e diz isso na tela. */
(function () {
  "use strict";

  var DEP = "ADMINISTRATIVO";
  var LS = "folha-lube-";
  var dados = null;
  var abertoIdx = null;
  var editando = null;
  var abaAtiva = "comparativo";
  var competenciaEscolhida = null; // null = sempre a mais recente

  /* ------------------------------------------------ utilitários */
  function brl(v) {
    if (v === null || v === undefined || v === "") return "—";
    return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(v) {
    if (v === null || v === undefined || v === "") return "—";
    return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  var MES = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  function mesAno(iso) {
    if (!iso) return "—";
    var p = String(iso).slice(0, 10).split("-");
    var nome = MES[Number(p[1]) - 1] || "";
    return nome.charAt(0).toUpperCase() + nome.slice(1) + "/" + p[0];
  }
  function dataBR(iso) {
    if (!iso) return "—";
    var p = String(iso).slice(0, 10).split("-");
    return p[2] + "/" + p[1] + "/" + p[0];
  }
  function ls(k, v) {
    try {
      if (v === undefined) return JSON.parse(localStorage.getItem(LS + k) || "null");
      localStorage.setItem(LS + k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  /* ------------------------------------------------ carga */
  function carregar() {
    var url = "api/dados?dep=" + encodeURIComponent(DEP) +
      (competenciaEscolhida ? "&competencia=" + encodeURIComponent(competenciaEscolhida) : "");
    return fetch(url, { headers: { accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.colaboradores) throw new Error("resposta sem dados");
        dados = j;
      });
  }

  /* Quando uma gravação não chega ao banco, a marcação fica guardada aqui e a
     tela diz isso — melhor que sumir em silêncio e o mês fechar errado. */
  function pendentes() { return ls("pendentes-" + DEP) || []; }
  function guardarPendente(payload) {
    var fila = pendentes();
    fila.push({ quando: new Date().toISOString(), payload: payload });
    ls("pendentes-" + DEP, fila);
    avisarPendencia();
  }
  function avisarPendencia() {
    var fila = pendentes();
    if (!fila.length) return;
    document.getElementById("aviso").innerHTML =
      '<div class="aviso erro"><span class="ic">⚠</span><div><b>' + fila.length +
      " marcação(ões) não chegaram ao banco.</b> O banco recusou ou não respondeu na hora do clique. " +
      "Recarregue a página e refaça essas marcações; se repetir, me chame.</div></div>";
  }

  function salvar(payload) {
    return fetch("api/acao", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.assign({ departamento: DEP, competencia: dados.competencia }, payload)),
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* ------------------------------------------------ regras de validação */
  var VARIAVEL = { "665": 1, "667": 1, "437": 1, "056": 1, "016": 1, "903": 1, "914": 1, "001": 1 };

  function beneficio(cod) {
    return (dados.beneficios || []).filter(function (b) { return b.codigo === cod; })[0] || null;
  }
  function confereBeneficio(cod, valor) {
    var b = beneficio(cod);
    if (!b || valor == null || b.tipo === "percentual") return null;
    var mult = valor / Number(b.valor);
    var arred = Math.round(mult * 100) / 100;
    if (Math.abs(arred - Math.round(arred)) < 0.005) {
      var n = Math.round(arred);
      return { ok: true, txt: n + "× tabela", alerta: n > 1 };
    }
    return { ok: false, txt: "fora da tabela", alerta: true };
  }

  function chaveRub(r) {
    if (r.codigo === "667") {
      var m = String(r.referencia || "").match(/\/\s*(\d+)/);
      return "667/" + (m ? m[1] : r.referencia || "");
    }
    return r.codigo;
  }
  function parear(ra, rs) {
    ra = ra || []; rs = rs || [];
    var linhas = [], usados = {};
    ra.forEach(function (r) {
      var k = chaveRub(r), alvo = null;
      for (var i = 0; i < rs.length; i++) {
        if (!usados[i] && chaveRub(rs[i]) === k) { alvo = i; break; }
      }
      if (alvo !== null) { usados[alvo] = 1; linhas.push({ codigo: r.codigo, ago: r, set: rs[alvo] }); }
      else linhas.push({ codigo: r.codigo, ago: r, set: null });
    });
    rs.forEach(function (r, i) { if (!usados[i]) linhas.push({ codigo: r.codigo, ago: null, set: r }); });
    linhas.sort(function (x, y) {
      var a = (x.set || x.ago), b = (y.set || y.ago);
      if (a.tipo !== b.tipo) return a.tipo === "P" ? -1 : 1;
      return a.codigo.localeCompare(b.codigo);
    });
    return linhas;
  }

  function statusBase(p) {
    if (!p.anterior) return "novo";
    if (Number(p.salario_contratual) !== Number(p.anterior.salario_contratual) || p.funcao !== p.anterior.funcao)
      return "alerta";
    var revisar = false;
    parear(p.anterior.rubricas, p.rubricas).forEach(function (l) {
      if (VARIAVEL[l.codigo]) return;
      var va = l.ago ? Number(l.ago.valor) : null;
      var vs = l.set ? Number(l.set.valor) : null;
      if (va === vs) return;
      var c = confereBeneficio(l.codigo, vs);
      if (c && c.alerta) revisar = true;
    });
    return revisar ? "revisar" : "ok";
  }
  function statusFinal(p) {
    return (p.validacao && p.validacao.status) || statusBase(p);
  }
  var ROTULO = {
    ok: "Conferido", alerta: "Alerta", revisar: "Revisar", novo: "Novo",
    confirmado: "Confirmado", verificar: "Em verificação", corrigido: "Corrigido",
  };

  /* O que interessa comparar é o salário base (rubrica 001), não o total pago:
     vale, empréstimo e adiantamento mudam o líquido todo mês sem que nada no
     contrato tenha mudado. */
  function salarioBase(rubricas) {
    var achou = false, total = 0;
    (rubricas || []).forEach(function (r) {
      if (r.codigo === "001") { total += Number(r.valor); achou = true; }
    });
    return achou ? total : null;
  }

  function correcaoDe(p, cod, ref) {
    return (p.correcoes || []).filter(function (c) {
      return c.codigo === cod && (c.referencia || "") === (ref || "");
    })[0] || null;
  }
  function valorEfetivo(p, rub) {
    if (!rub) return null;
    var c = correcaoDe(p, rub.codigo, rub.referencia);
    return c ? Number(c.valor_corrigido) : Number(rub.valor);
  }

  /* ------------------------------------------------ cabeçalho e indicadores */
  function animarNumero(el, destino) {
    var ini = Number(el.getAttribute("data-count") || 0), t0 = null, dur = 700;
    el.setAttribute("data-count", destino);

    /* aba em segundo plano não roda requestAnimationFrame: o número ficaria
       parado em zero até alguém olhar. Nesses casos vai direto ao valor. */
    var semAnimacao = ini === destino || document.hidden ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (semAnimacao) { el.textContent = destino; return; }

    var garantia = setTimeout(function () { el.textContent = destino; }, dur + 400);
    function passo(t) {
      if (!t0) t0 = t;
      var k = Math.min(1, (t - t0) / dur);
      var e = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(ini + (destino - ini) * e);
      if (k < 1) requestAnimationFrame(passo);
      else { clearTimeout(garantia); el.textContent = destino; }
    }
    requestAnimationFrame(passo);
  }

  /* A competência atual é sempre comparada com a imediatamente anterior:
     ago → set hoje, set → out quando outubro entrar. Quem decide é o banco,
     pela maior competência carregada daquele departamento. */
  function pintarCompetencia() {
    document.getElementById("comp-base").textContent = mesAno(dados.competencia_anterior);
    var sel = document.getElementById("comp-select");
    var lista = dados.competencias || [{ competencia: dados.competencia }];
    sel.innerHTML = lista.map(function (c, i) {
      var iso = String(c.competencia).slice(0, 10);
      return '<option value="' + iso + '"' +
        (iso === String(dados.competencia).slice(0, 10) ? " selected" : "") + ">" +
        mesAno(iso) + (i === 0 ? " (atual)" : "") + "</option>";
    }).join("");

    var proxima = proximoMes();
    sel.title = "Cada mês é conferido contra o anterior. Quando a folha de " +
      proxima.charAt(0).toUpperCase() + proxima.slice(1) +
      " for carregada, a comparação passa sozinha para " + mesAno(dados.competencia) +
      " → " + proxima.charAt(0).toUpperCase() + proxima.slice(1) + ".";
  }

  function pintarTopo() {
    var r = dados.resumo || {};
    pintarCompetencia();

    var cont = { ok: 0, alerta: 0, revisar: 0, novo: 0 };
    dados.colaboradores.forEach(function (p) {
      var s = statusFinal(p);
      if (s === "ok" || s === "confirmado" || s === "corrigido") cont.ok++;
      else if (s === "alerta") cont.alerta++;
      else if (s === "revisar" || s === "verificar") cont.revisar++;
      else cont.novo++;
    });

    var vals = document.querySelectorAll(".kpi .val[data-count]");
    animarNumero(vals[0], cont.ok);
    animarNumero(vals[1], cont.alerta);
    animarNumero(vals[2], cont.revisar);
    animarNumero(vals[3], cont.novo);

    document.getElementById("k-folha").textContent = brl(r.proventos);
    var varPct = r.proventos_anterior ? ((r.proventos / r.proventos_anterior - 1) * 100) : null;
    document.getElementById("k-folha-sub").innerHTML =
      mesAno(dados.competencia_anterior).split("/")[0].toLowerCase() + ": " + brl(r.proventos_anterior) +
      (varPct === null ? "" : ' <span class="up">' + (varPct >= 0 ? "+" : "−") +
        Math.abs(varPct).toFixed(1).replace(".", ",") + "%</span>");
    document.getElementById("k-novo-sub").textContent = "entraram em " + mesAno(dados.competencia).split("/")[0].toLowerCase();

    /* card zerado não precisa gritar: sem alerta, ele fica sóbrio */
    var cards = document.querySelectorAll(".kpi");
    [cont.ok, cont.alerta, cont.revisar, cont.novo].forEach(function (v, i) {
      cards[i].classList.toggle("vazio", v === 0);
    });

    /* a barra mostra a composição da folha, não só o quanto falta */
    var total = dados.colaboradores.length;
    var pend = cont.alerta + cont.revisar;
    document.getElementById("prog-txt").innerHTML =
      pend === 0
        ? "<b>" + total + "</b> colaboradores conferidos, nenhum pendente"
        : "<b>" + (total - pend) + "</b> de <b>" + total + "</b> sem pendência · <b>" + pend + "</b> aguardando você";
    document.getElementById("prog-pct").textContent = Math.round(((total - pend) / total) * 100) + "%";

    var faixas = [
      { chave: "ok", rotulo: "Conferidos", qtd: cont.ok, cor: "var(--green)" },
      { chave: "alerta", rotulo: "Alerta", qtd: cont.alerta, cor: "var(--brand-red-lt)" },
      { chave: "revisar", rotulo: "Revisar", qtd: cont.revisar, cor: "var(--amber)" },
      { chave: "novo", rotulo: "Admissões", qtd: cont.novo, cor: "var(--info)" },
    ].filter(function (f) { return f.qtd > 0; });

    document.getElementById("prog").innerHTML = faixas.map(function (f) {
      return '<i class="s-' + f.chave + '" title="' + f.rotulo + ": " + f.qtd + '"></i>';
    }).join("");
    document.getElementById("prog-legenda").innerHTML = faixas.map(function (f) {
      return '<span><i style="background:' + f.cor + '"></i>' + f.rotulo + " <b>" + f.qtd + "</b></span>";
    }).join("");

    setTimeout(function () {
      var barras = document.querySelectorAll("#prog i");
      faixas.forEach(function (f, i) {
        if (barras[i]) barras[i].style.width = (f.qtd / total) * 100 + "%";
      });
    }, 120);

    document.getElementById("panel-titulo").textContent =
      "Administração — " + dados.colaboradores.length + " colaboradores";
    document.getElementById("panel-sub").textContent =
      "Competência " + mesAno(dados.competencia) + " comparada com " + mesAno(dados.competencia_anterior) +
      " · Lube Distribuidora Ltda · CNPJ 03.447.509/0001-75";

    document.getElementById("rodape").innerHTML =
      "Dados lidos do banco em <b>" + new Date(dados.gerado_em).toLocaleString("pt-BR") +
      "</b> · schema <b>financeiro</b> do DATA WAREHOUSE.";

    document.getElementById("aviso").innerHTML = "";
    avisarPendencia();
  }

  /* ------------------------------------------------ lista */
  function linha(p, i) {
    var st = statusFinal(p), base = statusBase(p);
    var obs = observacaoCurta(p);
    var sbAtual = salarioBase(p.rubricas);
    var sbAnterior = p.anterior ? salarioBase(p.anterior.rubricas) : null;
    var dl = sbAtual !== null && sbAnterior !== null ? sbAtual - sbAnterior : null;
    var dlTxt = dl === null
      ? '<span class="delta flat">admissão</span>'
      : Math.abs(dl) < 0.005
        ? '<span class="delta flat">sem variação</span>'
        : '<span class="delta ' + (dl > 0 ? "up" : "down") + '">' + (dl > 0 ? "▲" : "▼") + " " + num(Math.abs(dl)) + "</span>";
    var fn = (base === "alerta" && p.anterior && p.funcao !== p.anterior.funcao)
      ? esc(p.anterior.funcao) + ' <em>→ ' + esc(p.funcao) + "</em>"
      : esc(p.funcao);
    var ct = (base === "alerta" && p.anterior && Number(p.salario_contratual) !== Number(p.anterior.salario_contratual))
      ? '<div class="a">' + brl(p.salario_contratual) + '</div><div class="b">era ' + brl(p.anterior.salario_contratual) + "</div>"
      : '<div class="a">' + brl(p.salario_contratual) + "</div>";

    return '<div class="prow s-' + base + '" data-i="' + i + '" role="button" tabindex="0" style="animation-delay:' +
      (0.34 + i * 0.022).toFixed(3) + 's">' +
      '<div class="idx mono">' + (i + 1) + "</div>" +
      '<div class="who"><div class="nm">' + esc(p.nome) + '</div><div class="fn">' + fn +
        ' · <span class="mono">' + esc(p.matricula) + "</span></div></div>" +
      '<div class="num mono col-contratual">' + ct + "</div>" +
      '<div class="num mono col-liquido"><div class="a">' + brl(sbAtual) + '</div><div class="b">' +
        (sbAnterior !== null ? brl(sbAnterior) : "—") + "</div></div>" +
      '<div class="num mono col-delta">' + dlTxt + "</div>" +
      '<div class="col-obs">' + (obs
        ? '<span class="etiq ' + obs.tipo + '" title="' + esc(obs.completo) + '">' + esc(obs.texto) + "</span>"
        : '<span class="etiq-vazia">—</span>') + "</div>" +
      '<div class="chip-wrap"><span class="chip ' + st + '">' + ROTULO[st] + "</span></div>" +
      "</div>";
  }

  function render() {
    pintarTopo();
    document.getElementById("rows").innerHTML = dados.colaboradores.map(linha).join("");
  }

  /* ------------------------------------------------ detalhe */
  function cardMini(rot, atual, anterior) {
    var d = anterior == null ? null : Number(atual) - Number(anterior);
    var cls = d === null || Math.abs(d) < 0.005 ? "" : d > 0 ? "up" : "down";
    var txt = anterior == null ? "sem mês anterior"
      : Math.abs(d) < 0.005 ? "igual ao mês anterior"
      : (d > 0 ? "▲ " : "▼ ") + num(Math.abs(d)) + " vs " + num(anterior);
    return '<div class="card"><div class="k">' + rot + '</div><div class="v mono">' + brl(atual) +
      '</div><div class="d ' + cls + '">' + txt + "</div></div>";
  }

  function linhasComparativo(p) {
    var linhas = parear(p.anterior && p.anterior.rubricas, p.rubricas);
    var html = "", secao = "";
    linhas.forEach(function (l, li) {
      var rub = l.set || l.ago;
      var titulo = rub.tipo === "P" ? "Proventos" : "Descontos";
      if (titulo !== secao) {
        secao = titulo;
        html += '<tr class="sub-head"><td colspan="6">' + titulo + "</td></tr>";
      }
      var va = valorEfetivo(p, l.ago), vs = valorEfetivo(p, l.set);
      var dif = va !== null && vs !== null ? vs - va : null;
      var difTxt, cls = "";
      if (va === null) { difTxt = '<span class="d-up">entrou</span>'; cls = "diff"; }
      else if (vs === null) { difTxt = '<span class="d-down">encerrou</span>'; cls = "diff"; }
      else if (Math.abs(dif) < 0.005) difTxt = '<span class="d-flat">—</span>';
      else { difTxt = '<span class="' + (dif > 0 ? "d-up" : "d-down") + '">' + (dif > 0 ? "+ " : "− ") + num(Math.abs(dif)) + "</span>"; cls = "diff"; }

      var tag = "";
      var c = confereBeneficio(l.codigo, vs);
      if (c) tag = '<span class="tag ' + (c.alerta ? "warn" : "good") + '">' + c.txt + "</span>";
      else if (l.codigo === "642" && vs != null && p.salario_contratual) {
        var b = beneficio("642");
        var pct = (vs / Number(p.salario_contratual)) * 100;
        var okPct = b ? Math.abs(pct - Number(b.valor)) < 0.06 : false;
        tag = '<span class="tag ' + (okPct ? "good" : "warn") + '">' + pct.toFixed(1).replace(".", ",") + "% do salário</span>";
      }

      var ref = (l.set && l.set.referencia) || (l.ago && l.ago.referencia) || "";
      var corr = l.set ? correcaoDe(p, l.set.codigo, l.set.referencia) : null;

      function cel(lado, rubr) {
        if (!rubr) return '<td class="mono v-old">—</td>';
        if (lado === "s" && corr)
          return '<td class="mono v-corr">' + num(corr.valor_corrigido) + "<small>folha: " + num(rubr.valor) + "</small></td>";
        return '<td class="mono ' + (lado === "a" ? "v-old" : "v-new") + '">' + num(rubr.valor) + "</td>";
      }

      html += '<tr class="' + cls + '">' +
        '<td class="cod mono">' + esc(l.codigo) + "</td>" +
        '<td class="rub">' + esc(rub.descricao) + (ref ? '<span class="ref mono">' + esc(ref) + "</span>" : "") + tag + "</td>" +
        cel("a", l.ago) + cel("s", l.set) +
        '<td class="mono">' + difTxt + "</td>" +
        '<td class="act">' + (l.set ? '<button class="edit-btn" data-edit="' + li + '" title="Corrigir valor">✎</button>' : "") + "</td>" +
        "</tr>";

      if (editando === li && l.set) {
        html += '<tr class="edit-row"><td colspan="6"><div class="edit-form">' +
          '<div class="fld"><label>Valor correto — ' + mesAno(dados.competencia) + "</label>" +
          '<input id="corr-val" inputmode="decimal" value="' +
            (corr ? String(corr.valor_corrigido).replace(".", ",") : String(l.set.valor).replace(".", ",")) + '"></div>' +
          '<div class="fld"><label>Observação</label><input id="corr-obs" class="wide" ' +
            'placeholder="ex.: cobrança em dobro, ajustado com o DP" value="' + esc(corr ? corr.observacao || "" : "") + '"></div>' +
          '<button class="btn blue small" data-save="' + li + '">Salvar correção</button>' +
          (corr ? '<button class="btn link small" data-undo="' + li + '">Desfazer</button>' : "") +
          '<button class="btn link small" data-cancel="1">Cancelar</button>' +
          "</div></td></tr>";
      }
    });

    function tot(rot, va, vs) {
      var d = va != null && vs != null ? vs - va : null;
      var dt = d === null || Math.abs(d) < 0.005 ? '<span class="d-flat">—</span>'
        : '<span class="' + (d > 0 ? "d-up" : "d-down") + '">' + (d > 0 ? "+ " : "− ") + num(Math.abs(d)) + "</span>";
      return '<tr class="totais"><td></td><td class="rub">' + rot + '</td><td class="mono">' + num(va) +
        '</td><td class="mono">' + num(vs) + '</td><td class="mono">' + dt + "</td><td></td></tr>";
    }
    var a = p.anterior;
    html += '<tr class="sub-head"><td colspan="6">Totais do recibo</td></tr>';
    html += tot("Total de proventos", a ? a.proventos : null, p.proventos);
    html += tot("Total de descontos", a ? a.descontos : null, p.descontos);
    html += tot("Líquido a receber", a ? a.liquido : null, p.liquido);
    return html;
  }

  /* Bases e encargos ficam fora da tabela de rubricas, em bloco próprio:
     é contra eles que se confere se o INSS, o FGTS e o IRRF descontados fecham. */
  function blocoBases(p) {
    var ba = (p.anterior && p.anterior.bases) || {};
    var bs = p.bases || {};
    var mesA = mesAno(dados.competencia_anterior);
    var mesS = mesAno(dados.competencia);

    function cell(rot, va, vs, destaque) {
      var d = va != null && vs != null ? Number(vs) - Number(va) : null;
      var dTxt, dCls;
      if (va == null) { dTxt = "sem mês anterior"; dCls = "flat"; }
      else if (Math.abs(d) < 0.005) { dTxt = "igual ao mês anterior"; dCls = "flat"; }
      else { dTxt = (d > 0 ? "▲ " : "▼ ") + num(Math.abs(d)); dCls = d > 0 ? "up" : "down"; }
      return '<div class="bases-cell' + (destaque ? " destaque" : "") + '">' +
        '<div class="k">' + rot + "</div>" +
        '<div class="linha"><span class="mes">' + mesS + '</span><span class="v">' + num(vs) + "</span></div>" +
        '<div class="linha"><span class="mes">' + mesA + '</span><span class="v old">' + num(va) + "</span></div>" +
        '<div class="d ' + dCls + '">' + dTxt + "</div></div>";
    }

    var aliqIgual = !ba.aliquota || ba.aliquota === bs.aliquota;
    return '<div class="bases">' +
      '<div class="bases-head"><h4>Bases e encargos</h4>' +
      '<span class="hint">É contra estes valores que se confere o que foi descontado no recibo.</span></div>' +
      '<div class="bases-grid">' +
        cell("Base INSS", ba.inss, bs.inss, true) +
        '<div class="bases-cell destaque"><div class="k">Alíquota INSS</div>' +
          '<div class="linha"><span class="mes">' + mesS + '</span><span class="v">' + (bs.aliquota || "—") + "</span></div>" +
          '<div class="linha"><span class="mes">' + mesA + '</span><span class="v old">' + (ba.aliquota || "—") + "</span></div>" +
          '<div class="d ' + (aliqIgual ? "flat" : "up") + '">' + (aliqIgual ? "igual ao mês anterior" : "alterada") + "</div></div>" +
        cell("Base IRRF", ba.irrf, bs.irrf, true) +
        cell("Base FGTS", ba.fgts, bs.fgts) +
        cell("FGTS do mês", ba.fgts_valor, bs.fgts_valor) +
        '<div class="bases-cell"><div class="k">Confere com o recibo</div>' +
          '<div class="linha"><span class="mes">INSS descontado</span><span class="v">' +
            num(somaRubrica(p, "903")) + "</span></div>" +
          '<div class="linha"><span class="mes">IRRF descontado</span><span class="v">' +
            num(somaRubrica(p, "914")) + "</span></div>" +
          '<div class="d flat">linhas 903 e 914 da folha</div></div>' +
      "</div></div>";
  }

  function somaRubrica(p, codigo) {
    var total = 0, achou = false;
    (p.rubricas || []).forEach(function (r) {
      if (r.codigo === codigo) { total += valorEfetivo(p, r); achou = true; }
    });
    return achou ? total : null;
  }

  /* Descreve, em português, tudo o que não fecha na folha da pessoa: contrato,
     salário base e benefício descontado fora da tabela. É o que a aba Observações mostra. */
  function observacoes(p) {
    var lista = [];
    var a = p.anterior;
    var mesA = mesAno(dados.competencia_anterior), mesS = mesAno(dados.competencia);

    if (!a) {
      lista.push({ nivel: "info", titulo: "Admissão nova",
        detalhe: "Primeiro pagamento — não há mês anterior para comparar. " +
          "A partir do mês que vem ele entra na comparação normal." });
    }

    if (a && p.funcao !== a.funcao) {
      lista.push({ nivel: "grave", titulo: "Função alterada",
        detalhe: "Era <b>" + esc(a.funcao) + "</b> em " + mesA + " e passou a <b>" + esc(p.funcao) + "</b> em " + mesS + "." });
    }
    if (a && Number(p.salario_contratual) !== Number(a.salario_contratual)) {
      var dif = Number(p.salario_contratual) - Number(a.salario_contratual);
      var pct = ((p.salario_contratual / a.salario_contratual - 1) * 100).toFixed(1).replace(".", ",");
      lista.push({ nivel: "grave", titulo: "Salário contratual alterado",
        detalhe: "De <b>" + brl(a.salario_contratual) + "</b> para <b>" + brl(p.salario_contratual) + "</b> — " +
          (dif > 0 ? "aumento" : "redução") + " de <b>" + brl(Math.abs(dif)) + "</b> (" + pct + "%)." });
    }

    var sbA = a ? salarioBase(a.rubricas) : null, sbS = salarioBase(p.rubricas);
    if (sbA !== null && sbS !== null && Math.abs(sbS - sbA) > 0.005) {
      var evento = p.evento || (a && a.evento);
      lista.push({
        nivel: evento ? "atencao" : "grave",
        titulo: "Salário base diferente do mês anterior",
        detalhe: "Pago <b>" + brl(sbS) + "</b> em " + mesS + " contra <b>" + brl(sbA) + "</b> em " + mesA +
          " — diferença de <b>" + brl(Math.abs(sbS - sbA)) + "</b>." +
          (evento ? " O evento do mês explica: " + esc(evento) : " <b>Não há férias, atestado nem admissão no mês que justifique.</b>"),
      });
    }

    /* benefícios: o valor descontado precisa ser múltiplo exato do que está na tabela */
    parear(a && a.rubricas, p.rubricas).forEach(function (l) {
      if (VARIAVEL[l.codigo]) return;
      var b = beneficio(l.codigo);
      if (!b) return;

      var vA = l.ago ? valorEfetivo(p, l.ago) : null;
      var vS = l.set ? valorEfetivo(p, l.set) : null;
      var nome = esc((l.set || l.ago).descricao);

      if (b.tipo === "percentual") {
        if (vS != null && p.salario_contratual) {
          var pctReal = (vS / Number(p.salario_contratual)) * 100;
          if (Math.abs(pctReal - Number(b.valor)) > 0.06)
            lista.push({ nivel: "atencao", titulo: nome + " fora do percentual",
              detalhe: "Descontado <b>" + brl(vS) + "</b>, que dá <b>" + pctReal.toFixed(2).replace(".", ",") +
                "%</b> do salário contratual. A tabela diz <b>" + String(b.valor).replace(".", ",") + "%</b>." });
        }
        return;
      }

      var c = confereBeneficio(l.codigo, vS);
      if (vS != null && c && !c.ok) {
        lista.push({ nivel: "atencao", titulo: nome + " com valor fora da tabela",
          detalhe: "Descontado <b>" + brl(vS) + "</b>, que não é múltiplo do valor de referência <b>" +
            brl(b.valor) + "</b>. Confira a tabela de benefícios ou o lançamento no DP." });
      } else if (vS != null && c && c.alerta) {
        var vezes = Math.round(vS / Number(b.valor));
        lista.push({ nivel: "atencao", titulo: nome + " cobrado " + vezes + " vezes",
          detalhe: "Descontado <b>" + brl(vS) + "</b> — <b>" + vezes + "×</b> o valor de referência de <b>" +
            brl(b.valor) + "</b>. A pessoa tem <b>" + p.dep_ir + "</b> dependente(s) de IR declarado(s)." +
            (vA == null ? " E não havia esse desconto em " + mesA + "." : "") });
      }

      if (vA == null && vS != null && (!c || !c.alerta)) {
        lista.push({ nivel: "atencao", titulo: nome + " começou a ser descontado",
          detalhe: "Não existia em " + mesA + " e apareceu em " + mesS + " com <b>" + brl(vS) + "</b>." });
      } else if (vA != null && vS == null) {
        lista.push({ nivel: "atencao", titulo: nome + " deixou de ser descontado",
          detalhe: "Era <b>" + brl(vA) + "</b> em " + mesA + " e não aparece em " + mesS + "." });
      } else if (vA != null && vS != null && Math.abs(vS - vA) > 0.005 && (!c || !c.alerta)) {
        lista.push({ nivel: "atencao", titulo: nome + " mudou de valor",
          detalhe: "De <b>" + brl(vA) + "</b> para <b>" + brl(vS) + "</b> entre " + mesA + " e " + mesS + "." });
      }
    });

    (p.correcoes || []).forEach(function (c) {
      lista.push({ nivel: "info", titulo: "Valor corrigido à mão",
        detalhe: "Rubrica <b>" + esc(c.codigo) + "</b>: a folha trouxe <b>" + brl(c.valor_original) +
          "</b> e foi corrigido para <b>" + brl(c.valor_corrigido) + "</b>." +
          (c.observacao ? " Observação: " + esc(c.observacao) : "") });
    });

    if (p.evento && !lista.some(function (o) { return /salário base/i.test(o.titulo); })) {
      lista.push({ nivel: "info", titulo: "Evento no mês", detalhe: esc(p.evento) });
    }

    return lista;
  }

  var MARCA = { grave: "⛔", atencao: "⚠", info: "ℹ" };

  /* Rótulo curto para a lista. A anotação de quem conferiu tem prioridade; sem ela,
     os motivos viram etiqueta — e uma pessoa pode ter mais de um ao mesmo tempo
     (férias no mês anterior E benefício fora da tabela, por exemplo). */
  function observacaoCurta(p) {
    var anotacao = (p.validacao && p.validacao.observacao || "").trim();
    if (anotacao) return { texto: anotacao, tipo: "anotada", completo: anotacao };

    var motivos = [];
    var detalhes = [];

    function evento(texto, quando) {
      if (!texto) return;
      if (/atestado/i.test(texto)) motivos.push("Atestado");
      else if (/férias|ferias/i.test(texto)) motivos.push("Férias");
      else if (/admitid|admiss/i.test(texto)) motivos.push("Admissão");
      else if (/afastament/i.test(texto)) motivos.push("Afastamento");
      else return;
      detalhes.push(quando + ": " + texto);
    }
    evento(p.evento, mesAno(dados.competencia).split("/")[0]);
    if (p.anterior) evento(p.anterior.evento, mesAno(dados.competencia_anterior).split("/")[0]);

    /* A folha não escreve "admitido neste mês" em lugar nenhum: quem entrou no meio do
       mês aparece só com o salário proporcional. A data de admissão é que conta. */
    var mes = function (d) { return String(d || "").slice(0, 7); };
    var admitidoAgora = mes(p.admissao) === mes(dados.competencia);
    var admitidoAntes = mes(p.admissao) === mes(dados.competencia_anterior);
    if ((admitidoAgora || admitidoAntes || !p.anterior) && motivos.indexOf("Admissão") < 0) {
      motivos.push("Admissão");
      detalhes.push(
        !p.anterior && !admitidoAgora
          ? "Primeiro pagamento desta pessoa"
          : "Admitido em " + dataBR(p.admissao) + ", com o mês pago proporcional"
      );
    }

    var contrato = [];
    if (p.anterior) {
      if (p.funcao !== p.anterior.funcao) contrato.push("Função");
      if (Number(p.salario_contratual) !== Number(p.anterior.salario_contratual)) contrato.push("Salário");
    }
    if (contrato.length) {
      motivos = motivos.concat(contrato);
      detalhes.push("Mudou " + contrato.join(" e ").toLowerCase() + " em relação ao mês anterior");
    }

    if (statusBase(p) === "revisar") {
      motivos.push("Benefício");
      detalhes.push("Benefício descontado fora do valor da tabela");
    }

    if (!motivos.length) return null;

    /* a cor segue o motivo mais grave: contrato é alerta, o resto é atenção */
    var tipo = contrato.length ? "contrato" : "evento";
    var texto = motivos.length === 1
      ? motivos[0]
      : motivos.slice(0, -1).join(", ") + " e " + motivos[motivos.length - 1];

    return { texto: texto, tipo: tipo, completo: detalhes.join("\n") };
  }

  function painelObservacoes(p, obs) {
    var anotacao = (p.validacao && p.validacao.observacao) || "";
    var pendencias = obs.filter(function (o) { return o.nivel !== "info"; });

    var lista = obs.length
      ? '<div class="obs-lista">' + obs.map(function (o) {
          return '<div class="obs-item ' + o.nivel + '"><span class="marca">' + MARCA[o.nivel] + "</span>" +
            '<div><span class="t">' + o.titulo + '</span><span class="d">' + o.detalhe + "</span></div></div>";
        }).join("") + "</div>"
      : '<div class="obs-vazio">Nada fora do lugar: contrato, salário base e benefícios batem com o mês anterior.</div>';

    return '<div class="sec-title">O que o sistema encontrou' +
        (pendencias.length ? " — " + pendencias.length + " ponto(s) a conferir" : "") + "</div>" +
      lista +
      '<div class="sec-title">Sua anotação</div>' +
      '<div class="obs-campo"><label>Fica guardada com a validação desta pessoa nesta competência</label>' +
      '<textarea id="obs-texto" placeholder="ex.: falei com o DP, a assistência veio em dobro por causa da competência anterior que não foi descontada">' +
      esc(anotacao) + "</textarea></div>" +
      '<div class="actions" style="margin-bottom:10px;">' +
        '<button class="btn blue small" data-obs="salvar">Salvar observação</button>' +
        (anotacao ? '<span class="obs-salva">Anotação salva em ' +
          (p.validacao && p.validacao.atualizado_em ? new Date(p.validacao.atualizado_em).toLocaleString("pt-BR") : "—") + "</span>" : "") +
      "</div>";
  }

  function abrirDetalhe(i) { abertoIdx = i; editando = null; abaAtiva = "comparativo"; desenharModal(); }
  function fechar() {
    abertoIdx = null; editando = null;
    document.getElementById("modal-root").innerHTML = "";
    render();
  }

  function desenharModal() {
    var p = dados.colaboradores[abertoIdx];
    var st = statusFinal(p), base = statusBase(p);
    var msg, cls = "";
    if (st === "confirmado") { msg = "✓ <b>Confirmado</b> — vira a referência para a comparação de " + proximoMes() + "."; cls = "good"; }
    else if (st === "verificar") { msg = "⏳ <b>Em verificação</b> — segue pendente até você confirmar."; cls = "warn"; }
    else if (st === "corrigido") { msg = "✎ <b>Corrigido</b> — " + (p.correcoes || []).length + " valor(es) ajustado(s) à mão. Confirme para fechar o mês."; cls = "info"; }
    else if (base === "alerta") { msg = "⚠ <b>Alerta:</b> o contrato mudou de um mês para o outro."; cls = "warn"; }
    else if (base === "revisar") { msg = "⚠ <b>Revisar:</b> benefício descontado fora do valor da tabela."; cls = "warn"; }
    else if (base === "novo") { msg = "★ <b>Admissão nova</b> — sem mês anterior para comparar."; cls = "info"; }
    else { msg = "✓ <b>Conferido</b> — salário contratual e função iguais aos do mês anterior."; cls = "good"; }

    var obs = observacoes(p);
    var eventos = [];
    if (p.anterior && p.anterior.evento) eventos.push(mesAno(dados.competencia_anterior).split("/")[0] + ": " + esc(p.anterior.evento));
    if (p.evento) eventos.push(mesAno(dados.competencia).split("/")[0] + ": " + esc(p.evento));

    var cadastro = "";
    if (base === "alerta") {
      cadastro = '<div class="sec-title">Cadastro</div><div class="scroll-x"><table class="cmp"><thead><tr>' +
        '<th class="w-cod">Cód</th><th>Item</th><th>' + mesAno(dados.competencia_anterior) + "</th><th>" +
        mesAno(dados.competencia) + "</th><th>Diferença</th><th></th></tr></thead><tbody>" +
        (p.funcao !== p.anterior.funcao
          ? '<tr class="diff"><td class="cod">—</td><td class="rub">Função</td><td class="v-old">' + esc(p.anterior.funcao) +
            '</td><td class="v-new">' + esc(p.funcao) + '</td><td><span class="d-up">alterada</span></td><td></td></tr>' : "") +
        (Number(p.salario_contratual) !== Number(p.anterior.salario_contratual)
          ? '<tr class="diff"><td class="cod">—</td><td class="rub">Salário contratual</td><td class="mono v-old">' +
            num(p.anterior.salario_contratual) + '</td><td class="mono v-new">' + num(p.salario_contratual) +
            '</td><td class="mono"><span class="d-up">+ ' + num(p.salario_contratual - p.anterior.salario_contratual) + " (" +
            ((p.salario_contratual / p.anterior.salario_contratual - 1) * 100).toFixed(1).replace(".", ",") +
            "%)</span></td><td></td></tr>" : "") +
        "</tbody></table></div>";
    }

    var botoes = st === "confirmado"
      ? '<button class="btn link" data-status="">Reabrir</button>'
      : '<button class="btn primary" data-status="confirmado">Confirmar</button>' +
        (st !== "verificar" ? '<button class="btn ghost" data-status="verificar">Verificar</button>' : "") +
        ((p.correcoes || []).length ? '<button class="btn blue" data-status="corrigido">Marcar como corrigido</button>' : "");

    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" id="ov"><div class="modal" role="dialog" aria-modal="true" aria-label="Detalhe de ' + esc(p.nome) + '">' +
        '<div class="modal-head"><div>' +
          '<div class="eyebrow">Administrativo · matrícula ' + esc(p.matricula) + "</div>" +
          "<h3>" + esc(p.nome) + "</h3>" +
          '<div class="meta"><span>Função: <b>' + esc(p.funcao) + "</b></span>" +
            "<span>Admissão: <b>" + dataBR(p.admissao) + "</b></span>" +
            '<span>Sal. contratual: <b class="mono">' + brl(p.salario_contratual) + "</b></span>" +
            "<span>Dep. IR: <b>" + p.dep_ir + "</b> · Sal. Família: <b>" + p.dep_sf + "</b></span></div>" +
        "</div><div style=\"display:flex;gap:12px;align-items:center;\">" +
          '<span class="chip ' + st + '">' + ROTULO[st] + "</span>" +
          '<button class="x" id="fechar" aria-label="Fechar">×</button></div></div>' +
        '<div class="modal-body">' +
          (eventos.length
            ? '<div class="evt"><span class="sino">!</span><div><b>Atenção — evento no mês</b>' +
              '<div class="txt">' + eventos.join("<br>") + "</div></div></div>"
            : "") +
          '<div class="abas">' +
            '<button class="aba ' + (abaAtiva === "comparativo" ? "ativa" : "") + '" data-aba="comparativo">Comparativo</button>' +
            '<button class="aba ' + (abaAtiva === "observacoes" ? "ativa" : "") + '" data-aba="observacoes">Observações' +
              (obs.filter(function (o) { return o.nivel !== "info"; }).length
                ? '<span class="qtd">' + obs.filter(function (o) { return o.nivel !== "info"; }).length + "</span>" : "") +
            "</button>" +
          "</div>" +
          (abaAtiva === "comparativo"
            ? '<div class="mini">' +
                cardMini("Proventos", p.proventos, p.anterior ? p.anterior.proventos : null) +
                cardMini("Descontos", p.descontos, p.anterior ? p.anterior.descontos : null) +
                cardMini("Líquido", p.liquido, p.anterior ? p.anterior.liquido : null) +
              "</div>" +
              cadastro +
              '<div class="sec-title">Comparativo completo da folha</div>' +
              '<div class="scroll-x"><table class="cmp"><thead><tr><th class="w-cod">Cód</th><th>Rubrica</th><th>' +
                mesAno(dados.competencia_anterior) + "</th><th>" + mesAno(dados.competencia) +
                "</th><th>Diferença</th><th></th></tr></thead><tbody>" + linhasComparativo(p) + "</tbody></table></div>" +
              blocoBases(p)
            : painelObservacoes(p, obs)) +
        "</div>" +
        '<div class="modal-foot"><div class="foot-msg ' + cls + '">' + msg + "</div>" +
          '<div class="btns">' + botoes + "</div></div>" +
      "</div></div>";

    var ov = document.getElementById("ov");
    ov.addEventListener("click", function (e) { if (e.target === ov) fechar(); });
    document.getElementById("fechar").addEventListener("click", fechar);
    ov.addEventListener("click", aoClicarNoModal);
  }

  function proximoMes() {
    var p = String(dados.competencia).slice(0, 10).split("-");
    var m = Number(p[1]), y = Number(p[0]);
    if (m === 12) { m = 1; y++; } else m++;
    return MES[m - 1] + "/" + y;
  }

  function aoClicarNoModal(e) {
    var t = e.target.closest
      ? e.target.closest("[data-edit],[data-save],[data-undo],[data-cancel],[data-status],[data-aba],[data-obs]")
      : null;
    if (!t) return;
    var p = dados.colaboradores[abertoIdx];

    if (t.hasAttribute("data-aba")) { abaAtiva = t.getAttribute("data-aba"); return desenharModal(); }

    if (t.hasAttribute("data-obs")) {
      var texto = (document.getElementById("obs-texto") || {}).value || "";
      t.disabled = true;
      p.validacao = {
        status: (p.validacao && p.validacao.status) || "verificar",
        observacao: texto,
        atualizado_em: new Date().toISOString(),
      };
      salvar({ tipo: "observacao", matricula: p.matricula, observacao: texto })
        .catch(function (err) {
          console.warn("não salvou no banco:", err.message);
          guardarPendente({ tipo: "observacao", matricula: p.matricula, observacao: texto });
        })
        .then(function () { desenharModal(); render(); });
      return;
    }

    if (t.hasAttribute("data-edit")) { editando = Number(t.getAttribute("data-edit")); return desenharModal(); }
    if (t.hasAttribute("data-cancel")) { editando = null; return desenharModal(); }

    if (t.hasAttribute("data-status")) {
      var v = t.getAttribute("data-status");
      p.validacao = v ? { status: v, atualizado_em: new Date().toISOString() } : null;
      t.disabled = true;
      persistirValidacao(p, v).then(function () { desenharModal(); render(); });
      return;
    }

    var li = Number(t.getAttribute("data-save") || t.getAttribute("data-undo"));
    var linhas = parear(p.anterior && p.anterior.rubricas, p.rubricas);
    var rub = linhas[li].set;
    if (!rub) return;

    if (t.hasAttribute("data-undo")) {
      p.correcoes = (p.correcoes || []).filter(function (c) {
        return !(c.codigo === rub.codigo && (c.referencia || "") === (rub.referencia || ""));
      });
      if (!p.correcoes.length && p.validacao && p.validacao.status === "corrigido") p.validacao = null;
      editando = null;
      persistirCorrecao(p, rub, null, "").then(function () { desenharModal(); render(); });
      return;
    }

    var raw = (document.getElementById("corr-val") || {}).value || "";
    var obs = (document.getElementById("corr-obs") || {}).value || "";
    var valor = parseFloat(String(raw).replace(/\./g, "").replace(",", "."));
    if (isNaN(valor)) { alert("Digite um valor válido, por exemplo 129,33"); return; }

    p.correcoes = (p.correcoes || []).filter(function (c) {
      return !(c.codigo === rub.codigo && (c.referencia || "") === (rub.referencia || ""));
    });
    p.correcoes.push({
      codigo: rub.codigo, referencia: rub.referencia || "",
      valor_original: Number(rub.valor), valor_corrigido: valor, observacao: obs,
    });
    p.validacao = { status: "corrigido", atualizado_em: new Date().toISOString() };
    editando = null;
    t.disabled = true;
    persistirCorrecao(p, rub, valor, obs).then(function () { desenharModal(); render(); });
  }

  function persistirValidacao(p, v) {
    var payload = { tipo: "validacao", matricula: p.matricula, status: v || null };
    return salvar(payload).catch(function (e) {
      console.warn("não salvou no banco:", e.message);
      guardarPendente(payload);
    });
  }
  function persistirCorrecao(p, rub, valor, obs) {
    var payload = {
      tipo: "correcao", matricula: p.matricula, codigo: rub.codigo, referencia: rub.referencia || "",
      valor_original: Number(rub.valor), valor_corrigido: valor, observacao: obs,
      status: p.validacao ? p.validacao.status : null,
    };
    return salvar(payload).catch(function (e) {
      console.warn("não salvou no banco:", e.message);
      guardarPendente(payload);
    });
  }

  /* ------------------------------------------------ configuração */
  function abrirCfg() {
    var linhas = (dados.beneficios || []).map(function (b, i) {
      var uso = b.tipo === "percentual" ? "% sobre o salário base"
        : b.tipo === "unitario" ? "valor por dependente" : "valor por titular";
      return '<tr><td class="mono cod">' + esc(b.codigo) + "</td><td>" + esc(b.descricao) +
        '<div class="cfg-usage">' + uso + '</div></td><td class="tipo">' +
        (b.tipo === "percentual" ? "Percentual" : "Fixo") + '</td><td class="r"><input data-cfg="' + i +
        '" inputmode="decimal" value="' + String(b.valor).replace(".", ",") + '"></td></tr>';
    }).join("");

    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" id="ov-cfg"><div class="modal" style="max-width:680px;" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><div><div class="eyebrow">Configuração</div><h3>Benefícios descontados</h3>' +
        '<div class="meta"><span>Valores de referência usados na validação da folha</span></div></div>' +
        '<button class="x" id="fechar-cfg" aria-label="Fechar">×</button></div>' +
        '<div class="modal-body"><div class="cfg-note">O sistema compara cada desconto de benefício com estes valores. ' +
          "Quando a folha descontar <b>o dobro, o triplo ou um valor fora da tabela</b>, a pessoa aparece como " +
          "<b>Revisar</b> e a rubrica fica marcada no comparativo.</div>" +
          '<div class="scroll-x"><table class="cfg-tbl"><thead><tr><th>Cód</th><th>Benefício</th><th>Tipo</th>' +
          '<th style="text-align:right;">Valor</th></tr></thead><tbody>' + linhas + "</tbody></table></div></div>" +
        '<div class="modal-foot"><div class="foot-msg">Vale para todos os departamentos.</div>' +
          '<div class="btns"><button class="btn primary" id="cfg-salvar">Salvar</button></div></div>' +
      "</div></div>";

    var ov = document.getElementById("ov-cfg");
    ov.addEventListener("click", function (e) { if (e.target === ov) fechar(); });
    document.getElementById("fechar-cfg").addEventListener("click", fechar);
    document.getElementById("cfg-salvar").addEventListener("click", function () {
      var inputs = ov.querySelectorAll("[data-cfg]"), erro = false, novos = [];
      Array.prototype.forEach.call(inputs, function (inp) {
        var v = parseFloat(String(inp.value).replace(/\./g, "").replace(",", "."));
        if (isNaN(v)) { erro = true; return; }
        var b = dados.beneficios[Number(inp.getAttribute("data-cfg"))];
        b.valor = v;
        novos.push({ codigo: b.codigo, valor: v });
      });
      if (erro) { alert("Confira os valores: use o formato 129,33"); return; }
      this.disabled = true;
      salvar({ tipo: "beneficios", beneficios: novos })
        .catch(function (e) {
          console.warn("não salvou no banco:", e.message);
          guardarPendente({ tipo: "beneficios", beneficios: novos });
        })
        .then(fechar);
    });
  }

  /* ------------------------------------------------ importar folha */
  var imp = { arquivo: null, base64: null, previa: null, ocupado: false, erro: null };

  function abrirImportar() {
    var corpo;
    if (imp.ocupado) {
      corpo = '<div class="obs-vazio">Lendo o PDF e conferindo com o resumo da folha…</div>';
    } else if (!imp.previa) {
      corpo =
        (imp.erro ? '<div class="aviso erro" style="margin-bottom:16px;"><span class="ic">⚠</span><div>' + esc(imp.erro) + "</div></div>" : "") +
        '<div class="cfg-note">Escolha o PDF da folha do mês, do jeito que o DP manda. O sistema lê, ' +
        "confere os totais com o <b>resumo impresso na última página</b> e só grava se bater.</div>" +
        (imp.arquivo
          ? '<div class="imp-arquivo"><span>📄</span><div><div class="nome">' + esc(imp.arquivo.name) +
            '</div><div class="tam">' + Math.round(imp.arquivo.size / 1024) + " KB</div></div></div>"
          : "") +
        '<div class="imp-zona" id="imp-zona"><div class="ic">📄</div>' +
        '<div class="t">' + (imp.arquivo ? "Trocar arquivo" : "Clique aqui ou arraste o PDF") + "</div>" +
        '<div class="d">A folha completa do departamento, em PDF</div></div>' +
        '<input type="file" id="imp-file" accept="application/pdf,.pdf" hidden>';
    } else {
      var pv = imp.previa, c = pv.conferencia;
      var cel = function (lido, resumo, inteiro) {
        var ok = resumo === null || Math.abs(Number(lido) - Number(resumo)) < 0.005;
        var f = function (v) { return v === null || v === undefined ? "—" : inteiro ? String(v) : num(v); };
        return '<td class="mono">' + f(lido) + '</td><td class="mono">' + f(resumo) +
          '</td><td class="' + (ok ? "ok" : "nao") + '">' + (ok ? "confere" : "diferente") + "</td>";
      };
      corpo =
        (pv.erros.length
          ? '<div class="aviso erro" style="margin-bottom:16px;"><span class="ic">⚠</span><div><b>Não vou gravar esta folha.</b><br>' +
            pv.erros.map(esc).join("<br>") + "</div></div>"
          : '<div class="aviso" style="margin-bottom:16px;border-color:var(--green-line);background:var(--green-dim);">' +
            '<span class="ic">✓</span><div><b>Tudo confere com o resumo impresso na folha.</b> Pode gravar.</div></div>') +
        '<div class="mini" style="margin-bottom:16px;">' +
          '<div class="card"><div class="k">Competência</div><div class="v">' + esc(pv.competencia_rotulo) + "</div>" +
            '<div class="d">vira o mês atual do painel</div></div>' +
          '<div class="card"><div class="k">Departamento</div><div class="v" style="font-size:15px;">' + esc(pv.departamento) + "</div>" +
            '<div class="d">no PDF: ' + esc(pv.departamento_pdf || "—") + "</div></div>" +
          '<div class="card"><div class="k">Colaboradores</div><div class="v">' + pv.colaboradores + "</div>" +
            '<div class="d">' + pv.rubricas + " rubricas lidas</div></div>" +
        "</div>" +
        '<div class="sec-title">Conferência contra o resumo da folha</div>' +
        '<div class="scroll-x"><table class="conf-tbl"><thead><tr><th>Item</th><th>Lido do PDF</th>' +
        "<th>Resumo impresso</th><th>Situação</th></tr></thead><tbody>" +
          '<tr><td class="rot">Colaboradores</td>' + cel(c.pessoas_lidas, c.pessoas_resumo, true) + "</tr>" +
          '<tr><td class="rot">Total de proventos</td>' + cel(c.proventos_lidos, c.proventos_resumo) + "</tr>" +
          '<tr><td class="rot">Total de descontos</td>' + cel(c.descontos_lidos, c.descontos_resumo) + "</tr>" +
          '<tr><td class="rot">Total líquido</td>' + cel(c.liquido_lido, c.liquido_resumo) + "</tr>" +
        "</tbody></table></div>" +
        (pv.ja_existe && pv.ja_existe.colaboradores
          ? '<div class="aviso" style="margin-top:16px;"><span class="ic">⚠</span><div><b>Já existe folha carregada para ' +
            esc(pv.competencia_rotulo) + ".</b> Gravar substitui os " + pv.ja_existe.colaboradores + " registros." +
            (pv.ja_existe.validacoes || pv.ja_existe.correcoes
              ? " As <b>" + pv.ja_existe.validacoes + " validação(ões)</b> e <b>" + pv.ja_existe.correcoes +
                " correção(ões)</b> já feitas continuam valendo."
              : "") + "</div></div>"
          : "");
    }

    var rodape = imp.previa && !imp.ocupado
      ? '<button class="btn link" data-imp="voltar">Escolher outro</button>' +
        (imp.previa.pode_gravar ? '<button class="btn primary" data-imp="gravar">Gravar no banco</button>' : "")
      : "";

    document.getElementById("modal-root").innerHTML =
      '<div class="overlay" id="ov-imp"><div class="modal" style="max-width:760px;" role="dialog" aria-modal="true">' +
        '<div class="modal-head"><div><div class="eyebrow">Folha de pagamento</div><h3>Importar folha do mês</h3>' +
        '<div class="meta"><span>O PDF do DP entra direto no sistema</span></div></div>' +
        '<button class="x" id="fechar-imp" aria-label="Fechar">×</button></div>' +
        '<div class="modal-body">' + corpo + "</div>" +
        (rodape ? '<div class="modal-foot"><div class="foot-msg"></div><div class="btns">' + rodape + "</div></div>" : "") +
      "</div></div>";

    var ov = document.getElementById("ov-imp");
    ov.addEventListener("click", function (e) { if (e.target === ov) fecharImportar(); });
    document.getElementById("fechar-imp").addEventListener("click", fecharImportar);

    var zona = document.getElementById("imp-zona");
    var input = document.getElementById("imp-file");
    if (zona && input) {
      zona.addEventListener("click", function () { input.click(); });
      input.addEventListener("change", function () { if (this.files[0]) receberArquivo(this.files[0]); });
      ["dragenter", "dragover"].forEach(function (ev) {
        zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.add("sobre"); });
      });
      ["dragleave", "drop"].forEach(function (ev) {
        zona.addEventListener(ev, function (e) { e.preventDefault(); zona.classList.remove("sobre"); });
      });
      zona.addEventListener("drop", function (e) {
        if (e.dataTransfer.files[0]) receberArquivo(e.dataTransfer.files[0]);
      });
    }

    ov.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-imp]") : null;
      if (!t) return;
      if (t.getAttribute("data-imp") === "voltar") { imp.previa = null; return abrirImportar(); }
      if (t.getAttribute("data-imp") === "gravar") { t.disabled = true; gravarImportacao(); }
    });
  }

  function fecharImportar() {
    imp = { arquivo: null, base64: null, previa: null, ocupado: false, erro: null };
    document.getElementById("modal-root").innerHTML = "";
  }

  function receberArquivo(file) {
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      imp.erro = "Esse arquivo não é um PDF.";
      return abrirImportar();
    }
    imp.arquivo = file; imp.erro = null; imp.ocupado = true;
    abrirImportar();

    var leitor = new FileReader();
    leitor.onload = function () {
      imp.base64 = String(leitor.result).replace(/^data:[^,]+,/, "");
      enviarImportacao("previa");
    };
    leitor.onerror = function () {
      imp.ocupado = false; imp.erro = "Não consegui ler o arquivo do seu computador."; abrirImportar();
    };
    leitor.readAsDataURL(file);
  }

  function enviarImportacao(modo) {
    return fetch("api/importar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ arquivo: imp.base64, modo: modo, departamento: imp.previa ? imp.previa.departamento : null }),
    })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        imp.ocupado = false;
        if (!res.ok && !res.j.conferencia) throw new Error(res.j.erro || "falha ao ler o PDF");
        imp.previa = res.j;
        return res.j;
      })
      .catch(function (e) {
        imp.ocupado = false; imp.previa = null;
        imp.erro = "Não consegui ler esse PDF: " + e.message;
      })
      .then(abrirImportar);
  }

  function gravarImportacao() {
    imp.ocupado = true;
    abrirImportar();
    enviarImportacao("gravar").then(function () {
      if (imp.previa && imp.previa.gravado) {
        competenciaEscolhida = null;
        fecharImportar();
        document.getElementById("rows").innerHTML = '<div class="carregando">Carregando a folha…</div>';
        carregar().then(render);
      }
    });
  }

  /* ------------------------------------------------ eventos */
  document.getElementById("rows").addEventListener("click", function (e) {
    var row = e.target.closest(".prow");
    if (row) abrirDetalhe(Number(row.getAttribute("data-i")));
  });
  document.getElementById("rows").addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var row = e.target.closest(".prow");
    if (row) { e.preventDefault(); abrirDetalhe(Number(row.getAttribute("data-i"))); }
  });
  document.getElementById("open-cfg").addEventListener("click", function () { if (dados) abrirCfg(); });
  document.getElementById("open-imp").addEventListener("click", abrirImportar);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") fechar(); });

  document.getElementById("comp-select").addEventListener("change", function () {
    competenciaEscolhida = this.value;
    document.getElementById("rows").innerHTML = '<div class="carregando">Carregando a folha…</div>';
    carregar().then(render);
  });

  var side = document.getElementById("side");
  document.getElementById("menu-btn").addEventListener("click", function () { side.classList.toggle("aberto"); });
  document.getElementById("veu").addEventListener("click", function () { side.classList.remove("aberto"); });

  carregar().then(render).catch(function (e) {
    document.getElementById("rows").innerHTML =
      '<div class="carregando">Não consegui ler a folha no banco.<br><br>' +
      "<b>" + esc(e.message) + "</b></div>";
    document.getElementById("aviso").innerHTML =
      '<div class="aviso erro"><span class="ic">⚠</span><div><b>O painel está sem dados.</b> ' +
      "Ele lê a folha do schema <b>financeiro</b> no Supabase, e a conexão não respondeu. " +
      "Verifique se <b>SUPABASE_DB_PASSWORD</b> e <b>SUPABASE_DB_USER</b> estão cadastradas nas " +
      "variáveis de ambiente do projeto na Vercel.</div></div>";
  });
})();
