"use strict";

const APP_VERSION = "v2.1.0";
const STORAGE_KEY = "custos_dashboard_v2";
const LEGACY_KEY = "custos_dashboard_v1";
const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const clamp = (n, min, max) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function parseNumberBR(value) {
  if (value == null) return 0;
  let s = String(value).trim().replace(/\s/g, "").replace(/R\$/gi, "").replace(/%/g, "");
  if (!s) return 0;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    const parts = s.split(".");
    const decimal = parts.pop();
    s = parts.join("") + "." + decimal;
  }
  s = s.replace(/[^0-9+\-.]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(n, decimals = 2) {
  if (!Number.isFinite(Number(n))) return "0";
  return Number(n).toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}
function formatMoneyInput(n) { return Number(n || 0).toFixed(2).replace(".", ","); }
function normalizeUnit(unit) {
  if (unit === "kg" || unit === "g") return { base: "g", factor: unit === "kg" ? 1000 : 1 };
  if (unit === "l" || unit === "ml") return { base: "ml", factor: unit === "l" ? 1000 : 1 };
  return { base: "un", factor: 1 };
}
function displayUnit(unit) { return normalizeUnit(unit).base; }
function unitCost(price, qty, unit) {
  const totalBase = Number(qty) * normalizeUnit(unit).factor;
  return totalBase > 0 ? Number(price) / totalBase : 0;
}
function dateLabel(ts) {
  try { return new Date(ts).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }); }
  catch { return "—"; }
}

const state = {
  items: [],
  recipe: [],
  pricing: { portions: 1, margin: 20, extra: 0, sale: 0, feePercent: 0, channel: "counter" },
  models: [],
  productName: "",
};

let editingItemId = null;
let editingRecipeId = null;
let modalResolver = null;
let lastFocused = null;

const els = {
  formItem: $("formItem"), itemNome: $("itemNome"), itemUnidadeCompra: $("itemUnidadeCompra"), itemPrecoTotal: $("itemPrecoTotal"), itemQtdCompra: $("itemQtdCompra"), ingredientList: $("ingredientList"), itemCount: $("itemCount"), ingredientManager: $("ingredientManager"), btnDemo: $("btnDemo"),
  formUso: $("formUso"), usoItem: $("usoItem"), usoQtd: $("usoQtd"), usoUnit: $("usoUnit"), recipeList: $("recipeList"),
  productName: $("productName"), numPorcoes: $("numPorcoes"), salesChannel: $("salesChannel"), feeField: $("feeField"), feeLabel: $("feeLabel"), feeHelp: $("feeHelp"), feePercent: $("feePercent"), taxaExtra: $("taxaExtra"), margemLucro: $("margemLucro"), precoVenda: $("precoVenda"),
  summaryCost: $("summaryCost"), summaryPrice: $("summaryPrice"), summaryProfit: $("summaryProfit"), kpiCustoTotal: $("kpiCustoTotal"), costTotalHelp: $("costTotalHelp"),
  resultSuggested: $("resultSuggested"), resultSubtitle: $("resultSubtitle"), resultCost: $("resultCost"), resultFeeRow: $("resultFeeRow"), resultFeeLabel: $("resultFeeLabel"), resultFee: $("resultFee"), resultNet: $("resultNet"), resultProfit: $("resultProfit"), breakEvenPrice: $("breakEvenPrice"), priceStatus: $("priceStatus"),
  currentPriceAnalysis: $("currentPriceAnalysis"), currentAnalysisIcon: $("currentAnalysisIcon"), currentAnalysisTitle: $("currentAnalysisTitle"), currentAnalysisText: $("currentAnalysisText"), currentProfit: $("currentProfit"), currentMargin: $("currentMargin"),
  detailIngredients: $("detailIngredients"), detailExtra: $("detailExtra"), detailFeePercent: $("detailFeePercent"), detailProfitPercent: $("detailProfitPercent"),
  modelName: $("modelName"), modelNameErr: $("modelNameErr"), btnSaveModel: $("btnSaveModel"), modelsList: $("modelsList"),
  saveStatus: $("saveStatus"), btnHelp: $("btnHelp"), btnExport: $("btnExport"), fileImport: $("fileImport"), btnReset: $("btnReset"), appVersion: $("appVersion"),
  modalRoot: $("modalRoot"), modalDialog: document.querySelector(".modal__dialog"), modalTitle: $("modalTitle"), modalDesc: $("modalDesc"), modalActions: $("modalActions"),
};

function defaultPricing() { return { portions: 1, margin: 20, extra: 0, sale: 0, feePercent: 0, channel: "counter" }; }

