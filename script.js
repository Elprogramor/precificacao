"use strict";

/* =========================
   Versão + Helpers
========================= */
const APP_VERSION = "v1.0.0";
const STORAGE_KEY_V2 = "custos_dashboard_v2";
const STORAGE_KEY_V1 = "custos_dashboard_v1";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function parseNumberBR(value) {
  if (value == null) return 0;
  const s = String(value).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function formatNumberBR(n, decimals = 3) {
  if (!Number.isFinite(n)) return "0";
  const fixed = n.toFixed(decimals);
  const trimmed = fixed.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed.replace(".", ",");
}

function formatMoneyInput(n) {
  if (!Number.isFinite(n)) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

function formatQty(qty, unit) {
  const n = Number(qty);
  if (!Number.isFinite(n)) return `0 ${unit}`;
  const pretty =
    n % 1 === 0 ? String(n.toFixed(0)) : String(n.toFixed(3)).replace(/0+$/, "").replace(/\.$/, "");
  return `${pretty} ${unit}`;
}

function normalizeUnitPair(unit) {
  if (unit === "kg" || unit === "g") return { base: "g", factor: unit === "kg" ? 1000 : 1 };
  if (unit === "l" || unit === "ml") return { base: "ml", factor: unit === "l" ? 1000 : 1 };
  return { base: "un", factor: 1 };
}

function calcUnitCostBRL(priceTotal, qtyBought, unit) {
  const { factor } = normalizeUnitPair(unit);
  const qtyInBase = qtyBought * factor;
  if (qtyInBase <= 0) return 0;
  return priceTotal / qtyInBase; // R$ por unidade base (g/ml/un)
}

function displayUnit(unit) {
  if (unit === "kg" || unit === "g") return "g";
  if (unit === "l" || unit === "ml") return "ml";
  return "un";
}

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function normalizeNameKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/* =========================
   Modal (12 + 18)
========================= */
const modalRoot = document.getElementById("modalRoot");
const modalDialog = modalRoot.querySelector(".modal__dialog");
const modalTitle = document.getElementById("modalTitle");
const modalBody = document.getElementById("modalDesc");
const modalActions = document.getElementById("modalActions");

let modalResolver = null;
let lastFocused = null;

function openModal({ title, body, actions }) {
  lastFocused = document.activeElement;
  modalTitle.textContent = title;
  modalBody.innerHTML = "";
  modalActions.innerHTML = "";

  if (typeof body === "string") {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = body;
    modalBody.appendChild(p);
  } else if (body instanceof Node) {
    modalBody.appendChild(body);
  }

  actions.forEach((a) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = a.className || "btn btn--ghost";
    btn.textContent = a.label;
    btn.addEventListener("click", () => {
      closeModal();
      if (modalResolver) modalResolver(a.value);
    });
    modalActions.appendChild(btn);
  });

  modalRoot.hidden = false;
  document.body.style.overflow = "hidden";
  requestAnimationFrame(() => modalDialog.focus());

  return new Promise((resolve) => {
    modalResolver = resolve;
  });
}

function closeModal() {
  modalRoot.hidden = true;
  document.body.style.overflow = "";
  const resolve = modalResolver;
  modalResolver = null;
  if (lastFocused && typeof lastFocused.focus === "function") {
    requestAnimationFrame(() => lastFocused.focus());
  }
  return resolve;
}

modalRoot.addEventListener("click", (e) => {
  const close = e.target && e.target.getAttribute && e.target.getAttribute("data-modal-close");
  if (close === "true") {
    closeModal();
    if (modalResolver) modalResolver(null);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!modalRoot.hidden) {
      e.preventDefault();
      closeModal();
      if (modalResolver) modalResolver(null);
      return;
    }

    if (editingItemId || editingRecipeId) {
      e.preventDefault();
      editingItemId = null;
      editingRecipeId = null;
      renderAll();
      return;
    }
  }
});

async function modalAlert(message, title = "Aviso") {
  await openModal({
    title,
    body: message,
    actions: [{ label: "Entendi", value: true, className: "btn btn--primary" }],
  });
}

async function modalConfirm(message, title = "Confirmar") {
  const res = await openModal({
    title,
    body: message,
    actions: [
      { label: "Cancelar", value: false, className: "btn btn--ghost" },
      { label: "Confirmar", value: true, className: "btn btn--danger" },
    ],
  });
  return Boolean(res);
}

async function modalPrompt({ title, label, defaultValue = "", placeholder = "" }) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const lab = document.createElement("label");
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = defaultValue;
  input.placeholder = placeholder;
  input.className = "edit-input";
  input.autocomplete = "off";
  input.spellcheck = false;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      // Simula clique no confirmar
      const confirmBtn = modalActions.querySelector("button.btn--primary");
      if (confirmBtn) confirmBtn.click();
    }
  });
  wrap.appendChild(lab);
  wrap.appendChild(input);

  const res = await openModal({
    title,
    body: wrap,
    actions: [
      { label: "Cancelar", value: null, className: "btn btn--ghost" },
      { label: "Salvar", value: "ok", className: "btn btn--primary" },
    ],
  });

  if (res !== "ok") return null;
  return input.value;
}

/* =========================
   State
========================= */
const state = {
  items: [],   // {id, name, unitBuy, priceTotal, qtyBought, unitCostBase}
  recipe: [],  // {id, itemId, qtyUsedBase, cost}
  pricing: { portions: 1, margin: 70, extra: 0, sale: 0 },
  models: [],  // {id, name, createdAt, items:[], recipe:[], pricing:{}}
};

let editingItemId = null;
let editingRecipeId = null;

/* =========================
   Elements
========================= */
const formItem = document.getElementById("formItem");
const itemNome = document.getElementById("itemNome");
const itemUnidadeCompra = document.getElementById("itemUnidadeCompra");
const itemPrecoTotal = document.getElementById("itemPrecoTotal");
const itemQtdCompra = document.getElementById("itemQtdCompra");
const tbodyItens = document.getElementById("tbodyItens");

const formUso = document.getElementById("formUso");
const usoItem = document.getElementById("usoItem");
const usoQtd = document.getElementById("usoQtd");
const usoHint = document.getElementById("usoHint");
const tbodyReceita = document.getElementById("tbodyReceita");

const modelName = document.getElementById("modelName");
const btnSaveModel = document.getElementById("btnSaveModel");
const btnClearModelName = document.getElementById("btnClearModelName");
const tbodyModels = document.getElementById("tbodyModels");

