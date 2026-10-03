(function () {
  "use strict";

  const ledgerBody = document.getElementById("ledgerBody");
  const categoryOptions = document.getElementById("categoryOptions");
  const tagNodeTemplate = document.getElementById("tagNodeTemplate");

  const sumIncomeEl = document.getElementById("sumIncome");
  const sumExpenseEl = document.getElementById("sumExpense");
  const sumSavingsEl = document.getElementById("sumSavings");
  const sumBalanceEl = document.getElementById("sumBalance");

  const uploadForm = document.getElementById("uploadForm");
  const uploadBox = document.getElementById("uploadBox");
  const fileInput = document.getElementById("fileInput");
  const uploadStatus = document.getElementById("uploadStatus");
  const uploadBtn = document.getElementById("uploadBtn");

  const filterMainCategory = document.getElementById("filterMainCategory");
  const filterAttrSearch = document.getElementById("filterAttrSearch");
  const filterKind = document.getElementById("filterKind");
  const filterDateFrom = document.getElementById("filterDateFrom");
  const filterDateTo = document.getElementById("filterDateTo");
  const filterReset = document.getElementById("filterReset");
  const filterCount = document.getElementById("filterCount");

  const openPieChartBtn = document.getElementById("openPieChart");
  const openBarChartBtn = document.getElementById("openBarChart");
  const chartModal = document.getElementById("chartModal");
  const chartModalBackdrop = document.getElementById("chartModalBackdrop");
  const chartModalClose = document.getElementById("chartModalClose");
  const chartModalTitle = document.getElementById("chartModalTitle");
  const chartCanvas = document.getElementById("chartCanvas");

  let allTransactions = [];
  // Tételek, amelyeket a felhasználó kivett a kijelölésből (checkbox kipipálatlan).
  // Alapesetben minden tétel ki van jelölve (benne van az összesítésekben/diagramokban).
  const excludedIds = new Set();

  let chartInstance = null;
  let activeChartType = null; // "pie" | "bar" | null

  // A táblázat és a diagramok ugyanazt a tematikus palettát használják, hogy egy
  // adott fő attribútum mindkét diagramon ugyanazt a színt kapja.
  const CHART_PALETTE = [
    "#2F6F4E", "#9C4221", "#2B5F8A", "#B08900", "#6B4A8A",
    "#1D7A7A", "#A3472F", "#4D6B2F", "#8A4B6B", "#3E5C76",
    "#B5651D", "#4A7A5E", "#7A4A4A", "#5E5EA6", "#8A7A2F",
  ];
  const categoryColorMap = new Map();
  function colorForCategory(name) {
    if (!categoryColorMap.has(name)) {
      categoryColorMap.set(name, CHART_PALETTE[categoryColorMap.size % CHART_PALETTE.length]);
    }
    return categoryColorMap.get(name);
  }

  const fmt = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 0 });
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split("-");
    return `${y}.${m}.${d}.`;
  };

  function debounce(fn, wait) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  async function api(url, options) {
    const res = await fetch(url, options);
    let body = null;
    try {
      body = await res.json();
    } catch (e) {
      /* nincs json test */
    }
    if (!res.ok) {
      throw new Error((body && body.error) || `Hiba (${res.status})`);
    }
    return body;
  }

  // ---------- betöltés ----------

  async function loadCategories() {
    try {
      const cats = await api("/api/categories");
      const suggestions = Array.from(new Set([...cats, "megtakarítás"])).sort();
      categoryOptions.innerHTML = suggestions.map((c) => `<option value="${escapeHtml(c)}">`).join("");

      const previouslySelected = filterMainCategory.value;
      filterMainCategory.innerHTML =
        '<option value="">Összes</option>' +
        cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
      if (cats.includes(previouslySelected)) {
        filterMainCategory.value = previouslySelected;
      }
    } catch (e) {
      /* csendben elnyeljük, nem kritikus */
    }
  }

  async function loadTransactions() {
    allTransactions = await api("/api/transactions");
    renderAll();
  }

  // ---------- szűrés + kijelölés ----------

  function attributeTreeMatches(attributes, searchLower) {
    for (const a of attributes) {
      if (a.name.toLowerCase().includes(searchLower)) return true;
      if (a.children.length && attributeTreeMatches(a.children, searchLower)) return true;
    }
    return false;
  }

  function applyFilters(txs) {
    const mainCat = filterMainCategory.value;
    const search = filterAttrSearch.value.trim().toLowerCase();
    const kind = filterKind.value;
    const dateFrom = filterDateFrom.value; // "" vagy "YYYY-MM-DD"
    const dateTo = filterDateTo.value;

    return txs.filter((t) => {
      if (mainCat && (t.main_category || "") !== mainCat) return false;
      if (search && !attributeTreeMatches(t.attributes, search)) return false;
      if (kind === "income" && t.kind !== "bevétel") return false;
      if (kind === "expense" && t.kind !== "kiadás") return false;
      if (kind === "savings" && t.kind !== "megtakarítás") return false;
      if (dateFrom && t.date < dateFrom) return false;
      if (dateTo && t.date > dateTo) return false;
      return true;
    });
  }

  function hasActiveFilters() {
    return !!(
      filterMainCategory.value ||
      filterAttrSearch.value.trim() ||
      filterKind.value ||
      filterDateFrom.value ||
      filterDateTo.value
    );
  }

  // A szűrt listán belül csak a kipipált (nem kizárt) tételek számítanak az
  // összesítésekbe és a diagramokba.
  function getIncluded(filtered) {
    return filtered.filter((t) => !excludedIds.has(t.id));
  }

  function renderAll() {
    const filtered = applyFilters(allTransactions);
    const included = getIncluded(filtered);

    renderSummary(included);
    renderLedger(filtered);
    updateFilterCount(filtered, included);

    if (activeChartType) {
      renderChart(activeChartType);
    }
  }

  function updateFilterCount(filtered, included) {
    if (!allTransactions.length) {
      filterCount.textContent = "";
      return;
    }
    const excludedInView = filtered.length - included.length;
    let text = hasActiveFilters()
      ? `${filtered.length} / ${allTransactions.length} tétel`
      : `${allTransactions.length} tétel`;
    if (excludedInView > 0) {
      text += ` (${excludedInView} kijelölés nélkül)`;
    }
    filterCount.textContent = text;
  }

  function renderSummary(txs) {
    let income = 0;
    let expense = 0;
    let savings = 0;
    for (const t of txs) {
      if (t.kind === "bevétel") income += t.amount;
      else if (t.kind === "kiadás") expense += t.amount;
      else if (t.kind === "megtakarítás") savings += t.amount;
    }
    const balance = income + expense + savings;
    sumIncomeEl.textContent = fmt.format(income) + " Ft";
    sumExpenseEl.textContent = fmt.format(expense) + " Ft";
    sumSavingsEl.textContent = fmt.format(savings) + " Ft";
    sumBalanceEl.textContent = fmt.format(balance) + " Ft";
  }

  function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = s == null ? "" : s;
    return div.innerHTML;
  }

  function renderLedger(txs) {
    ledgerBody.innerHTML = "";
    if (!txs.length) {
      const msg = allTransactions.length
        ? "A szűrésnek egyetlen tétel sem felel meg."
        : "Nincs még adat — tölts fel egy kivonatot.";
      ledgerBody.innerHTML = `<tr><td colspan="8" class="ledger__empty">${msg}</td></tr>`;
      return;
    }
    for (const tx of txs) {
      ledgerBody.appendChild(renderRow(tx));
    }
  }

  function renderRow(tx) {
    const tr = document.createElement("tr");
    tr.dataset.txId = tx.id;
    const isExcluded = excludedIds.has(tx.id);
    if (isExcluded) tr.classList.add("row-excluded");

    const tdCheck = document.createElement("td");
    tdCheck.className = "col-check";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "row-check";
    checkbox.checked = !isExcluded;
    checkbox.title = "Beleszámítson-e a bevétel/kiadás/megtakarítás összesítésekbe és a diagramokba";
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) excludedIds.delete(tx.id);
      else excludedIds.add(tx.id);
      renderAll();
    });
    tdCheck.appendChild(checkbox);

    const tdDate = document.createElement("td");
    tdDate.className = "col-date";
    tdDate.textContent = fmtDate(tx.date);

    const tdType = document.createElement("td");
    tdType.className = "col-type";
    tdType.textContent = tx.tx_type || "";

    const tdDesc = document.createElement("td");
    tdDesc.className = "col-desc";
    const descSpan = document.createElement("span");
    descSpan.className = "desc-text";
    descSpan.textContent = tx.description || "";
    tdDesc.appendChild(descSpan);

    const tdAmount = document.createElement("td");
    const kindClass =
      tx.kind === "megtakarítás" ? "amount--savings" : tx.kind === "bevétel" ? "amount--income" : "amount--expense";
    tdAmount.className = "col-amount " + kindClass;
    tdAmount.textContent = fmt.format(tx.amount) + " Ft";

    const tdMain = document.createElement("td");
    tdMain.className = "col-main";
    tdMain.appendChild(buildMainCategoryInput(tx));

    const tdTags = document.createElement("td");
    tdTags.className = "col-tags";
    tdTags.appendChild(buildTagBox(tx));

    const tdDel = document.createElement("td");
    tdDel.className = "col-del";
    tdDel.appendChild(buildDeleteButton(tx, tr));

    tr.append(tdCheck, tdDate, tdType, tdDesc, tdAmount, tdMain, tdTags, tdDel);
    return tr;
  }

  // ---------- fő attribútum ----------

  function buildMainCategoryInput(tx) {
    const wrap = document.createElement("div");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "cat-input source-" + (tx.category_source || "none");
    input.value = tx.main_category || "";
    input.placeholder = "nincs beállítva";
    input.setAttribute("list", "categoryOptions");

    const note = document.createElement("span");
    note.className = "cat-source-note";
    note.textContent =
      tx.category_source === "auto" ? "automatikus" : tx.category_source === "manual" ? "kézi" : "";

    const save = debounce(async () => {
      try {
        await api(`/api/transactions/${tx.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ main_category: input.value }),
        });
        input.className = "cat-input source-manual";
        note.textContent = "kézi";
        await loadCategories();
        // Teljes újratöltés kell (nem csak helyi state-frissítés), hogy az
        // összesítő és a nyitott diagram is azonnal tükrözze a változást —
        // ez különösen fontos, ha a fő attribútum "megtakarítás"-ra változik.
        await loadTransactions();
      } catch (e) {
        note.textContent = "hiba a mentéskor";
      }
    }, 500);

    input.addEventListener("input", save);

    wrap.append(input, note);
    return wrap;
  }

  // ---------- al-attribútum fa ----------

  function buildTagBox(tx) {
    const box = document.createElement("div");
    box.className = "tagbox";

    for (const attr of tx.attributes) {
      box.appendChild(buildTagNode(tx.id, attr));
    }

    const addRootBtn = document.createElement("button");
    addRootBtn.type = "button";
    addRootBtn.className = "tag-add-root";
    addRootBtn.textContent = "+ al-attribútum";
    addRootBtn.addEventListener("click", async () => {
      const name = prompt("Új al-attribútum neve:");
      if (!name || !name.trim()) return;
      try {
        await api(`/api/transactions/${tx.id}/attributes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), parent_id: null }),
        });
        loadTransactions();
      } catch (e) {
        alert(e.message);
      }
    });

    box.appendChild(addRootBtn);
    return box;
  }

  function buildTagNode(txId, attr) {
    const node = tagNodeTemplate.content.firstElementChild.cloneNode(true);
    const nameEl = node.querySelector(".tag__name");
    const addBtn = node.querySelector(".tag__add");
    const delBtn = node.querySelector(".tag__del");
    const childrenEl = node.querySelector(".tag__children");

    nameEl.textContent = attr.name;

    const saveName = debounce(async () => {
      const val = nameEl.textContent.trim();
      if (!val) {
        nameEl.textContent = attr.name;
        return;
      }
      try {
        await api(`/api/attributes/${attr.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: val }),
        });
      } catch (e) {
        alert(e.message);
      }
    }, 600);

    nameEl.addEventListener("input", saveName);
    nameEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        nameEl.blur();
      }
    });

    addBtn.addEventListener("click", async () => {
      const name = prompt("Al-attribútum neve (" + attr.name + " alá):");
      if (!name || !name.trim()) return;
      try {
        await api(`/api/transactions/${txId}/attributes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim(), parent_id: attr.id }),
        });
        loadTransactions();
      } catch (e) {
        alert(e.message);
      }
    });

    delBtn.addEventListener("click", async () => {
      if (!confirm(`Törlöd "${attr.name}" attribútumot (az alá tartozókkal együtt)?`)) return;
      try {
        await api(`/api/attributes/${attr.id}`, { method: "DELETE" });
        loadTransactions();
      } catch (e) {
        alert(e.message);
      }
    });

    for (const child of attr.children) {
      childrenEl.appendChild(buildTagNode(txId, child));
    }

    return node;
  }

  // ---------- tranzakció törlése ----------

  function buildDeleteButton(tx) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "row-del";
    btn.title = "Tétel törlése";
    btn.textContent = "🗑";
    btn.addEventListener("click", async () => {
      const label = tx.description || tx.tx_type || tx.date;
      if (!confirm(`Törlöd ezt a tételt?\n\n${tx.date} — ${label} — ${fmt.format(tx.amount)} Ft`)) return;
      try {
        await api(`/api/transactions/${tx.id}`, { method: "DELETE" });
        excludedIds.delete(tx.id);
        await loadTransactions();
      } catch (e) {
        alert(e.message);
      }
    });
    return btn;
  }

  // ---------- feltöltés ----------

  uploadBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    uploadBox.classList.add("dragover");
  });
  uploadBox.addEventListener("dragleave", () => uploadBox.classList.remove("dragover"));
  uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadBox.classList.remove("dragover");
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      updateUploadHint();
    }
  });

  function updateUploadHint() {
    const hint = uploadBox.querySelector(".upload__hint");
    if (fileInput.files.length) {
      hint.textContent = fileInput.files[0].name;
    }
  }
  fileInput.addEventListener("change", updateUploadHint);

  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!fileInput.files.length) {
      uploadStatus.textContent = "Válassz ki egy fájlt előbb.";
      uploadStatus.className = "upload__status error";
      return;
    }
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    uploadBtn.disabled = true;
    uploadStatus.textContent = "Feldolgozás folyamatban…";
    uploadStatus.className = "upload__status";

    try {
      const result = await api("/api/upload", { method: "POST", body: formData });
      uploadStatus.textContent = `Kész: ${result.inserted} új tranzakció importálva (${result.skipped} már létezett).`;
      uploadStatus.className = "upload__status success";
      await loadCategories();
      await loadTransactions();
    } catch (e) {
      uploadStatus.textContent = e.message;
      uploadStatus.className = "upload__status error";
    } finally {
      uploadBtn.disabled = false;
    }
  });

  // ---------- szűrő vezérlők ----------

  filterMainCategory.addEventListener("change", renderAll);
  filterKind.addEventListener("change", renderAll);
  filterAttrSearch.addEventListener("input", debounce(renderAll, 200));
  filterDateFrom.addEventListener("change", renderAll);
  filterDateTo.addEventListener("change", renderAll);

  filterReset.addEventListener("click", () => {
    filterMainCategory.value = "";
    filterAttrSearch.value = "";
    filterKind.value = "";
    filterDateFrom.value = "";
    filterDateTo.value = "";
    renderAll();
  });

  // ---------- diagramok (Chart.js) ----------

  function expensesByCategory() {
    const filtered = applyFilters(allTransactions);
    const included = getIncluded(filtered);
    const totals = new Map();
    for (const t of included) {
      if (t.kind !== "kiadás") continue;
      const key = t.main_category || "nincs kategória";
      totals.set(key, (totals.get(key) || 0) + -t.amount);
    }
    // Legnagyobb költés elöl, utána csökkenő sorrendben.
    return Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
  }

  function renderChart(type) {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }

    if (typeof Chart === "undefined") {
      chartModalTitle.textContent = "Diagram";
      const ctx = chartCanvas.getContext("2d");
      ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
      ctx.fillStyle = "#9C4221";
      ctx.font = "14px Inter, sans-serif";
      ctx.fillText("A Chart.js könyvtár nem töltődött be (nincs internet-elérés?).", 10, 30);
      return;
    }

    const data = expensesByCategory();
    const labels = data.map(([category]) => category);
    const values = data.map(([, amount]) => amount);
    const colors = labels.map((label) => colorForCategory(label));

    if (!labels.length) {
      const ctx = chartCanvas.getContext("2d");
      ctx.clearRect(0, 0, chartCanvas.width, chartCanvas.height);
      chartModalTitle.textContent = type === "pie" ? "Kiadások megoszlása" : "Kiadások fő attribútum szerint";
      return;
    }

    if (type === "pie") {
      chartModalTitle.textContent = "Kiadások megoszlása (fő attribútum szerint)";
      chartInstance = new Chart(chartCanvas, {
        type: "pie",
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: colors, borderColor: "#FFFFFF", borderWidth: 1 }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "right", labels: { font: { family: "Inter", size: 12 } } },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.label}: ${fmt.format(ctx.parsed)} Ft`,
              },
            },
          },
        },
      });
    } else {
      chartModalTitle.textContent = "Kiadások fő attribútum szerint";
      chartInstance = new Chart(chartCanvas, {
        type: "bar",
        data: {
          labels,
          datasets: [{ data: values, backgroundColor: colors, borderRadius: 2 }],
        },
        options: {
          indexAxis: "y",
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${fmt.format(ctx.parsed.x)} Ft`,
              },
            },
          },
          scales: {
            x: {
              ticks: { callback: (v) => fmt.format(v) },
              grid: { color: "#CBD0C2" },
            },
            y: {
              grid: { display: false },
            },
          },
        },
      });
    }
  }

  function openChartModal(type) {
    activeChartType = type;
    chartModal.classList.remove("hidden");
    renderChart(type);
  }

  function closeChartModal() {
    activeChartType = null;
    chartModal.classList.add("hidden");
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }

  openPieChartBtn.addEventListener("click", () => openChartModal("pie"));
  openBarChartBtn.addEventListener("click", () => openChartModal("bar"));
  chartModalClose.addEventListener("click", closeChartModal);
  chartModalBackdrop.addEventListener("click", closeChartModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !chartModal.classList.contains("hidden")) closeChartModal();
  });

  // ---------- init ----------

  loadCategories();
  loadTransactions();
})();