function normalizeState(raw) {
  const out = { items: [], recipe: [], pricing: defaultPricing(), models: [], productName: String(raw?.productName || "").slice(0, 80) };
  if (!raw || typeof raw !== "object") return out;
  const allowedUnits = new Set(["kg", "g", "l", "ml", "un"]);

  if (Array.isArray(raw.items)) {
    out.items = raw.items.map((it) => {
      const name = String(it?.name || "").trim();
      const unitBuy = allowedUnits.has(it?.unitBuy) ? it.unitBuy : "g";
      const priceTotal = Number(it?.priceTotal);
      const qtyBought = Number(it?.qtyBought);
      if (!name || !(priceTotal >= 0) || !(qtyBought > 0)) return null;
      return { id: String(it?.id || uid()), name, unitBuy, priceTotal, qtyBought, unitCostBase: unitCost(priceTotal, qtyBought, unitBuy) };
    }).filter(Boolean);
  }

  const ids = new Set(out.items.map((x) => x.id));
  if (Array.isArray(raw.recipe)) {
    out.recipe = raw.recipe.map((r) => {
      const itemId = String(r?.itemId || "");
      const qtyUsedBase = Number(r?.qtyUsedBase);
      const item = out.items.find((x) => x.id === itemId);
      if (!ids.has(itemId) || !(qtyUsedBase > 0) || !item) return null;
      return { id: String(r?.id || uid()), itemId, qtyUsedBase, cost: qtyUsedBase * item.unitCostBase };
    }).filter(Boolean);
  }

  const p = raw.pricing && typeof raw.pricing === "object" ? raw.pricing : {};
  let margin = Number(p.margin);
  // Na versão anterior "margin" podia ser markup. Para não trazer 70% como alvo de lucro por engano,
  // mantemos valores plausíveis de margem e usamos 20% quando o dado antigo era markup.
  if (p.method === "markup" && margin > 50) margin = 20;
  out.pricing = {
    portions: Math.max(1, Math.floor(Number(p.portions) || 1)),
    margin: clamp(Number.isFinite(margin) ? margin : 20, 0, 90),
    extra: Math.max(0, Number(p.extra) || 0),
    sale: Math.max(0, Number(p.sale) || 0),
    feePercent: clamp(Number(p.feePercent) || 0, 0, 95),
    channel: ["counter", "whatsapp", "ifood", "marketplace"].includes(p.channel) ? p.channel : ((Number(p.feePercent) || 0) > 0 ? "marketplace" : "counter"),
  };

  if (Array.isArray(raw.models)) {
    out.models = raw.models.map((m) => {
      const name = String(m?.name || "").trim();
      if (!name) return null;
      const modelItems = Array.isArray(m.items) ? m.items.map((it) => {
        const n = String(it?.name || "").trim();
        const u = allowedUnits.has(it?.unitBuy) ? it.unitBuy : "g";
        const pt = Number(it?.priceTotal), qb = Number(it?.qtyBought);
        if (!n || !(pt >= 0) || !(qb > 0)) return null;
        return { name: n, unitBuy: u, priceTotal: pt, qtyBought: qb, unitCostBase: unitCost(pt, qb, u) };
      }).filter(Boolean) : [];
      const modelRecipe = Array.isArray(m.recipe) ? m.recipe.map((r) => ({ itemKey: String(r?.itemKey || "").trim(), qtyUsedBase: Number(r?.qtyUsedBase) })).filter((r) => r.itemKey && r.qtyUsedBase > 0) : [];
      const mp = m.pricing || {};
      let mm = Number(mp.margin);
      if (mp.method === "markup" && mm > 50) mm = 20;
      return {
        id: String(m?.id || uid()), name, createdAt: Number(m?.createdAt) || Date.now(), items: modelItems, recipe: modelRecipe,
        pricing: { portions: Math.max(1, Math.floor(Number(mp.portions) || 1)), margin: clamp(Number.isFinite(mm) ? mm : 20, 0, 90), extra: Math.max(0, Number(mp.extra) || 0), sale: Math.max(0, Number(mp.sale) || 0), feePercent: clamp(Number(mp.feePercent) || 0, 0, 95), channel: ["counter", "whatsapp", "ifood", "marketplace"].includes(mp.channel) ? mp.channel : ((Number(mp.feePercent) || 0) > 0 ? "marketplace" : "counter") },
        productName: String(m?.productName || m?.name || "").slice(0, 80),
      };
    }).filter(Boolean);
  }
  return out;
}