const numPorcoes = document.getElementById("numPorcoes");
const margemLucro = document.getElementById("margemLucro");
const taxaExtra = document.getElementById("taxaExtra");
const precoVenda = document.getElementById("precoVenda");

const kpiCustoTotal = document.getElementById("kpiCustoTotal");
const kpiCustoPorcao = document.getElementById("kpiCustoPorcao");
const kpiPrecoSugerido = document.getElementById("kpiPrecoSugerido");
const kpiLucroEstimado = document.getElementById("kpiLucroEstimado");
const kpiDetalhe = document.getElementById("kpiDetalhe");

const boxLucroReal = document.getElementById("boxLucroReal");
const boxMargemReal = document.getElementById("boxMargemReal");
const kpiLucroReal = document.getElementById("kpiLucroReal");
const kpiMargemReal = document.getElementById("kpiMargemReal");

const breakdownList = document.getElementById("breakdownList");

const btnLimparReceita = document.getElementById("btnLimparReceita");
const btnReset = document.getElementById("btnReset");
const btnDemo = document.getElementById("btnDemo");
const btnExport = document.getElementById("btnExport");
const btnExportCSV = document.getElementById("btnExportCSV");
const fileImport = document.getElementById("fileImport");
const btnHelp = document.getElementById("btnHelp");

const appVersion = document.getElementById("appVersion");

/* =========================
   Storage (load/save) + Import Validação (23)
========================= */
function save() {
  localStorage.setItem(STORAGE_KEY_V2, JSON.stringify(state));
}

function migrateFromV1IfNeeded() {
  const rawV2 = localStorage.getItem(STORAGE_KEY_V2);
  if (rawV2) return;

  const rawV1 = localStorage.getItem(STORAGE_KEY_V1);
  if (!rawV1) return;

  try {
    const data = JSON.parse(rawV1);
    if (!data || typeof data !== "object") return;

    const migrated = {
      items: Array.isArray(data.items) ? data.items : [],
      recipe: Array.isArray(data.recipe) ? data.recipe : [],
      pricing: data.pricing && typeof data.pricing === "object" ? data.pricing : { portions: 1, margin: 70, extra: 0, sale: 0 },
      models: [],
    };

    const cleaned = validateImportedState(migrated);
    state.items = cleaned.items;
    state.recipe = cleaned.recipe;
    state.pricing = cleaned.pricing;
    state.models = cleaned.models;

    save();
  } catch (_) {}
}

function load() {
  migrateFromV1IfNeeded();
  const raw = localStorage.getItem(STORAGE_KEY_V2);
  if (!raw) return;

  try {
    const data = JSON.parse(raw);
    const cleaned = validateImportedState(data);
    state.items = cleaned.items;
    state.recipe = cleaned.recipe;
    state.pricing = cleaned.pricing;
    state.models = cleaned.models;
  } catch (_) {}
}

function validateImportedState(data) {
  const out = {
    items: [],
    recipe: [],
    pricing: { portions: 1, margin: 70, extra: 0, sale: 0 },
    models: [],
  };

  if (!data || typeof data !== "object") return out;

  const allowedUnits = new Set(["kg", "g", "l", "ml", "un"]);

  // Items
  if (Array.isArray(data.items)) {
    out.items = data.items
      .map((it) => {
        const id = String(it && it.id ? it.id : uid());
        const name = String(it && it.name ? it.name : "").trim();
        const unitBuy = String(it && it.unitBuy ? it.unitBuy : "g");
        const priceTotal = Number(it && it.priceTotal);
        const qtyBought = Number(it && it.qtyBought);
        const unitCostBase = Number(it && it.unitCostBase);

        if (!name) return null;
        if (!allowedUnits.has(unitBuy)) return null;
        if (!Number.isFinite(priceTotal) || priceTotal < 0) return null;
        if (!Number.isFinite(qtyBought) || qtyBought <= 0) return null;

        const computedUnitCost = calcUnitCostBRL(priceTotal, qtyBought, unitBuy);
        const safeUnitCost = Number.isFinite(unitCostBase) && unitCostBase > 0 ? unitCostBase : computedUnitCost;

        return {
          id,
          name,
          unitBuy,
          priceTotal: priceTotal,
          qtyBought: qtyBought,
          unitCostBase: safeUnitCost,
        };
      })
      .filter(Boolean);
  }

  // Pricing
  if (data.pricing && typeof data.pricing === "object") {
    const portions = Math.max(1, Math.floor(Number(data.pricing.portions) || 1));
    const margin = clamp(Number(data.pricing.margin) || 70, 0, 10000);
    const extra = Math.max(0, Number(data.pricing.extra) || 0);
    const sale = Math.max(0, Number(data.pricing.sale) || 0);
    out.pricing = { portions, margin, extra, sale };
  }

  // Recipe (só aceita itemId existente)
  const itemIds = new Set(out.items.map((i) => i.id));
  if (Array.isArray(data.recipe)) {
    out.recipe = data.recipe
      .map((r) => {
        const id = String(r && r.id ? r.id : uid());
        const itemId = String(r && r.itemId ? r.itemId : "");
        const qtyUsedBase = Number(r && r.qtyUsedBase);
        if (!itemId || !itemIds.has(itemId)) return null;
        if (!Number.isFinite(qtyUsedBase) || qtyUsedBase <= 0) return null;

        const it = out.items.find((x) => x.id === itemId);
        const cost = qtyUsedBase * (it ? it.unitCostBase : 0);

        return { id, itemId, qtyUsedBase, cost: Math.max(0, cost) };
      })
      .filter(Boolean);
  }

  // Models
  if (Array.isArray(data.models)) {
    out.models = data.models
      .map((m) => {
        const id = String(m && m.id ? m.id : uid());
        const name = String(m && m.name ? m.name : "").trim();
        const createdAt = Number(m && m.createdAt) || Date.now();
        if (!name) return null;

        const items = Array.isArray(m.items)
          ? m.items
              .map((it) => {
                const n = String(it && it.name ? it.name : "").trim();
                const u = String(it && it.unitBuy ? it.unitBuy : "");
                const pt = Number(it && it.priceTotal);
                const qb = Number(it && it.qtyBought);
                const uc = Number(it && it.unitCostBase);

                if (!n) return null;
                if (!allowedUnits.has(u)) return null;
                if (!Number.isFinite(pt) || pt < 0) return null;
                if (!Number.isFinite(qb) || qb <= 0) return null;

                const computed = calcUnitCostBRL(pt, qb, u);
                const safe = Number.isFinite(uc) && uc > 0 ? uc : computed;

                return { name: n, unitBuy: u, priceTotal: pt, qtyBought: qb, unitCostBase: safe };
              })
              .filter(Boolean)
          : [];

        const recipe = Array.isArray(m.recipe)
          ? m.recipe
              .map((r) => {
                const key = String(r && r.itemKey ? r.itemKey : "").trim();
                const qty = Number(r && r.qtyUsedBase);
                if (!key) return null;
                if (!Number.isFinite(qty) || qty <= 0) return null;
                return { itemKey: key, qtyUsedBase: qty };
              })
              .filter(Boolean)
          : [];

        const pricing = m.pricing && typeof m.pricing === "object"
          ? {
              portions: Math.max(1, Math.floor(Number(m.pricing.portions) || 1)),
              margin: clamp(Number(m.pricing.margin) || 70, 0, 10000),
              extra: Math.max(0, Number(m.pricing.extra) || 0),
              sale: Math.max(0, Number(m.pricing.sale) || 0),
            }
          : { portions: 1, margin: 70, extra: 0, sale: 0 };

        return { id, name, createdAt, items, recipe, pricing };
      })
      .filter(Boolean);
  }

  return out;
}

