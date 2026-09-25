/* Validação de Folha — painel do Sistema Financeiro da Lube.
   Lê de /api/dados (função financeiro.painel_dados no Supabase).
   Sem conexão com o banco, cai no snapshot embutido e diz isso na tela. */
(function () {
  "use strict";

  var DEP = "ADMINISTRATIVO";
  var LS = "folha-lube-offline-";
  var dados = null;
  var offline = false;
  var abertoIdx = null;
  var editando = null;
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
        dados = j; offline = false;
      })
      .catch(function (e) {
        if (!window.__SNAPSHOT__) throw e;
        dados = JSON.parse(JSON.stringify(window.__SNAPSHOT__));
        offline = true;
        aplicarLocal();
        console.warn("API indisponível, usando snapshot embutido:", e.message);
      });
  }

  /* quando o banco não responde, as ações ficam no navegador */
  function aplicarLocal() {
    var v = ls("validacao-" + DEP) || {};
    var c = ls("correcao-" + DEP) || {};
    var b = ls("beneficios");
    dados.colaboradores.forEach(function (p) {
      if (v[p.matricula]) p.validacao = v[p.matricula];
      if (c[p.matricula]) p.correcoes = c[p.matricula];
    });
    if (b) dados.beneficios = b;
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
    /* sem banco só existe a competência do snapshot; trocar de mês exige a API */
    sel.disabled = offline;
    sel.title = offline ? "Escolher outro mês precisa da conexão com o banco" : "";
    var lista = dados.competencias || [{ competencia: dados.competencia }];
    sel.innerHTML = lista.map(function (c, i) {
      var iso = String(c.competencia).slice(0, 10);
      return '<option value="' + iso + '"' +
        (iso === String(dados.competencia).slice(0, 10) ? " selected" : "") + ">" +
        mesAno(iso) + (i === 0 ? " (atual)" : "") + "</option>";
    }).join("");

    var proxima = proximoMes();
    document.getElementById("regra").innerHTML =
      "<span>🔁</span><div>Cada mês é conferido contra o anterior. Agora é <b>" +
      mesAno(dados.competencia_anterior) + " → " + mesAno(dados.competencia) +
      "</b>; quando a folha de " + proxima.charAt(0).toUpperCase() + proxima.slice(1) +
      " for carregada, o painel passa sozinho para <b>" + mesAno(dados.competencia) + " → " +
      proxima.charAt(0).toUpperCase() + proxima.slice(1) +
      "</b>, e o que você confirmar agora vira a referência dessa comparação.</div>";
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

    var total = dados.colaboradores.length;
    var pend = cont.alerta + cont.revisar;
    document.getElementById("prog-txt").innerHTML =
      pend === 0
        ? "<b>Tudo conferido</b> — nenhum colaborador pendente nesta competência."
        : "<b>" + (total - pend) + " de " + total + "</b> colaboradores sem pendência · <b>" + pend + "</b> aguardando você";
    setTimeout(function () {
      document.getElementById("prog-bar").style.width = Math.round(((total - pend) / total) * 100) + "%";
    }, 120);

    document.getElementById("panel-titulo").textContent =
      "Administração — " + dados.colaboradores.length + " colaboradores";
    document.getElementById("panel-sub").textContent =
      "Competência " + mesAno(dados.competencia) + " comparada com " + mesAno(dados.competencia_anterior) +
      " · Lube Distribuidora Ltda · CNPJ 03.447.509/0001-75";

    document.getElementById("rodape").innerHTML = offline
      ? "Mostrando o <b>snapshot embutido de 24/09/2026</b>. As marcações ficam salvas só neste navegador."
      : "Dados lidos do banco em <b>" + new Date(dados.gerado_em).toLocaleString("pt-BR") +
        "</b> · schema <b>financeiro</b> do DATA WAREHOUSE.";

    document.getElementById("aviso").innerHTML = offline
      ? '<div class="aviso erro"><span class="ic">⚠</span><div><b>Sem conexão com o banco.</b> ' +
        "O painel está mostrando o snapshot gravado no próprio arquivo, e o que você confirmar fica só neste navegador. " +
        "Falta cadastrar <b>SUPABASE_DB_PASSWORD</b> nas variáveis de ambiente da Vercel.</div></div>"
      : "";
  }

  /* ------------------------------------------------ lista */
  function linha(p, i) {
    var st = statusFinal(p), base = statusBase(p);
    var dl = p.anterior ? Number(p.liquido) - Number(p.anterior.liquido) : null;
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
      '<div class="num mono col-liquido"><div class="a">' + brl(p.liquido) + '</div><div class="b">' +
        (p.anterior ? brl(p.anterior.liquido) : "—") + "</div></div>" +
      '<div class="num mono col-delta">' + dlTxt + "</div>" +
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

  function abrirDetalhe(i) { abertoIdx = i; editando = null; desenharModal(); }
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

    var eventos = [];
    if (p.anterior && p.anterior.evento) eventos.push("<b>" + mesAno(dados.competencia_anterior).split("/")[0] + ":</b> " + esc(p.anterior.evento));
    if (p.evento) eventos.push("<b>" + mesAno(dados.competencia).split("/")[0] + ":</b> " + esc(p.evento));

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
          (eventos.length ? '<div class="evt"><span>ℹ</span><div>' + eventos.join("<br>") + "</div></div>" : "") +
          '<div class="mini">' +
            cardMini("Proventos", p.proventos, p.anterior ? p.anterior.proventos : null) +
            cardMini("Descontos", p.descontos, p.anterior ? p.anterior.descontos : null) +
            cardMini("Líquido", p.liquido, p.anterior ? p.anterior.liquido : null) +
          "</div>" +
          cadastro +
          '<div class="sec-title">Comparativo completo da folha</div>' +
          '<div class="scroll-x"><table class="cmp"><thead><tr><th class="w-cod">Cód</th><th>Rubrica</th><th>' +
            mesAno(dados.competencia_anterior) + "</th><th>" + mesAno(dados.competencia) +
            "</th><th>Diferença</th><th></th></tr></thead><tbody>" + linhasComparativo(p) + "</tbody></table></div>" +
          blocoBases(p) +
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
    var t = e.target.closest ? e.target.closest("[data-edit],[data-save],[data-undo],[data-cancel],[data-status]") : null;
    if (!t) return;
    var p = dados.colaboradores[abertoIdx];

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

  function guardaLocal(chave, matricula, valor) {
    var m = ls(chave + "-" + DEP) || {};
    if (valor === null) delete m[matricula]; else m[matricula] = valor;
    ls(chave + "-" + DEP, m);
  }

  function persistirValidacao(p, v) {
    guardaLocal("validacao", p.matricula, v ? p.validacao : null);
    if (offline) return Promise.resolve();
    return salvar({ tipo: "validacao", matricula: p.matricula, status: v || null })
      .catch(function (e) { console.warn("não salvou no banco:", e.message); });
  }
  function persistirCorrecao(p, rub, valor, obs) {
    guardaLocal("correcao", p.matricula, p.correcoes && p.correcoes.length ? p.correcoes : null);
    guardaLocal("validacao", p.matricula, p.validacao);
    if (offline) return Promise.resolve();
    return salvar({
      tipo: "correcao", matricula: p.matricula, codigo: rub.codigo, referencia: rub.referencia || "",
      valor_original: Number(rub.valor), valor_corrigido: valor, observacao: obs,
      status: p.validacao ? p.validacao.status : null,
    }).catch(function (e) { console.warn("não salvou no banco:", e.message); });
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
      ls("beneficios", dados.beneficios);
      this.disabled = true;
      var fim = function () { fechar(); };
      if (offline) return fim();
      salvar({ tipo: "beneficios", beneficios: novos }).then(fim).catch(function (e) {
        console.warn("não salvou no banco:", e.message); fim();
      });
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