function load() {
  let raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) raw = localStorage.getItem(LEGACY_KEY);
  if (!raw) return;
  try { Object.assign(state, normalizeState(JSON.parse(raw))); } catch (_) {}
}
function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const now = new Date();
  els.saveStatus.textContent = `Salvo às ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function openModal({ title, body, actions = [{ label: "Fechar", value: true, className: "btn btn--dark" }] }) {
  lastFocused = document.activeElement;
  els.modalTitle.textContent = title;
  els.modalDesc.innerHTML = "";
  els.modalActions.innerHTML = "";
  if (typeof body === "string") { const p = document.createElement("p"); p.textContent = body; els.modalDesc.appendChild(p); }
  else if (body instanceof Node) els.modalDesc.appendChild(body);
  actions.forEach((a) => {
    const b = document.createElement("button"); b.type = "button"; b.className = a.className || "btn btn--ghost"; b.textContent = a.label; b.addEventListener("click", () => closeModal(a.value)); els.modalActions.appendChild(b);
  });
  els.modalRoot.hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => els.modalDialog.focus());
  return new Promise((resolve) => { modalResolver = resolve; });
}
function closeModal(value = null) {
  els.modalRoot.hidden = true; document.body.style.overflow = "";
  const resolve = modalResolver; modalResolver = null;
  if (lastFocused?.focus) requestAnimationFrame(() => lastFocused.focus());
  if (resolve) resolve(value);
}
async function confirmModal(message, title = "Confirmar") {
  return Boolean(await openModal({ title, body: message, actions: [{ label: "Cancelar", value: false, className: "btn btn--ghost" }, { label: "Confirmar", value: true, className: "btn btn--dark" }] }));
}
function showFieldError(input, message) {
  const field = input.closest(".field"); if (field) field.classList.toggle("is-error", Boolean(message));
  const err = input.id === "itemNome" ? $("itemNomeErr") : input.id === "itemPrecoTotal" ? $("itemPrecoErr") : input.id === "itemQtdCompra" ? $("itemQtdErr") : input.id === "usoItem" ? $("usoItemErr") : input.id === "usoQtd" ? $("usoQtdErr") : input.id === "feePercent" ? $("feeErr") : input.id === "margemLucro" ? $("margemErr") : null;
  if (err) err.textContent = message || "";
}
function clearErrors() { document.querySelectorAll(".field.is-error").forEach((x) => x.classList.remove("is-error")); document.querySelectorAll(".error").forEach((x) => x.textContent = ""); }

function getRecipeCost() { return state.recipe.reduce((sum, r) => sum + (Number(r.cost) || 0), 0); }
function getPricing() {
  const portions = Math.max(1, Math.floor(parseNumberBR(els.numPorcoes.value) || 1));
  const extra = Math.max(0, parseNumberBR(els.taxaExtra.value));
  const margin = clamp(parseNumberBR(els.margemLucro.value), 0, 90);
  const sale = Math.max(0, parseNumberBR(els.precoVenda.value));
  const feePercent = clamp(parseNumberBR(els.feePercent.value), 0, 95);
  const appliedFeePercent = ["ifood", "marketplace"].includes(els.salesChannel.value) ? feePercent : 0;
  return { portions, extra, margin, sale, feePercent, appliedFeePercent, channel: els.salesChannel.value };
}
function calculate() {
  const p = getPricing();
  const ingredientsTotal = getRecipeCost();
  const ingredientsPer = ingredientsTotal / p.portions;
  // "Outros custos" é informado por venda/unidade; não deve ser diluído pelo rendimento da receita.
  const costPer = ingredientsPer + p.extra;
  const costTotal = ingredientsTotal + (p.extra * p.portions);
  const feeRate = p.appliedFeePercent / 100;
  const profitRate = p.margin / 100;
  const denominator = 1 - feeRate - profitRate;
  const exactSuggested = costPer > 0 && denominator > 0 ? costPer / denominator : 0;
  // Arredonda para cima em passos de R$ 0,10 para nunca reduzir a margem escolhida.
  const suggested = exactSuggested > 0 ? Math.ceil((exactSuggested - 1e-9) * 10) / 10 : 0;
  const feeValue = suggested * feeRate;
  const netAfterFee = suggested - feeValue;
  const profit = suggested - feeValue - costPer;
  const breakEven = costPer > 0 && (1 - feeRate) > 0 ? costPer / (1 - feeRate) : 0;
  const saleFee = p.sale * feeRate;
  const saleProfit = p.sale > 0 ? p.sale - saleFee - costPer : 0;
  const saleMargin = p.sale > 0 ? (saleProfit / p.sale) * 100 : 0;
  return { ...p, ingredientsTotal, ingredientsPer, costTotal, costPer, exactSuggested, suggested, feeValue, netAfterFee, profit, breakEven, saleFee, saleProfit, saleMargin, valid: denominator > 0 };
}

function channelName(channel) {
  return channel === "ifood" ? "iFood" : channel === "marketplace" ? "marketplace" : channel === "whatsapp" ? "WhatsApp" : "balcão";
}
function renderChannel() {
  const channel = els.salesChannel.value;
  const hasFee = channel === "ifood" || channel === "marketplace";
  els.feeField.hidden = !hasFee;
  els.resultFeeRow.hidden = !hasFee;
  els.feeLabel.textContent = channel === "ifood" ? "Taxa total do iFood" : "Taxa total do aplicativo";
  els.resultFeeLabel.textContent = channel === "ifood" ? "Taxa do iFood" : "Taxa do aplicativo";
  els.feeHelp.textContent = channel === "ifood" ? "Use a taxa total do seu plano/contrato. A ferramenta não presume uma taxa fixa." : "Informe a comissão percentual cobrada pelo aplicativo.";
}

function renderRecipeSelect() {
  const selected = els.usoItem.value;
  els.usoItem.innerHTML = '<option value="" disabled>Selecione um item cadastrado</option>' + state.items.map((it) => `<option value="${escapeHtml(it.id)}">${escapeHtml(it.name)} · ${brl.format(it.unitCostBase)}/${displayUnit(it.unitBuy)}</option>`).join("");
  if (state.items.some((it) => it.id === selected)) els.usoItem.value = selected; else els.usoItem.value = "";
  updateUsageUnit();
}
function updateUsageUnit() {
  const it = state.items.find((x) => x.id === els.usoItem.value);
  els.usoUnit.textContent = it ? displayUnit(it.unitBuy) : "g/ml/un";
}

function renderRecipe() {
  if (!state.recipe.length) {
    els.recipeList.innerHTML = '<div class="empty-state">Nenhum ingrediente adicionado. Se ainda não cadastrou os preços de compra, abra “Gerenciar ingredientes e embalagens”.</div>';
    return;
  }
  els.recipeList.innerHTML = state.recipe.map((r) => {
    const it = state.items.find((x) => x.id === r.itemId);
    if (!it) return "";
    if (editingRecipeId === r.id) {
      return `<div class="recipe-row" data-recipe-id="${r.id}"><div class="recipe-row__main"><strong>${escapeHtml(it.name)}</strong><small>Editando quantidade em ${displayUnit(it.unitBuy)}</small></div><input class="edit-qty" data-edit-recipe="${r.id}" value="${formatNumber(r.qtyUsedBase, 3)}" inputmode="decimal" style="width:110px;height:36px"/><div class="row-actions"><button class="icon-btn" data-action="save-recipe" data-id="${r.id}" title="Salvar">✓</button><button class="icon-btn" data-action="cancel-recipe" data-id="${r.id}" title="Cancelar">×</button></div></div>`;
    }
    return `<div class="recipe-row"><div class="recipe-row__main"><strong>${escapeHtml(it.name)}</strong><small>${formatNumber(r.qtyUsedBase, 3)} ${displayUnit(it.unitBuy)}</small></div><strong class="recipe-row__cost">${brl.format(r.cost)}</strong><div class="row-actions"><button class="icon-btn" data-action="edit-recipe" data-id="${r.id}" title="Editar">✎</button><button class="icon-btn icon-btn--danger" data-action="delete-recipe" data-id="${r.id}" title="Remover">×</button></div></div>`;
  }).join("");
}

function renderIngredients() {
  els.itemCount.textContent = `${state.items.length} ${state.items.length === 1 ? "item" : "itens"}`;
  if (!state.items.length) {
    els.ingredientList.innerHTML = '<div class="empty-state">Cadastre seu primeiro ingrediente informando quanto pagou e quanto comprou.</div>';
    return;
  }
  els.ingredientList.innerHTML = state.items.map((it) => {
    if (editingItemId === it.id) {
      return `<div class="ingredient-row" data-item-id="${it.id}" style="align-items:flex-end;flex-wrap:wrap"><div class="field" style="flex:2;min-width:160px"><label>Nome</label><input data-edit="name" value="${escapeHtml(it.name)}" style="height:36px"/></div><div class="field" style="width:100px"><label>Preço</label><input data-edit="price" value="${formatMoneyInput(it.priceTotal)}" style="height:36px"/></div><div class="field" style="width:100px"><label>Qtd.</label><input data-edit="qty" value="${formatNumber(it.qtyBought,3)}" style="height:36px"/></div><div class="field" style="width:100px"><label>Unidade</label><select data-edit="unit" style="height:36px"><option value="kg" ${it.unitBuy === "kg" ? "selected" : ""}>kg</option><option value="g" ${it.unitBuy === "g" ? "selected" : ""}>g</option><option value="l" ${it.unitBuy === "l" ? "selected" : ""}>L</option><option value="ml" ${it.unitBuy === "ml" ? "selected" : ""}>ml</option><option value="un" ${it.unitBuy === "un" ? "selected" : ""}>un</option></select></div><div class="row-actions"><button class="icon-btn" data-action="save-item" data-id="${it.id}" title="Salvar">✓</button><button class="icon-btn" data-action="cancel-item" data-id="${it.id}" title="Cancelar">×</button></div></div>`;
    }
    return `<div class="ingredient-row"><div class="ingredient-row__main"><strong>${escapeHtml(it.name)}</strong><small>${brl.format(it.priceTotal)} por ${formatNumber(it.qtyBought,3)} ${it.unitBuy}</small></div><div class="ingredient-row__price"><strong>${brl.format(it.unitCostBase)}/${displayUnit(it.unitBuy)}</strong><small>custo unitário</small></div><div class="row-actions"><button class="icon-btn" data-action="edit-item" data-id="${it.id}" title="Editar">✎</button><button class="icon-btn icon-btn--danger" data-action="delete-item" data-id="${it.id}" title="Excluir">×</button></div></div>`;
  }).join("");
}

function renderPricing() {
  renderChannel();
  const c = calculate();
  const hasRecipe = state.recipe.length > 0 && c.costPer > 0;

  els.summaryCost.textContent = brl.format(c.costPer);
  els.summaryPrice.textContent = brl.format(c.suggested);
  els.summaryProfit.textContent = brl.format(Math.max(0, c.profit));
  els.kpiCustoTotal.textContent = brl.format(c.ingredientsTotal);
  els.costTotalHelp.textContent = c.portions > 1 ? `Ingredientes e embalagens da receita inteira · ${brl.format(c.ingredientsPer)} por unidade` : "Soma dos ingredientes e embalagens desta receita";

  els.resultSuggested.textContent = brl.format(c.suggested);
  els.resultCost.textContent = brl.format(c.costPer);
  els.resultFee.textContent = brl.format(c.feeValue);
  els.resultNet.textContent = brl.format(c.netAfterFee);
  els.resultProfit.textContent = brl.format(Math.max(0, c.profit));
  els.breakEvenPrice.textContent = brl.format(c.breakEven);
  els.detailIngredients.textContent = brl.format(c.ingredientsPer);
  els.detailExtra.textContent = brl.format(c.extra / c.portions);
  els.detailFeePercent.textContent = `${formatNumber(c.appliedFeePercent, 2)}%`;
  els.detailProfitPercent.textContent = `${formatNumber(c.margin, 2)}%`;

  if (!hasRecipe) {
    els.priceStatus.dataset.status = "neutral"; els.priceStatus.textContent = "Aguardando produto";
    els.resultSubtitle.textContent = "Monte o produto para começar.";
  } else if (!c.valid) {
    els.priceStatus.dataset.status = "bad"; els.priceStatus.textContent = "Revise os percentuais";
    els.resultSubtitle.textContent = "A taxa do canal + lucro desejado precisam somar menos de 100%.";
  } else {
    els.priceStatus.dataset.status = "good"; els.priceStatus.textContent = "Preço calculado";
    els.resultSubtitle.textContent = c.appliedFeePercent > 0 ? `Já considerando ${formatNumber(c.appliedFeePercent,2)}% de taxa do ${channelName(c.channel)} e ${formatNumber(c.margin,2)}% de lucro.` : `Considerando ${formatNumber(c.margin,2)}% de lucro por venda.`;
  }

  if (c.sale > 0 && hasRecipe) {
    els.currentPriceAnalysis.hidden = false;
    els.currentProfit.textContent = brl.format(c.saleProfit);
    els.currentMargin.textContent = `${formatNumber(c.saleMargin, 1)}%`;
    let status = "good", icon = "✓", title = "Seu preço está saudável", text = `Nesse valor, aproximadamente ${brl.format(c.saleProfit)} ficam como lucro por venda.`;
    if (c.sale < c.breakEven - 0.005) { status = "bad"; icon = "!"; title = "Você perde dinheiro nesse preço"; text = `Para cobrir custos e taxas, o mínimo seria aproximadamente ${brl.format(c.breakEven)}.`; }
    else if (c.sale < c.suggested - 0.005) { status = "warn"; icon = "!"; title = "Seu preço está abaixo do sugerido"; text = `Ele cobre os custos, mas entrega menos lucro que os ${formatNumber(c.margin,1)}% escolhidos.`; }
    els.currentPriceAnalysis.dataset.status = status; els.currentAnalysisIcon.textContent = icon; els.currentAnalysisTitle.textContent = title; els.currentAnalysisText.textContent = text;
  } else {
    els.currentPriceAnalysis.hidden = true;
  }

  state.pricing = { portions: c.portions, margin: c.margin, extra: c.extra, sale: c.sale, feePercent: c.feePercent, channel: c.channel };
  state.productName = els.productName.value.trim();
  updateProfitPresets();
  save();
}

function renderModels() {
  if (!state.models.length) { els.modelsList.innerHTML = '<div class="empty-state">Nenhum produto salvo ainda.</div>'; return; }
  els.modelsList.innerHTML = state.models.map((m) => `<div class="model-row"><div class="model-row__main"><strong>${escapeHtml(m.name)}</strong><small>${m.recipe.length} ${m.recipe.length === 1 ? "item" : "itens"} na composição · ${channelName(m.pricing?.channel || "counter")}</small></div><span class="model-row__meta">${dateLabel(m.createdAt)}</span><div class="row-actions"><button class="btn btn--ghost btn--small" data-action="load-model" data-id="${m.id}">Abrir</button><button class="icon-btn icon-btn--danger" data-action="delete-model" data-id="${m.id}" title="Excluir">×</button></div></div>`).join("");
}

function renderInputsFromState() {
  els.productName.value = state.productName || "";
  els.numPorcoes.value = String(state.pricing.portions || 1);
  els.margemLucro.value = formatNumber(state.pricing.margin ?? 20, 2);
  els.taxaExtra.value = formatMoneyInput(state.pricing.extra || 0);
  els.precoVenda.value = state.pricing.sale > 0 ? formatMoneyInput(state.pricing.sale) : "";
  els.feePercent.value = formatNumber(state.pricing.feePercent || 0, 2);
  els.salesChannel.value = ["counter","whatsapp","ifood","marketplace"].includes(state.pricing.channel) ? state.pricing.channel : "counter";
}
function renderAll() { renderRecipeSelect(); renderRecipe(); renderIngredients(); renderModels(); renderPricing(); }

function updateProfitPresets() {
  const margin = parseNumberBR(els.margemLucro.value);
  document.querySelectorAll("[data-profit]").forEach((b) => b.classList.toggle("is-active", Number(b.dataset.profit) === margin));
}

els.formItem.addEventListener("submit", (e) => {
  e.preventDefault(); clearErrors();
  const name = els.itemNome.value.trim(), price = parseNumberBR(els.itemPrecoTotal.value), qty = parseNumberBR(els.itemQtdCompra.value), unit = els.itemUnidadeCompra.value;
  let ok = true;
  if (name.length < 2) { showFieldError(els.itemNome, "Informe um nome válido."); ok = false; }
  if (!(price > 0)) { showFieldError(els.itemPrecoTotal, "Informe quanto você pagou."); ok = false; }
  if (!(qty > 0)) { showFieldError(els.itemQtdCompra, "Informe a quantidade comprada."); ok = false; }
  if (!ok) return;
  state.items.unshift({ id: uid(), name, unitBuy: unit, priceTotal: price, qtyBought: qty, unitCostBase: unitCost(price, qty, unit) });
  els.itemNome.value = ""; els.itemPrecoTotal.value = ""; els.itemQtdCompra.value = ""; save(); renderAll(); els.itemNome.focus();
});

els.ingredientList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]"); if (!btn) return;
  const id = btn.dataset.id, action = btn.dataset.action, it = state.items.find((x) => x.id === id); if (!it) return;
  if (action === "edit-item") { editingItemId = id; renderIngredients(); requestAnimationFrame(() => els.ingredientList.querySelector(`[data-item-id="${id}"] [data-edit="name"]`)?.focus()); }
  if (action === "cancel-item") { editingItemId = null; renderIngredients(); }
  if (action === "delete-item") {
    if (!await confirmModal(`Excluir “${it.name}”? Ele também será removido das receitas que estiver usando.`, "Excluir item")) return;
    state.items = state.items.filter((x) => x.id !== id); state.recipe = state.recipe.filter((r) => r.itemId !== id); editingItemId = null; save(); renderAll();
  }
  if (action === "save-item") {
    const row = els.ingredientList.querySelector(`[data-item-id="${id}"]`); if (!row) return;
    const name = row.querySelector('[data-edit="name"]').value.trim(), price = parseNumberBR(row.querySelector('[data-edit="price"]').value), qty = parseNumberBR(row.querySelector('[data-edit="qty"]').value), unit = row.querySelector('[data-edit="unit"]').value;
    if (name.length < 2 || !(price > 0) || !(qty > 0)) { await openModal({ title: "Confira os dados", body: "Preencha nome, preço e quantidade com valores válidos." }); return; }
    it.name = name; it.priceTotal = price; it.qtyBought = qty; it.unitBuy = unit; it.unitCostBase = unitCost(price, qty, unit);
    state.recipe.forEach((r) => { if (r.itemId === id) r.cost = r.qtyUsedBase * it.unitCostBase; }); editingItemId = null; save(); renderAll();
  }
});

els.formUso.addEventListener("submit", (e) => {
  e.preventDefault(); clearErrors();
  const itemId = els.usoItem.value, qty = parseNumberBR(els.usoQtd.value), it = state.items.find((x) => x.id === itemId);
  if (!it) { showFieldError(els.usoItem, "Escolha um item cadastrado."); return; }
  if (!(qty > 0)) { showFieldError(els.usoQtd, "Informe quanto você usa."); return; }
  const existing = state.recipe.find((r) => r.itemId === itemId);
  if (existing) { existing.qtyUsedBase += qty; existing.cost = existing.qtyUsedBase * it.unitCostBase; }
  else state.recipe.push({ id: uid(), itemId, qtyUsedBase: qty, cost: qty * it.unitCostBase });
  els.usoQtd.value = ""; save(); renderAll(); els.usoQtd.focus();
});
els.usoItem.addEventListener("change", updateUsageUnit);

els.recipeList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]"); if (!btn) return;
  const id = btn.dataset.id, action = btn.dataset.action, r = state.recipe.find((x) => x.id === id); if (!r) return;
  if (action === "edit-recipe") { editingRecipeId = id; renderRecipe(); requestAnimationFrame(() => els.recipeList.querySelector(`[data-edit-recipe="${id}"]`)?.focus()); }
  if (action === "cancel-recipe") { editingRecipeId = null; renderRecipe(); }
  if (action === "delete-recipe") { state.recipe = state.recipe.filter((x) => x.id !== id); editingRecipeId = null; save(); renderAll(); }
  if (action === "save-recipe") {
    const input = els.recipeList.querySelector(`[data-edit-recipe="${id}"]`), qty = parseNumberBR(input?.value), it = state.items.find((x) => x.id === r.itemId);
    if (!(qty > 0) || !it) return; r.qtyUsedBase = qty; r.cost = qty * it.unitCostBase; editingRecipeId = null; save(); renderAll();
  }
});

[els.productName, els.numPorcoes, els.feePercent, els.taxaExtra, els.margemLucro, els.precoVenda].forEach((el) => el.addEventListener("input", renderPricing));
els.salesChannel.addEventListener("change", () => { renderPricing(); });
document.querySelectorAll("[data-profit]").forEach((btn) => btn.addEventListener("click", () => { els.margemLucro.value = btn.dataset.profit; renderPricing(); }));

function snapshotModel(name) {
  const includedIds = new Set(state.recipe.map((r) => r.itemId));
  const items = state.items.filter((it) => includedIds.has(it.id)).map((it) => ({ name: it.name, unitBuy: it.unitBuy, priceTotal: it.priceTotal, qtyBought: it.qtyBought, unitCostBase: it.unitCostBase }));
  const keyById = new Map(state.items.map((it) => [it.id, `${it.name.trim().toLowerCase()}|${it.unitBuy}`]));
  const recipe = state.recipe.map((r) => ({ itemKey: keyById.get(r.itemId), qtyUsedBase: r.qtyUsedBase })).filter((r) => r.itemKey);
  return { id: uid(), name, productName: els.productName.value.trim() || name, createdAt: Date.now(), items, recipe, pricing: { ...state.pricing } };
}

els.btnSaveModel.addEventListener("click", async () => {
  els.modelNameErr.textContent = "";
  const name = els.modelName.value.trim() || els.productName.value.trim();
  if (!name) { els.modelNameErr.textContent = "Dê um nome ao produto antes de salvar."; return; }
  if (!state.recipe.length) { await openModal({ title: "Produto vazio", body: "Adicione pelo menos um ingrediente antes de salvar." }); return; }
  const same = state.models.findIndex((m) => m.name.toLowerCase() === name.toLowerCase());
  if (same >= 0) { if (!await confirmModal(`Já existe um produto chamado “${name}”. Substituir?`, "Salvar produto")) return; state.models.splice(same, 1); }
  state.models.unshift(snapshotModel(name)); els.modelName.value = ""; save(); renderModels();
});

function loadModel(m) {
  const idByKey = new Map();
  m.items.forEach((mi) => {
    const key = `${mi.name.trim().toLowerCase()}|${mi.unitBuy}`;
    let existing = state.items.find((it) => `${it.name.trim().toLowerCase()}|${it.unitBuy}` === key);
    if (!existing) { existing = { id: uid(), name: mi.name, unitBuy: mi.unitBuy, priceTotal: mi.priceTotal, qtyBought: mi.qtyBought, unitCostBase: unitCost(mi.priceTotal, mi.qtyBought, mi.unitBuy) }; state.items.push(existing); }
    idByKey.set(key, existing.id);
  });
  state.recipe = m.recipe.map((r) => {
    const itemId = idByKey.get(r.itemKey); const it = state.items.find((x) => x.id === itemId); if (!it) return null;
    return { id: uid(), itemId, qtyUsedBase: r.qtyUsedBase, cost: r.qtyUsedBase * it.unitCostBase };
  }).filter(Boolean);
  state.pricing = { ...defaultPricing(), ...(m.pricing || {}) };
  state.productName = m.productName || m.name;
  renderInputsFromState(); save(); renderAll(); window.scrollTo({ top: 0, behavior: "smooth" });
}

els.modelsList.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-action]"); if (!btn) return; const m = state.models.find((x) => x.id === btn.dataset.id); if (!m) return;
  if (btn.dataset.action === "load-model") loadModel(m);
  if (btn.dataset.action === "delete-model") { if (!await confirmModal(`Excluir o produto salvo “${m.name}”?`, "Excluir produto")) return; state.models = state.models.filter((x) => x.id !== m.id); save(); renderModels(); }
});

els.btnDemo.addEventListener("click", async () => {
  const demo = [
    ["Açaí", "kg", 79.90, 10], ["Leite em pó", "kg", 32, 1], ["Banana", "kg", 6.90, 1], ["Granola", "g", 9.50, 500], ["Copo 500ml", "un", 45, 100]
  ];
  demo.forEach(([name, unitBuy, priceTotal, qtyBought]) => {
    if (!state.items.some((x) => x.name.toLowerCase() === name.toLowerCase())) state.items.push({ id: uid(), name, unitBuy, priceTotal, qtyBought, unitCostBase: unitCost(priceTotal, qtyBought, unitBuy) });
  });
  save(); renderAll(); els.ingredientManager.open = true;
});

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "precificacao-backup.json"; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
els.btnExport.addEventListener("click", exportBackup);
els.fileImport.addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  try { Object.assign(state, normalizeState(JSON.parse(await file.text()))); renderInputsFromState(); save(); renderAll(); await openModal({ title: "Backup importado", body: "Seus dados foram carregados com sucesso." }); }
  catch { await openModal({ title: "Não foi possível importar", body: "O arquivo não parece ser um backup válido desta ferramenta." }); }
  finally { e.target.value = ""; }
});

els.btnReset.addEventListener("click", async () => {
  if (!await confirmModal("Isso apaga ingredientes, composição e produtos salvos deste navegador. Deseja continuar?", "Limpar todos os dados")) return;
  state.items = []; state.recipe = []; state.models = []; state.pricing = defaultPricing(); state.productName = ""; editingItemId = null; editingRecipeId = null;
  localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LEGACY_KEY); renderInputsFromState(); renderAll();
});

els.btnHelp.addEventListener("click", () => {
  const wrap = document.createElement("div"); wrap.className = "help-list";
  [["1. Cadastre os ingredientes", "Abra “Gerenciar ingredientes e embalagens” e informe quanto pagou e quanto comprou."], ["2. Monte o produto", "Escolha cada ingrediente e diga quanto usa. O custo é calculado automaticamente."], ["3. Escolha onde vende", "No iFood ou outro app, informe a taxa total cobrada do seu plano."], ["4. Escolha o lucro", "Informe quanto gostaria que sobrasse como lucro em cada venda."], ["5. Veja o preço", "A ferramenta calcula o preço sugerido, o mínimo para não perder dinheiro e compara com seu preço atual."]].forEach(([t,d]) => { const box = document.createElement("div"); const strong = document.createElement("strong"); const span = document.createElement("span"); strong.textContent=t; span.textContent=d; box.append(strong,span); wrap.appendChild(box); });
  openModal({ title: "Como usar", body: wrap });
});

els.modalRoot.addEventListener("click", (e) => { if (e.target?.dataset?.modalClose === "true") closeModal(null); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !els.modalRoot.hidden) closeModal(null); });

document.querySelectorAll("[data-format]").forEach((input) => input.addEventListener("blur", () => {
  const type = input.dataset.format, n = parseNumberBR(input.value); if (!input.value.trim()) return;
  if (type === "currency") input.value = formatMoneyInput(Math.max(0,n)); else if (type === "int") input.value = String(Math.max(1,Math.floor(n||1))); else input.value = formatNumber(Math.max(0,n),2);
  if (["numPorcoes","feePercent","taxaExtra","margemLucro","precoVenda"].includes(input.id)) renderPricing();
}));

load();
renderInputsFromState();
els.appVersion.textContent = APP_VERSION;
renderAll();