/* =========================
   UI: Erros/Validação (15)
========================= */
function setFieldError(inputEl, msg) {
  const field = inputEl.closest(".field");
  const errId = inputEl.getAttribute("aria-describedby") || "";
  const errElId = errId.split(" ").find((x) => x.toLowerCase().endsWith("err"));
  const errEl = errElId ? document.getElementById(errElId) : null;

  if (field) field.classList.toggle("field--error", Boolean(msg));
  inputEl.setAttribute("aria-invalid", msg ? "true" : "false");
  if (errEl) errEl.textContent = msg || "";
}

function clearErrors(scopeEl) {
  scopeEl.querySelectorAll(".field").forEach((f) => f.classList.remove("field--error"));
  scopeEl.querySelectorAll("[aria-invalid='true']").forEach((el) => el.setAttribute("aria-invalid", "false"));
  scopeEl.querySelectorAll(".error").forEach((e) => (e.textContent = ""));
}

function validateItemForm() {
  clearErrors(formItem);

  const name = itemNome.value.trim();
  const price = parseNumberBR(itemPrecoTotal.value);
  const qty = parseNumberBR(itemQtdCompra.value);

  let ok = true;

  if (!name || name.length < 2) {
    setFieldError(itemNome, "Informe um nome válido (mínimo 2 caracteres).");
    ok = false;
  }
  if (!(price > 0)) {
    setFieldError(itemPrecoTotal, "Informe um preço maior que zero.");
    ok = false;
  }
  if (!(qty > 0)) {
    setFieldError(itemQtdCompra, "Informe uma quantidade maior que zero.");
    ok = false;
  }

  return ok;
}

function validateRecipeForm() {
  clearErrors(formUso);

  const itemId = usoItem.value;
  const qty = parseNumberBR(usoQtd.value);

  let ok = true;

  if (!itemId) {
    setFieldError(usoItem, "Selecione um item cadastrado.");
    ok = false;
  }
  if (!(qty > 0)) {
    setFieldError(usoQtd, "Informe uma quantidade maior que zero.");
    ok = false;
  }

  return ok;
}

function validatePricingInputs() {
  // valida sem bloquear total (apenas corrige)
  const portions = Math.max(1, Math.floor(parseNumberBR(numPorcoes.value) || 1));
  const margin = Math.max(0, parseNumberBR(margemLucro.value) || 0);
  const extra = Math.max(0, parseNumberBR(taxaExtra.value) || 0);
  const sale = Math.max(0, parseNumberBR(precoVenda.value) || 0);

  // aplica correções visuais leves
  clearErrors(document.querySelector(".pricing"));

  if (parseNumberBR(numPorcoes.value) <= 0) setFieldError(numPorcoes, "Use 1 ou mais porções.");
  if (parseNumberBR(margemLucro.value) < 0) setFieldError(margemLucro, "Margem não pode ser negativa.");
  if (parseNumberBR(taxaExtra.value) < 0) setFieldError(taxaExtra, "Extras não podem ser negativos.");
  if (parseNumberBR(precoVenda.value) < 0) setFieldError(precoVenda, "Preço de venda não pode ser negativo.");

  return { portions, margin, extra, sale };
}

/* =========================
   Autoformatação (16)
========================= */
function applyFormatOnBlur(el) {
  const type = el.getAttribute("data-format");
  const n = parseNumberBR(el.value);

  if (!type) return;

  if (type === "currency") {
    el.value = el.value.trim() === "" ? "" : formatMoneyInput(Math.max(0, n));
    return;
  }

  if (type === "int") {
    const v = Math.max(1, Math.floor(n || 1));
    el.value = String(v);
    return;
  }

  if (type === "number") {
    if (el.value.trim() === "") return;
    const safe = Math.max(0, n);
    el.value = formatNumberBR(safe, 3);
    return;
  }
}

/* =========================
   Render
========================= */
function renderItemsTable() {
  tbodyItens.innerHTML = "";

  if (!state.items.length) {
    tbodyItens.innerHTML = `
      <tr class="empty">
        <td colspan="5">
          <div class="empty__box">
            <strong>Nenhum item cadastrado ainda.</strong>
            <span>Cadastre acima para começar a montar a receita.</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  const rows = state.items
    .map((it) => {
      const unitBase = displayUnit(it.unitBuy);
      const shownUnitCost = `${brl.format(it.unitCostBase)} / ${unitBase}`;
      const isEditing = editingItemId === it.id;

      if (!isEditing) {
        return `
          <tr data-row="item" data-id="${it.id}">
            <td>
              <div class="cell-title">
                <strong>${escapeHtml(it.name)}</strong>
                <span class="muted">Cálculo em ${unitBase}</span>
              </div>
            </td>
            <td class="right">${brl.format(it.priceTotal)}</td>
            <td class="right">${formatQty(it.qtyBought, it.unitBuy)}</td>
            <td class="right"><span class="pill">${shownUnitCost}</span></td>
            <td class="right">
              <div class="row-actions">
                <button class="icon-btn" type="button" data-action="edit-item" data-id="${it.id}" title="Editar item (Enter salva)">
                  ✎
                </button>
                <button class="icon-btn icon-btn--danger" type="button" data-action="delete-item" data-id="${it.id}" title="Excluir item">
                  🗑
                </button>
              </div>
            </td>
          </tr>`;
      }

      return `
        <tr data-row="item-edit" data-id="${it.id}">
          <td>
            <div class="field" style="gap:6px;">
              <label class="muted" style="font-size:12px;">Nome</label>
              <input class="edit-input" data-edit="name" type="text" value="${escapeHtml(it.name)}" />
            </div>
          </td>
          <td class="right">
            <div class="field" style="gap:6px;">
              <label class="muted" style="font-size:12px;">Preço (R$)</label>
              <input class="edit-input" data-edit="price" inputmode="decimal" type="text" value="${formatMoneyInput(it.priceTotal)}" />
            </div>
          </td>
          <td class="right">
            <div class="field" style="gap:6px;">
              <label class="muted" style="font-size:12px;">Qtd (${it.unitBuy})</label>
              <input class="edit-input" data-edit="qty" inputmode="decimal" type="text" value="${formatNumberBR(it.qtyBought, 3)}" />
            </div>
          </td>
          <td class="right"><span class="pill">${shownUnitCost}</span></td>
          <td class="right">
            <div class="row-actions">
              <button class="icon-btn icon-btn--ok" type="button" data-action="save-item" data-id="${it.id}" title="Salvar alterações">
                ✓
              </button>
              <button class="icon-btn" type="button" data-action="cancel-item" data-id="${it.id}" title="Cancelar edição (Esc)">
                ↩
              </button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  tbodyItens.innerHTML = rows;
}

function renderItemsSelect() {
  const prev = usoItem.value;
  usoItem.innerHTML = `<option value="" disabled ${prev ? "" : "selected"}>Selecione um item cadastrado</option>`;

  state.items.forEach((it) => {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = `${it.name} • ${brl.format(it.unitCostBase)} / ${displayUnit(it.unitBuy)}`;
    usoItem.appendChild(opt);
  });

  if (prev && state.items.some((x) => x.id === prev)) usoItem.value = prev;
  updateUsoHint();
}

function renderRecipeTable() {
  tbodyReceita.innerHTML = "";

  if (!state.recipe.length) {
    tbodyReceita.innerHTML = `
      <tr class="empty">
        <td colspan="4">
          <div class="empty__box">
            <strong>Receita vazia.</strong>
            <span>Adicione itens para calcular o custo do seu açaí.</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  const rows = state.recipe
    .map((r) => {
      const it = state.items.find((x) => x.id === r.itemId);
      const name = it ? it.name : "Item removido";
      const unitBase = it ? displayUnit(it.unitBuy) : "-";
      const isEditing = editingRecipeId === r.id;

      if (!isEditing) {
        return `
          <tr data-row="recipe" data-id="${r.id}">
            <td>
              <div class="cell-title">
                <strong>${escapeHtml(name)}</strong>
                <span class="muted">${it ? `${brl.format(it.unitCostBase)} / ${unitBase}` : "—"}</span>
              </div>
            </td>
            <td class="right">${it ? formatQty(r.qtyUsedBase, unitBase) : "—"}</td>
            <td class="right"><strong>${brl.format(r.cost)}</strong></td>
            <td class="right">
              <div class="row-actions">
                <button class="icon-btn" type="button" data-action="edit-recipe" data-id="${r.id}" title="Editar quantidade usada">
                  ✎
                </button>
                <button class="icon-btn icon-btn--danger" type="button" data-action="delete-recipe" data-id="${r.id}" title="Remover da receita">
                  🗑
                </button>
              </div>
            </td>
          </tr>`;
      }

      return `
        <tr data-row="recipe-edit" data-id="${r.id}">
          <td>
            <div class="cell-title">
              <strong>${escapeHtml(name)}</strong>
              <span class="muted">${it ? `${brl.format(it.unitCostBase)} / ${unitBase}` : "—"}</span>
            </div>
          </td>
          <td class="right">
            <div class="field" style="gap:6px;">
              <label class="muted" style="font-size:12px;">Qtd (${unitBase})</label>
              <input class="edit-input" data-edit="qty" inputmode="decimal" type="text" value="${formatNumberBR(r.qtyUsedBase, 3)}" />
            </div>
          </td>
          <td class="right"><strong>${brl.format(r.cost)}</strong></td>
          <td class="right">
            <div class="row-actions">
              <button class="icon-btn icon-btn--ok" type="button" data-action="save-recipe" data-id="${r.id}" title="Salvar">
                ✓
              </button>
              <button class="icon-btn" type="button" data-action="cancel-recipe" data-id="${r.id}" title="Cancelar (Esc)">
                ↩
              </button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  tbodyReceita.innerHTML = rows;
}

function renderModelsTable() {
  tbodyModels.innerHTML = "";

  if (!state.models.length) {
    tbodyModels.innerHTML = `
      <tr class="empty">
        <td colspan="3">
          <div class="empty__box">
            <strong>Nenhum modelo salvo.</strong>
            <span>Monte uma receita e clique em “Salvar modelo”.</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  const rows = [...state.models]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map((m) => {
      const d = new Date(m.createdAt || Date.now());
      const when = d.toLocaleDateString("pt-BR");
      return `
        <tr data-row="model" data-id="${m.id}">
          <td>
            <div class="cell-title">
              <strong>${escapeHtml(m.name)}</strong>
              <span class="muted">${m.recipe.length} item(ns) • porções ${m.pricing.portions} • margem ${m.pricing.margin}%</span>
            </div>
          </td>
          <td class="right">${escapeHtml(when)}</td>
          <td class="right">
            <div class="row-actions">
              <button class="icon-btn icon-btn--ok" type="button" data-action="load-model" data-id="${m.id}" title="Carregar modelo">
                ⤓
              </button>
              <button class="icon-btn" type="button" data-action="duplicate-model" data-id="${m.id}" title="Duplicar modelo">
                ⎘
              </button>
              <button class="icon-btn icon-btn--danger" type="button" data-action="delete-model" data-id="${m.id}" title="Excluir modelo">
                🗑
              </button>
            </div>
          </td>
        </tr>`;
    })
    .join("");

  tbodyModels.innerHTML = rows;
}

function renderKPIs() {
  const totalBase = state.recipe.reduce((acc, r) => acc + (r.cost || 0), 0);

  const { portions, margin, extra, sale } = validatePricingInputs();

  const costWithExtra = totalBase + extra;
  const costPer = costWithExtra / portions;

  const suggested = costPer * (1 + margin / 100);
  const profitSuggested = suggested - costPer;

  kpiCustoTotal.textContent = brl.format(costWithExtra);
  kpiCustoPorcao.textContent = brl.format(costPer);
  kpiPrecoSugerido.textContent = brl.format(suggested);
  kpiLucroEstimado.textContent = brl.format(profitSuggested);

  const detail = `Custo base ${brl.format(totalBase)} + extras ${brl.format(extra)} • ${portions} porção(ões) • margem ${margin}%`;
  kpiDetalhe.textContent = detail;

  // Preço praticado (9)
  if (sale > 0) {
    const realProfit = sale - costPer;
    const realMargin = sale > 0 ? (realProfit / sale) * 100 : 0;

    boxLucroReal.hidden = false;
    boxMargemReal.hidden = false;

    kpiLucroReal.textContent = brl.format(realProfit);
    kpiMargemReal.textContent = `${formatNumberBR(realMargin, 2)}%`;
  } else {
    boxLucroReal.hidden = true;
    boxMargemReal.hidden = true;
    kpiLucroReal.textContent = brl.format(0);
    kpiMargemReal.textContent = "0%";
  }

  state.pricing.portions = portions;
  state.pricing.margin = margin;
  state.pricing.extra = extra;
  state.pricing.sale = sale;

  renderBreakdown(totalBase);
  save();
}

function renderBreakdown(totalBase) {
  breakdownList.innerHTML = "";

  if (!state.recipe.length || totalBase <= 0) {
    const empty = document.createElement("div");
    empty.className = "breakdown__empty muted";
    empty.textContent = "Adicione itens na receita para ver a distribuição.";
    breakdownList.appendChild(empty);
    return;
  }

  // agrupa por itemId
  const byItem = new Map();
  for (const r of state.recipe) {
    const prev = byItem.get(r.itemId) || 0;
    byItem.set(r.itemId, prev + (r.cost || 0));
  }

  const items = [...byItem.entries()]
    .map(([itemId, cost]) => {
      const it = state.items.find((x) => x.id === itemId);
      return {
        itemId,
        name: it ? it.name : "Item removido",
        cost,
        pct: (cost / totalBase) * 100,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  items.forEach((x) => {
    const row = document.createElement("div");
    row.className = "b-item";
    row.setAttribute("role", "listitem");

    const top = document.createElement("div");
    top.className = "b-item__row";

    const left = document.createElement("div");
    left.className = "b-item__name";
    left.textContent = x.name;

    const right = document.createElement("div");
    right.className = "b-item__meta";
    right.textContent = `${brl.format(x.cost)} • ${formatNumberBR(x.pct, 2)}%`;

    top.appendChild(left);
    top.appendChild(right);

    const bar = document.createElement("div");
    bar.className = "b-bar";

    const fill = document.createElement("div");
    fill.className = "b-bar__fill";
    fill.style.width = `${clamp(x.pct, 0, 100)}%`;

    bar.appendChild(fill);

    row.appendChild(top);
    row.appendChild(bar);

    breakdownList.appendChild(row);
  });
}

function updateUsoHint() {
  const it = state.items.find((x) => x.id === usoItem.value);
  if (!it) {
    usoHint.textContent = "A unidade será a mesma do item (ex.: g, ml, un).";
    return;
  }
  usoHint.textContent = `Informe a quantidade em ${displayUnit(it.unitBuy)} (base de cálculo).`;
}

function renderAll() {
  renderItemsTable();
  renderItemsSelect();
  renderRecipeTable();
  renderModelsTable();

  numPorcoes.value = String(state.pricing.portions ?? 1);
  margemLucro.value = String(state.pricing.margin ?? 70);
  taxaExtra.value = formatMoneyInput(Number(state.pricing.extra ?? 0));
  precoVenda.value = state.pricing.sale ? formatMoneyInput(Number(state.pricing.sale)) : "";

  renderKPIs();
}

/* =========================
   Receita Modelo (8 + 10)
========================= */
function getUsedItemsSnapshot() {
  const used = new Set(state.recipe.map((r) => r.itemId));
  const snapshot = state.items
    .filter((i) => used.has(i.id))
    .map((i) => ({
      name: i.name,
      unitBuy: i.unitBuy,
      priceTotal: i.priceTotal,
      qtyBought: i.qtyBought,
      unitCostBase: i.unitCostBase,
    }));

  return snapshot;
}

function buildModelRecipeSnapshot(itemsSnapshot) {
  const keyFor = (name, unitBuy) => `${normalizeNameKey(name)}|${unitBuy}`;
  const map = new Map(itemsSnapshot.map((i) => [keyFor(i.name, i.unitBuy), i]));

  // Se houver múltiplos itens iguais (mesmo nome/unidade), ainda funciona por chave
  return state.recipe
    .map((r) => {
      const it = state.items.find((x) => x.id === r.itemId);
      if (!it) return null;
      const key = keyFor(it.name, it.unitBuy);
      if (!map.has(key)) return null;
      return { itemKey: key, qtyUsedBase: r.qtyUsedBase };
    })
    .filter(Boolean);
}

function saveCurrentAsModel(name) {
  const cleanName = String(name || "").trim();
  if (!cleanName) return false;

  if (!state.recipe.length) return false;

  const itemsSnap = getUsedItemsSnapshot();
  const recipeSnap = buildModelRecipeSnapshot(itemsSnap);

  const m = {
    id: uid(),
    name: cleanName,
    createdAt: Date.now(),
    items: itemsSnap,
    recipe: recipeSnap,
    pricing: { ...state.pricing },
  };

  state.models.unshift(m);
  save();
  renderModelsTable();
  return true;
}

function loadModel(modelId) {
  const m = state.models.find((x) => x.id === modelId);
  if (!m) return;

  const keyFor = (name, unitBuy) => `${normalizeNameKey(name)}|${unitBuy}`;

  // garante itens existentes (sem sobrescrever os atuais)
  const mapKeyToItemId = new Map();

  m.items.forEach((snap) => {
    const key = keyFor(snap.name, snap.unitBuy);

    const existing = state.items.find(
      (it) => normalizeNameKey(it.name) === normalizeNameKey(snap.name) && it.unitBuy === snap.unitBuy
    );

    if (existing) {
      mapKeyToItemId.set(key, existing.id);
      return;
    }

    const newId = uid();
    state.items.unshift({
      id: newId,
      name: snap.name,
      unitBuy: snap.unitBuy,
      priceTotal: snap.priceTotal,
      qtyBought: snap.qtyBought,
      unitCostBase: snap.unitCostBase,
    });

    mapKeyToItemId.set(key, newId);
  });

  // monta receita
  state.recipe = m.recipe
    .map((r) => {
      const itemId = mapKeyToItemId.get(r.itemKey);
      if (!itemId) return null;
      const it = state.items.find((x) => x.id === itemId);
      if (!it) return null;

      const qtyUsedBase = Math.max(0, Number(r.qtyUsedBase) || 0);
      if (qtyUsedBase <= 0) return null;

      return {
        id: uid(),
        itemId,
        qtyUsedBase,
        cost: qtyUsedBase * it.unitCostBase,
      };
    })
    .filter(Boolean);

  // aplica pricing
  state.pricing = {
    portions: Math.max(1, Math.floor(Number(m.pricing.portions) || 1)),
    margin: Math.max(0, Number(m.pricing.margin) || 0),
    extra: Math.max(0, Number(m.pricing.extra) || 0),
    sale: Math.max(0, Number(m.pricing.sale) || 0),
  };

  editingItemId = null;
  editingRecipeId = null;

  save();
  renderAll();
}

/* =========================
   Export JSON / CSV (7)
========================= */
function exportJSON() {
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "receita-custos.json";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const s = String(value ?? "");
  if (/[;"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV() {
  const { portions, margin, extra, sale } = validatePricingInputs();
  const totalBase = state.recipe.reduce((acc, r) => acc + (r.cost || 0), 0);
  const total = totalBase + extra;
  const costPer = total / portions;
  const suggested = costPer * (1 + margin / 100);

  // agrupa receita por item
  const byItem = new Map();
  for (const r of state.recipe) {
    const prev = byItem.get(r.itemId) || { qty: 0, cost: 0 };
    byItem.set(r.itemId, { qty: prev.qty + r.qtyUsedBase, cost: prev.cost + r.cost });
  }

  const lines = [];

  // Cabeçalho
  lines.push(["SEÇÃO", "CAMPO", "VALOR"].map(csvEscape).join(";"));
  lines.push(["Resumo", "Custo base (R$)", totalBase.toFixed(2)].map(csvEscape).join(";"));
  lines.push(["Resumo", "Extras (R$)", extra.toFixed(2)].map(csvEscape).join(";"));
  lines.push(["Resumo", "Custo total (R$)", total.toFixed(2)].map(csvEscape).join(";"));
  lines.push(["Resumo", "Porções", portions].map(csvEscape).join(";"));
  lines.push(["Resumo", "Custo por porção (R$)", costPer.toFixed(2)].map(csvEscape).join(";"));
  lines.push(["Resumo", "Margem (%)", margin].map(csvEscape).join(";"));
  lines.push(["Resumo", "Preço sugerido (R$)", suggested.toFixed(2)].map(csvEscape).join(";"));
  lines.push(["Resumo", "Preço praticado (R$)", sale ? sale.toFixed(2) : ""].map(csvEscape).join(";"));
  lines.push("");

  // Itens cadastrados
  lines.push(["SEÇÃO", "ITEM", "UNIDADE COMPRA", "PREÇO PAGO (R$)", "QTD COMPRADA", "CUSTO POR BASE (R$/g|ml|un)"].map(csvEscape).join(";"));
  state.items.forEach((it) => {
    lines.push([
      "Itens",
      it.name,
      it.unitBuy,
      it.priceTotal.toFixed(2),
      it.qtyBought,
      it.unitCostBase.toFixed(6),
    ].map(csvEscape).join(";"));
  });
  lines.push("");

  // Receita
  lines.push(["SEÇÃO", "ITEM", "QTD USADA (BASE)", "UNIDADE BASE", "CUSTO (R$)"].map(csvEscape).join(";"));
  [...byItem.entries()].forEach(([itemId, v]) => {
    const it = state.items.find((x) => x.id === itemId);
    const name = it ? it.name : "Item removido";
    const unitBase = it ? displayUnit(it.unitBuy) : "-";
    lines.push([
      "Receita",
      name,
      v.qty,
      unitBase,
      v.cost.toFixed(2),
    ].map(csvEscape).join(";"));
  });

  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "custos-receita.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

/* =========================
   Ajuda (18) + Atalhos (14)
========================= */
function openHelp() {
  const wrap = document.createElement("div");
  wrap.className = "help-grid";

  const steps = [
    ["Cadastre seus itens", "Informe nome, unidade de compra, preço pago e quantidade comprada. O sistema calcula o custo por g/ml/un automaticamente."],
    ["Monte a receita", "Selecione um item e informe a quantidade usada na unidade base (g/ml/un)."],
    ["Ajuste porções e margem", "Defina quantas porções a receita rende e a margem de lucro desejada. Adicione extras (embalagem, taxa do app)."],
    ["Use o preço praticado", "Se você já vende por um valor fixo, preencha “Preço de venda praticado” para ver lucro e margem reais."],
    ["Salve modelos", "Depois de montar uma receita, salve como modelo (Açaí 500ml, 700ml, 1L) para recarregar em segundos."],
  ];

  steps.forEach(([t, d]) => {
    const box = document.createElement("div");
    box.className = "help-step";
    const strong = document.createElement("strong");
    strong.textContent = t;
    const span = document.createElement("span");
    span.textContent = d;
    box.appendChild(strong);
    box.appendChild(span);
    wrap.appendChild(box);
  });

  openModal({
    title: "Como usar",
    body: wrap,
    actions: [{ label: "Fechar", value: true, className: "btn btn--primary" }],
  });
}

document.addEventListener("keydown", (e) => {
  // Alt+1 = foco no nome do item, Alt+2 = foco no select da receita, Alt+3 = foco na quantidade usada, Alt+H = ajuda
  if (e.altKey && !e.ctrlKey && !e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === "1") {
      e.preventDefault();
      itemNome.focus();
    }
    if (k === "2") {
      e.preventDefault();
      usoItem.focus();
    }
    if (k === "3") {
      e.preventDefault();
      usoQtd.focus();
    }
    if (k === "h") {
      e.preventDefault();
      openHelp();
    }
  }
});

/* =========================
   Events
========================= */
formItem.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!validateItemForm()) return;

  const name = itemNome.value.trim();
  const unitBuy = itemUnidadeCompra.value;
  const priceTotal = Math.max(0, parseNumberBR(itemPrecoTotal.value));
  const qtyBought = Math.max(0, parseNumberBR(itemQtdCompra.value));

  const unitCostBase = calcUnitCostBRL(priceTotal, qtyBought, unitBuy);

  state.items.unshift({
    id: uid(),
    name,
    unitBuy,
    priceTotal,
    qtyBought,
    unitCostBase,
  });

  itemNome.value = "";
  itemPrecoTotal.value = "";
  itemQtdCompra.value = "";
  itemNome.focus();

  save();
  renderAll();
});

tbodyItens.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const it = state.items.find((x) => x.id === id);
  if (!it) return;

  if (action === "delete-item") {
    const ok = await modalConfirm(`Excluir o item “${it.name}”? Isso também remove esse item da receita.`, "Excluir item");
    if (!ok) return;

    state.items = state.items.filter((x) => x.id !== id);
    state.recipe = state.recipe.filter((r) => r.itemId !== id);

    editingItemId = null;
    save();
    renderAll();
    return;
  }

  if (action === "edit-item") {
    editingItemId = id;
    editingRecipeId = null;
    renderAll();

    // foca primeiro input da linha
    requestAnimationFrame(() => {
      const row = tbodyItens.querySelector(`tr[data-row="item-edit"][data-id="${id}"]`);
      const first = row ? row.querySelector('input[data-edit="name"]') : null;
      if (first) first.focus();
    });
    return;
  }

  if (action === "cancel-item") {
    editingItemId = null;
    renderAll();
    return;
  }

  if (action === "save-item") {
    const row = tbodyItens.querySelector(`tr[data-row="item-edit"][data-id="${id}"]`);
    if (!row) return;

    const nameEl = row.querySelector('input[data-edit="name"]');
    const priceEl = row.querySelector('input[data-edit="price"]');
    const qtyEl = row.querySelector('input[data-edit="qty"]');

    const name = String(nameEl.value || "").trim();
    const priceTotal = Math.max(0, parseNumberBR(priceEl.value));
    const qtyBought = Math.max(0, parseNumberBR(qtyEl.value));

    if (!name || name.length < 2) {
      await modalAlert("Informe um nome válido (mínimo 2 caracteres).", "Edição de item");
      nameEl.focus();
      return;
    }
    if (!(priceTotal > 0)) {
      await modalAlert("Informe um preço maior que zero.", "Edição de item");
      priceEl.focus();
      return;
    }
    if (!(qtyBought > 0)) {
      await modalAlert("Informe uma quantidade maior que zero.", "Edição de item");
      qtyEl.focus();
      return;
    }

    it.name = name;
    it.priceTotal = priceTotal;
    it.qtyBought = qtyBought;
    it.unitCostBase = calcUnitCostBRL(priceTotal, qtyBought, it.unitBuy);

    // recalcula custos da receita desse item
    state.recipe.forEach((r) => {
      if (r.itemId === it.id) r.cost = r.qtyUsedBase * it.unitCostBase;
    });

    editingItemId = null;
    save();
    renderAll();
  }
});

usoItem.addEventListener("change", updateUsoHint);

formUso.addEventListener("submit", (e) => {
  e.preventDefault();

  if (!validateRecipeForm()) return;

  const itemId = usoItem.value;
  const it = state.items.find((x) => x.id === itemId);
  if (!it) return;

  const qtyUsedBase = Math.max(0, parseNumberBR(usoQtd.value));
  const cost = qtyUsedBase * it.unitCostBase;

  state.recipe.unshift({
    id: uid(),
    itemId,
    qtyUsedBase,
    cost,
  });

  usoQtd.value = "";
  usoQtd.focus();

  save();
  renderAll();
});

tbodyReceita.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");

  const r = state.recipe.find((x) => x.id === id);
  if (!r) return;

  if (action === "delete-recipe") {
    const ok = await modalConfirm("Remover este item da receita?", "Remover item");
    if (!ok) return;

    state.recipe = state.recipe.filter((x) => x.id !== id);
    editingRecipeId = null;
    save();
    renderAll();
    return;
  }

  if (action === "edit-recipe") {
    editingRecipeId = id;
    editingItemId = null;
    renderAll();
    requestAnimationFrame(() => {
      const row = tbodyReceita.querySelector(`tr[data-row="recipe-edit"][data-id="${id}"]`);
      const first = row ? row.querySelector('input[data-edit="qty"]') : null;
      if (first) first.focus();
    });
    return;
  }

  if (action === "cancel-recipe") {
    editingRecipeId = null;
    renderAll();
    return;
  }

  if (action === "save-recipe") {
    const row = tbodyReceita.querySelector(`tr[data-row="recipe-edit"][data-id="${id}"]`);
    if (!row) return;

    const qtyEl = row.querySelector('input[data-edit="qty"]');
    const qtyUsedBase = Math.max(0, parseNumberBR(qtyEl.value));

    if (!(qtyUsedBase > 0)) {
      await modalAlert("Informe uma quantidade maior que zero.", "Edição da receita");
      qtyEl.focus();
      return;
    }

    const it = state.items.find((x) => x.id === r.itemId);
    if (!it) {
      await modalAlert("Este item não existe mais. Remova e adicione novamente.", "Edição da receita");
      editingRecipeId = null;
      renderAll();
      return;
    }

    r.qtyUsedBase = qtyUsedBase;
    r.cost = qtyUsedBase * it.unitCostBase;

    editingRecipeId = null;
    save();
    renderAll();
  }
});

btnLimparReceita.addEventListener("click", async () => {
  if (!state.recipe.length) return;
  const ok = await modalConfirm("Limpar todos os itens da receita atual?", "Limpar receita");
  if (!ok) return;

  state.recipe = [];
  editingRecipeId = null;
  save();
  renderAll();
});

[numPorcoes, margemLucro, taxaExtra, precoVenda].forEach((el) => {
  el.addEventListener("input", renderKPIs);
  el.addEventListener("blur", () => {
    applyFormatOnBlur(el);
    renderKPIs();
  });
});

// Autoformat nos inputs principais (16)
[itemPrecoTotal, itemQtdCompra, usoQtd, modelName].forEach((el) => {
  if (!el) return;
  if (el === modelName) return;
  el.addEventListener("blur", () => applyFormatOnBlur(el));
});

btnReset.addEventListener("click", async () => {
  const ok = await modalConfirm("Tem certeza que deseja limpar todos os itens e a receita? Essa ação não pode ser desfeita.", "Limpar tudo");
  if (!ok) return;

  state.items = [];
  state.recipe = [];
  state.models = [];
  state.pricing = { portions: 1, margin: 70, extra: 0, sale: 0 };

  localStorage.removeItem(STORAGE_KEY_V1);
  localStorage.removeItem(STORAGE_KEY_V2);

  editingItemId = null;
  editingRecipeId = null;

  renderAll();
});

btnDemo.addEventListener("click", () => {
  state.items = [
    {
      id: uid(),
      name: "Açaí",
      unitBuy: "kg",
      priceTotal: 79.9,
      qtyBought: 10,
      unitCostBase: calcUnitCostBRL(79.9, 10, "kg"),
    },
    {
      id: uid(),
      name: "Leite em pó",
      unitBuy: "kg",
      priceTotal: 32.0,
      qtyBought: 1,
      unitCostBase: calcUnitCostBRL(32.0, 1, "kg"),
    },
    {
      id: uid(),
      name: "Granola",
      unitBuy: "g",
      priceTotal: 9.5,
      qtyBought: 500,
      unitCostBase: calcUnitCostBRL(9.5, 500, "g"),
    },
    {
      id: uid(),
      name: "Banana",
      unitBuy: "kg",
      priceTotal: 6.9,
      qtyBought: 1,
      unitCostBase: calcUnitCostBRL(6.9, 1, "kg"),
    },
    {
      id: uid(),
      name: "Copo 500ml",
      unitBuy: "un",
      priceTotal: 45,
      qtyBought: 100,
      unitCostBase: calcUnitCostBRL(45, 100, "un"),
    },
  ];

  state.recipe = [];
  state.models = [];
  state.pricing = { portions: 1, margin: 70, extra: 0, sale: 0 };

  save();
  renderAll();
});

btnExport.addEventListener("click", exportJSON);
btnExportCSV.addEventListener("click", exportCSV);

fileImport.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;

  try {
    const txt = await file.text();
    const raw = JSON.parse(txt);

    const cleaned = validateImportedState(raw);
    state.items = cleaned.items;
    state.recipe = cleaned.recipe;
    state.pricing = cleaned.pricing;
    state.models = cleaned.models;

    editingItemId = null;
    editingRecipeId = null;

    save();
    renderAll();
    await modalAlert("Importado com sucesso!", "Importar");
  } catch (_) {
    await modalAlert("Falha ao importar: arquivo inválido ou estrutura incorreta.", "Importar");
  } finally {
    fileImport.value = "";
  }
});

btnHelp.addEventListener("click", openHelp);

/* Modelos */
btnClearModelName.addEventListener("click", () => {
  modelName.value = "";
  modelName.focus();
});

btnSaveModel.addEventListener("click", async () => {
  // validação leve
  document.getElementById("modelNameErr").textContent = "";
  modelName.closest(".field").classList.remove("field--error");

  const name = modelName.value.trim();

  if (!state.recipe.length) {
    modelName.closest(".field").classList.add("field--error");
    document.getElementById("modelNameErr").textContent = "Monte uma receita antes de salvar um modelo.";
    return;
  }

  if (!name || name.length < 3) {
    modelName.closest(".field").classList.add("field--error");
    document.getElementById("modelNameErr").textContent = "Informe um nome (mínimo 3 caracteres).";
    modelName.focus();
    return;
  }

  const ok = saveCurrentAsModel(name);
  if (!ok) {
    await modalAlert("Não foi possível salvar. Verifique se a receita tem itens.", "Modelos");
    return;
  }

  modelName.value = "";
  modelName.focus();
});

tbodyModels.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.getAttribute("data-action");
  const id = btn.getAttribute("data-id");
  const m = state.models.find((x) => x.id === id);
  if (!m) return;

  if (action === "load-model") {
    const ok = await modalConfirm(`Carregar o modelo “${m.name}”? Isso substituirá a receita atual.`, "Carregar modelo");
    if (!ok) return;

    loadModel(id);
    return;
  }

  if (action === "delete-model") {
    const ok = await modalConfirm(`Excluir o modelo “${m.name}”?`, "Excluir modelo");
    if (!ok) return;

    state.models = state.models.filter((x) => x.id !== id);
    save();
    renderModelsTable();
    return;
  }

  if (action === "duplicate-model") {
    const newName = await modalPrompt({
      title: "Duplicar modelo",
      label: "Novo nome do modelo",
      defaultValue: `${m.name} (cópia)`,
      placeholder: "Ex.: Açaí 700ml Premium",
    });

    if (newName == null) return;

    const clean = String(newName).trim();
    if (!clean || clean.length < 3) {
      await modalAlert("Informe um nome válido (mínimo 3 caracteres).", "Duplicar modelo");
      return;
    }

    state.models.unshift({
      ...m,
      id: uid(),
      name: clean,
      createdAt: Date.now(),
    });

    save();
    renderModelsTable();
  }
});

/* Atalho Enter em edição inline (14) */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  if (modalRoot && !modalRoot.hidden) return;

  const active = document.activeElement;
  if (!active) return;

  const rowItem = active.closest && active.closest('tr[data-row="item-edit"]');
  if (rowItem) {
    e.preventDefault();
    const id = rowItem.getAttribute("data-id");
    const btn = rowItem.querySelector(`button[data-action="save-item"][data-id="${id}"]`);
    if (btn) btn.click();
    return;
  }

  const rowRecipe = active.closest && active.closest('tr[data-row="recipe-edit"]');
  if (rowRecipe) {
    e.preventDefault();
    const id = rowRecipe.getAttribute("data-id");
    const btn = rowRecipe.querySelector(`button[data-action="save-recipe"][data-id="${id}"]`);
    if (btn) btn.click();
  }
});

/* =========================
   Init
========================= */
document.getElementById("year").textContent = String(new Date().getFullYear());
appVersion.textContent = APP_VERSION;

[itemPrecoTotal, taxaExtra, precoVenda].forEach((el) => {
  el.addEventListener("blur", () => applyFormatOnBlur(el));
});
[itemQtdCompra, usoQtd, margemLucro].forEach((el) => {
  el.addEventListener("blur", () => applyFormatOnBlur(el));
});
[numPorcoes].forEach((el) => {
  el.addEventListener("blur", () => applyFormatOnBlur(el));
});

load();
renderAll();