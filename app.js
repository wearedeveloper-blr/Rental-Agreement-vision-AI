/**
 * app.js — UI orchestrator
 *
 * Renders the full application, wires events, calls clauseEngine + ocrEngine.
 */

import { auditAgreement } from "./clauseEngine.js";
import { extractTextFromImage, extractTextFromPDF, isImageFile, isPDFFile } from "./ocrEngine.js";
import { TEST_CASES, runTests } from "./tests.js";

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  files: [],
  ocrText: "",
  financials: {
    monthlyRent: 0,
    depositMonths: 2,
    tenancyMonths: 12,
    outstandingRent: 0,
    damageClaim: 0,
    paintingClaimed: false,
    paintingCost: 0,
    advanceRent: 0,
  },
  report: null,
  processing: false,
};

// ─── Bootstrap ────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  renderApp();
  wireEvents();
});

// ─── Render ───────────────────────────────────────────────────────────────────
function renderApp() {
  document.getElementById("app").innerHTML = `
    <header>
      <h1>Rental Clause Auditor <span class="city">— Bengaluru</span></h1>
      <p>Upload your agreement or paste the text. The tool flags illegal clauses and calculates exactly how much deposit your landlord must return.</p>
    </header>

    <!-- ── Upload ── -->
    <section id="upload-section">
      <div class="upload-card">

        <!-- Row 1: file -->
        <div class="upload-row">
          <div class="row-label">
            <span class="row-num">1</span>
            <span class="row-title">Upload agreement</span>
          </div>
          <div id="upload-zone" role="button" tabindex="0" aria-label="Upload agreement files">
            <span class="upload-icon">📄</span>
            <div class="up-main"><strong>Click to upload</strong> or drag and drop</div>
            <div class="up-sub">PDF, JPG, PNG, WebP — scanned pages and photos work too</div>
            <input type="file" id="file-input" multiple accept="image/*,application/pdf" />
          </div>
          <div class="file-list" id="file-list"></div>
          <div id="progress-bar-wrap"><div id="progress-bar"></div></div>
        </div>

        <!-- Row 2: text -->
        <div class="upload-row" id="ocr-panel" style="display:none">
          <div class="row-label">
            <span class="row-num">2</span>
            <span class="row-title">Agreement text</span>
          </div>
          <textarea id="ocr-text" placeholder="Text extracted from your upload will appear here.&#10;You can also paste agreement text directly."></textarea>
          <p class="ocr-hint">Edit or correct if OCR made mistakes. More text gives better results.</p>
        </div>

        <!-- Row 3: figures -->
        <div class="upload-row">
          <div class="row-label">
            <span class="row-num">3</span>
            <span class="row-title">Your figures</span>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Monthly rent (₹)</label>
              <div class="rupee-prefix">
                <input type="number" id="f-rent" min="0" step="500" placeholder="e.g. 25000" />
              </div>
            </div>
            <div class="form-group">
              <label>Deposit paid (months of rent)</label>
              <input type="number" id="f-deposit-months" min="1" max="24" step="1" value="2" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Months you stayed</label>
              <input type="number" id="f-tenancy" min="1" max="120" step="1" value="12" />
            </div>
            <div class="form-group">
              <label>Unpaid rent (₹)</label>
              <div class="rupee-prefix">
                <input type="number" id="f-outstanding" min="0" step="500" placeholder="0" />
              </div>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Landlord damage claim (₹)</label>
              <div class="rupee-prefix">
                <input type="number" id="f-damage" min="0" step="500" placeholder="0" />
              </div>
            </div>
            <div class="form-group">
              <label>Advance rent paid (months)</label>
              <input type="number" id="f-advance" min="0" max="6" step="1" value="0" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Landlord claiming painting charges?</label>
              <select id="f-painting-claimed">
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </div>
            <div class="form-group" id="painting-cost-group" style="display:none">
              <label>Quoted painting cost (₹)</label>
              <div class="rupee-prefix">
                <input type="number" id="f-painting-cost" min="0" step="500" placeholder="e.g. 15000" />
              </div>
            </div>
          </div>
          <div class="action-row" style="margin-top:16px">
            <button class="btn btn-primary" id="btn-analyze">Analyze agreement</button>
            <button class="btn btn-outline" id="btn-ocr-show">Paste text instead</button>
            <button class="btn btn-outline" id="btn-load-demo">Load demo</button>
          </div>
        </div>

      </div>
    </section>

    <!-- ── Results ── -->
    <section id="results-section">
      <div id="risk-banner-slot"></div>

      <div class="rcard">
        <div class="rcard-title">Risk score</div>
        <div id="score-slot"></div>
      </div>

      <div class="rcard">
        <div class="rcard-title">Clause findings</div>
        <div id="clauses-slot"></div>
      </div>

      <div class="rcard">
        <div class="rcard-title">Deposit refund</div>
        <div id="deposit-slot"></div>
      </div>

      <div class="rcard">
        <div class="rcard-title">What to do next</div>
        <div id="checklist-slot"></div>
      </div>

      <div class="action-row" style="margin-top:8px">
        <button class="btn btn-outline" id="btn-reset">← Analyze another agreement</button>
        <button class="btn btn-outline" onclick="window.print()">Print report</button>
      </div>
    </section>

    <!-- ── Tests ── -->
    <section id="test-section">
      <h2>Test suite — ${TEST_CASES.length} cases</h2>
      <div class="test-controls">
        <button class="btn btn-primary btn-sm" id="btn-run-tests">Run all</button>
        <button class="btn btn-outline btn-sm" id="btn-clear-tests">Clear</button>
      </div>
      <div id="test-summary-slot"></div>
      <div class="test-results" id="test-results-slot">
        ${renderTestCasesShell()}
      </div>
    </section>
  `;
}

// ─── Wire Events ──────────────────────────────────────────────────────────────
function wireEvents() {
  // File upload
  const zone = document.getElementById("upload-zone");
  const fileInput = document.getElementById("file-input");

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("dragover");
    handleFiles(Array.from(e.dataTransfer.files));
  });
  fileInput.addEventListener("change", () => handleFiles(Array.from(fileInput.files)));

  // Painting toggle
  document.getElementById("f-painting-claimed").addEventListener("change", (e) => {
    document.getElementById("painting-cost-group").style.display =
      e.target.value === "yes" ? "flex" : "none";
  });

  // Analyze
  document.getElementById("btn-analyze").addEventListener("click", doAnalyze);
  document.getElementById("btn-ocr-show").addEventListener("click", () => {
    document.getElementById("ocr-panel").style.display = "block";
    document.getElementById("ocr-panel").scrollIntoView({ behavior: "smooth" });
  });

  // Demo
  document.getElementById("btn-load-demo").addEventListener("click", loadDemo);

  // Reset
  document.addEventListener("click", (e) => {
    if (e.target.id === "btn-reset") {
      document.getElementById("results-section").style.display = "none";
      document.getElementById("upload-section").style.display = "block";
    }
  });

  // Tests
  document.getElementById("btn-run-tests").addEventListener("click", doRunTests);
  document.getElementById("btn-clear-tests").addEventListener("click", () => {
    document.getElementById("test-results-slot").innerHTML = renderTestCasesShell();
    document.getElementById("test-summary-slot").innerHTML = "";
  });

  // Clause accordion delegation
  document.addEventListener("click", (e) => {
    const header = e.target.closest(".clause-header");
    if (header) {
      const body = header.nextElementSibling;
      body.classList.toggle("open");
    }
    const tcHeader = e.target.closest(".test-case-header");
    if (tcHeader) {
      const body = tcHeader.nextElementSibling;
      body.classList.toggle("open");
    }
  });
}

// ─── File Handling ────────────────────────────────────────────────────────────
function handleFiles(files) {
  const valid = files.filter((f) => isImageFile(f) || isPDFFile(f));
  if (!valid.length) return;
  state.files = [...state.files, ...valid];
  renderFileList();
  document.getElementById("ocr-panel").style.display = "block";
  processFiles(valid);
}

function renderFileList() {
  const list = document.getElementById("file-list");
  list.innerHTML = state.files.map((f, i) => `
    <div class="file-pill">
      📄 ${escHtml(f.name)}
      <span class="rm" data-index="${i}" onclick="removeFile(${i})">✕</span>
    </div>
  `).join("");
}

window.removeFile = function (i) {
  state.files.splice(i, 1);
  renderFileList();
};

async function processFiles(files) {
  const wrap = document.getElementById("progress-bar-wrap");
  const bar = document.getElementById("progress-bar");
  const textarea = document.getElementById("ocr-text");

  wrap.style.display = "block";
  bar.style.width = "5%";

  let combined = textarea.value;
  let total = files.length;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (isImageFile(file)) {
      const result = await extractTextFromImage(file, (p) => {
        const overall = Math.round(((i + p / 100) / total) * 100);
        bar.style.width = `${overall}%`;
      });
      if (result.text) {
        combined += (combined ? "\n\n--- Page ---\n\n" : "") + result.text;
        textarea.value = combined;
        state.ocrText = combined;
      } else if (result.fallback) {
        textarea.placeholder =
          "OCR library could not load. Please paste your agreement text manually here.";
      }
    } else if (isPDFFile(file)) {
      const result = await extractTextFromPDF(file, (p) => {
        const overall = Math.round(((i + p / 100) / total) * 100);
        bar.style.width = `${overall}%`;
      });
      if (result.text) {
        combined += (combined ? "\n\n--- Page ---\n\n" : "") + result.text;
        textarea.value = combined;
        state.ocrText = combined;
      } else if (result.fallback) {
        textarea.placeholder =
          "PDF.js could not load. Please paste your agreement text manually here.";
      } else {
        // PDF processed but yielded no text at all (blank/corrupt PDF)
        textarea.placeholder =
          "Could not extract text from this PDF. Please paste your agreement text manually here.";
      }
    }
    bar.style.width = `${Math.round(((i + 1) / total) * 100)}%`;
  }

  setTimeout(() => { wrap.style.display = "none"; bar.style.width = "0%"; }, 800);
}

// ─── Analysis ─────────────────────────────────────────────────────────────────
function readFinancials() {
  return {
    monthlyRent: parseFloat(document.getElementById("f-rent").value) || 0,
    depositMonths: parseInt(document.getElementById("f-deposit-months").value) || 2,
    tenancyMonths: parseInt(document.getElementById("f-tenancy").value) || 12,
    outstandingRent: parseFloat(document.getElementById("f-outstanding").value) || 0,
    damageClaim: parseFloat(document.getElementById("f-damage").value) || 0,
    paintingClaimed: document.getElementById("f-painting-claimed").value === "yes",
    paintingCost: parseFloat(document.getElementById("f-painting-cost").value) || 0,
    advanceRent: parseInt(document.getElementById("f-advance").value) || 0,
  };
}

function doAnalyze() {
  const text = document.getElementById("ocr-text").value.trim();
  const financials = readFinancials();

  if (!text) {
    alert("Please upload agreement images or paste agreement text first.");
    return;
  }

  const report = auditAgreement(text, financials);
  state.report = report;
  state.financials = financials;

  renderResults(report, financials);

  document.getElementById("upload-section").style.display = "none";
  document.getElementById("results-section").style.display = "block";
  document.getElementById("results-section").scrollIntoView({ behavior: "smooth" });
}

// ─── Render Results ───────────────────────────────────────────────────────────
function renderResults(report, financials) {
  renderRiskBanner(report);
  renderScore(report);
  renderClauses(report.findings);
  renderDeposit(report.depositCalc, financials);
  renderChecklist(report);
}

function renderRiskBanner(report) {
  const verdictClass = { high: "verdict-high", medium: "verdict-medium", low: "verdict-low" };
  const levelLabel   = { high: "High risk", medium: "Medium risk", low: "Low risk" };
  const headlines = {
    high:   `${report.summary.critical} predatory clause${report.summary.critical !== 1 ? "s" : ""} — do not sign without amendments`,
    medium: `${report.summary.warnings} clause${report.summary.warnings !== 1 ? "s" : ""} need attention before signing`,
    low:    "Agreement looks standard — review the findings below",
  };
  const subs = {
    high:   `${report.summary.warnings} warnings and ${report.summary.ok} passing clauses also detected.`,
    medium: `${report.summary.ok} passing clauses detected. No critical issues found.`,
    low:    `${report.summary.total} clause${report.summary.total !== 1 ? "s" : ""} checked.`,
  };
  document.getElementById("risk-banner-slot").innerHTML = `
    <div class="risk-verdict ${report.riskLevel}">
      <div class="verdict-row">
        <span class="verdict-level ${verdictClass[report.riskLevel]}">${levelLabel[report.riskLevel]}</span>
        <span class="verdict-headline">${headlines[report.riskLevel]}</span>
      </div>
      <div class="verdict-sub">${subs[report.riskLevel]}</div>
    </div>
  `;
}

function renderScore(report) {
  const scoreClass = report.riskScore >= 70 ? "high" : report.riskScore >= 35 ? "medium" : "low";
  const parts = [
    report.summary.critical > 0 ? `<strong>${report.summary.critical} critical</strong>` : null,
    report.summary.warnings > 0 ? `${report.summary.warnings} warning${report.summary.warnings !== 1 ? "s" : ""}` : null,
    report.summary.ok > 0       ? `${report.summary.ok} passing` : null,
  ].filter(Boolean).join("&nbsp;&nbsp;·&nbsp;&nbsp;");

  document.getElementById("score-slot").innerHTML = `
    <div class="score-bar-wrap">
      <div class="score-bar-row">
        <span class="score-num ${scoreClass}">${report.riskScore}</span>
        <div class="score-bar-track">
          <div class="score-bar-fill ${scoreClass}" style="width:${report.riskScore}%"></div>
        </div>
        <span style="font-size:11px;color:var(--text-3);flex-shrink:0">/ 100</span>
      </div>
      <div class="score-detail">${parts}</div>
    </div>
  `;
}

function renderClauses(findings) {
  if (!findings.length) {
    document.getElementById("clauses-slot").innerHTML =
      `<div class="empty-state">No clauses detected. Try pasting more of the agreement text.</div>`;
    return;
  }

  const tagClass  = { critical: "tag-critical", warning: "tag-warning", info: "tag-info", ok: "tag-ok" };
  const tagLabel  = { critical: "Critical", warning: "Warning", info: "Info", ok: "Pass" };
  const stripe    = { critical: "stripe-critical", warning: "stripe-warning", info: "stripe-info", ok: "stripe-ok" };
  const recClass  = (sev) => sev === "ok" ? "safe" : sev === "critical" ? "danger" : "";

  document.getElementById("clauses-slot").innerHTML = `
    <div class="clause-list">
      ${findings.map((f) => `
        <div class="clause-item">
          <div class="clause-header">
            <div class="clause-stripe ${stripe[f.severity]}"></div>
            <div class="clause-inner">
              <div class="clause-title">${escHtml(f.category)} — ${escHtml(f.extracted.label || "")}</div>
              <div class="clause-tag ${tagClass[f.severity]}">${tagLabel[f.severity]}</div>
              <span class="clause-chevron">›</span>
            </div>
          </div>
          <div class="clause-body">
            <div class="clause-desc">${escHtml(f.description)}</div>
            ${f.matchedText ? `<div class="extracted-text">${escHtml(f.matchedText)}</div>` : ""}
            <div class="recommendation ${recClass(f.severity)}">${f.recommendation}</div>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderDeposit(calc, financials) {
  if (!financials.monthlyRent) {
    document.getElementById("deposit-slot").innerHTML =
      `<div class="empty-state">Enter your monthly rent above to see the deposit breakdown.</div>`;
    return;
  }

  const fmt    = (n) => n.toLocaleString("en-IN");
  const pNote  = calc.deductions.painting.note ? ` — ${calc.deductions.painting.note}` : "";

  document.getElementById("deposit-slot").innerHTML = `
    <div class="deposit-label">Your landlord must return at least</div>
    <div class="deposit-fig">
      <span class="deposit-currency">₹</span>
      <span class="deposit-amount">${fmt(calc.refundable)}</span>
    </div>

    <div class="deposit-rows">
      <div class="dep-row">
        <span class="dep-key">Deposit paid</span>
        <span class="dep-val">₹${fmt(calc.totalDeposit)}</span>
      </div>
      ${calc.advanceRefund > 0 ? `
      <div class="dep-row">
        <span class="dep-key">Advance rent (refundable)</span>
        <span class="dep-val add">+ ₹${fmt(calc.advanceRefund)}</span>
      </div>` : ""}
      ${calc.deductions.outstandingRent > 0 ? `
      <div class="dep-row">
        <span class="dep-key">Unpaid rent</span>
        <span class="dep-val deduct">− ₹${fmt(calc.deductions.outstandingRent)}</span>
      </div>` : ""}
      ${calc.deductions.damageClaim > 0 ? `
      <div class="dep-row">
        <span class="dep-key">Damage claim</span>
        <span class="dep-val deduct">− ₹${fmt(calc.deductions.damageClaim)}</span>
      </div>` : ""}
      ${financials.paintingClaimed ? `
      <div class="dep-row">
        <span class="dep-key">Painting${escHtml(pNote)}</span>
        <span class="dep-val ${calc.deductions.painting.allowed > 0 ? "deduct" : "add"}">
          ${calc.deductions.painting.allowed > 0 ? `− ₹${fmt(calc.deductions.painting.allowed)}` : "Not deductible"}
        </span>
      </div>` : ""}
      <div class="dep-row total-row">
        <span class="dep-key">Refundable</span>
        <span class="dep-val">₹${fmt(calc.refundable)}</span>
      </div>
    </div>

    ${calc.wrongfullyDeducted > 0 ? `
    <div class="dep-wrongful">
      ₹${fmt(calc.wrongfullyDeducted)} in deductions your landlord cannot legally make. You can recover this amount.
    </div>` : ""}

    <p class="disclaimer">
      Informational only. Based on Karnataka Rent Control Act and common Bengaluru tenancy norms. Consult a lawyer for binding advice.
    </p>
  `;
}

function renderChecklist(report) {
  const items = generateChecklist(report);
  document.getElementById("checklist-slot").innerHTML = `
    <ul class="checklist">
      ${items.map((item) => `
        <li class="${item.level}">
          <span class="ci">${item.icon}</span>
          <div class="check-text">
            <strong>${escHtml(item.title)}</strong>
            <span>${escHtml(item.detail)}</span>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
}

function generateChecklist(report) {
  const items = [];
  const { findings, depositCalc, riskLevel } = report;

  const hasCritical = findings.some((f) => f.severity === "critical");
  items.push({
    level: hasCritical ? "bad" : "ok",
    icon: hasCritical ? "🚨" : "✅",
    title: hasCritical ? "Do NOT sign without amendments" : "Agreement is signable",
    detail: hasCritical
      ? "Request written amendments or strike-through on critical clauses before signing."
      : "No predatory clauses detected. Standard review recommended.",
  });

  if (depositCalc.wrongfullyDeducted > 0) {
    items.push({
      level: "bad",
      icon: "💸",
      title: `Demand ₹${depositCalc.wrongfullyDeducted.toLocaleString("en-IN")} back`,
      detail: "Landlord cannot legally deduct painting after 24+ months tenancy. File a complaint with the Civil Court or Consumer Forum if withheld.",
    });
  }

  items.push({
    level: "warn",
    icon: "📸",
    title: "Document property condition at move-in & move-out",
    detail: "Take timestamped photos/videos of every room on day 1 and your last day. Share with landlord via WhatsApp for records.",
  });

  items.push({
    level: "warn",
    icon: "🧾",
    title: "Demand itemised deductions in writing within 7 days",
    detail: "Any deduction must be backed by receipts. If landlord delays > 7 days, send a legal notice.",
  });

  const lockIn = findings.find((f) => f.ruleId === "lock_in_excessive");
  if (lockIn && lockIn.severity !== "ok") {
    items.push({
      level: "warn",
      icon: "🔒",
      title: `Negotiate lock-in period from ${lockIn.extracted.label}`,
      detail: "Propose 6 months lock-in maximum. Longer lock-ins disproportionately hurt tenants.",
    });
  }

  items.push({
    level: "ok",
    icon: "🚔",
    title: "Complete police verification",
    detail: "Mandatory by law. Usually done within first week of tenancy.",
  });

  items.push({
    level: "ok",
    icon: "📋",
    title: "Register the agreement (> 11 months)",
    detail: "Agreements beyond 11 months MUST be registered. Unregistered long-term leases are not legally enforceable.",
  });

  return items;
}

// ─── Demo ─────────────────────────────────────────────────────────────────────
function loadDemo() {
  const demoText = `RENTAL AGREEMENT

This rental agreement is entered into between the Landlord and Tenant for the property
located in Whitefield, Bengaluru - 560066.

1. DURATION: This agreement is for a period of 11 months commencing from 1st January 2024.

2. RENT: The monthly rent shall be Rs. 25,000 (Rupees Twenty-Five Thousand Only).
   Rent shall be increased by 15% per annum effective from the second year.

3. SECURITY DEPOSIT: The Tenant shall pay a security deposit equivalent to 10 months of
   rent amounting to Rs. 2,50,000 as refundable security deposit.

4. LOCK-IN PERIOD: The lock-in period of 11 months shall apply from the commencement date
   of this agreement. Neither party shall terminate the agreement during the lock-in period.

5. MAINTENANCE: Tenant shall bear all maintenance and repair costs during the tenancy period
   including minor and major repairs to the premises.

6. PAINTING CHARGES: Painting charges shall be deducted by tenant from the security deposit
   at the time of vacating the premises, irrespective of the duration of stay.

7. NOTICE PERIOD: Either party shall provide 3 months notice before vacating the property.

8. DEDUCTIONS: The landlord shall have the right to deduct amounts from the security deposit
   as deemed fit at sole discretion for damages, cleaning, and restoration.

9. SUBLETTING: The tenant shall not sublet, assign or license the premises to any third party.

10. POLICE VERIFICATION: The tenant must complete police verification within 7 days of
    taking possession of the premises.

11. TERMINATION: The landlord may terminate this agreement at any time without prior notice
    if the tenant violates any terms of this agreement.
`;

  document.getElementById("ocr-text").value = demoText;
  document.getElementById("ocr-panel").style.display = "block";
  document.getElementById("f-rent").value = 25000;
  document.getElementById("f-deposit-months").value = 10;
  document.getElementById("f-tenancy").value = 24;
  document.getElementById("f-outstanding").value = 0;
  document.getElementById("f-advance").value = 2;
  document.getElementById("f-painting-claimed").value = "yes";
  document.getElementById("painting-cost-group").style.display = "flex";
  document.getElementById("f-painting-cost").value = 30000;
  document.getElementById("f-damage").value = 10000;

  doAnalyze();
}

// ─── Tests ────────────────────────────────────────────────────────────────────
function renderTestCasesShell() {
  const groups = [...new Set(TEST_CASES.map((tc) => tc.group))];
  return groups.map((group) => `
    <div style="margin-bottom:4px; font-size:12px; color:var(--muted); font-weight:600; padding: 4px 0;">
      ${escHtml(group)}
    </div>
    ${TEST_CASES.filter((tc) => tc.group === group).map((tc) => `
      <div class="test-case" id="tc-${tc.id}">
        <div class="test-case-header">
          <span class="tc-status">⬜</span>
          <span class="tc-name">${escHtml(tc.id)} — ${escHtml(tc.name)}</span>
          <span class="tc-badge pending" id="tc-badge-${tc.id}">Pending</span>
        </div>
        <div class="test-case-body">
          <p style="font-size:13px;color:var(--muted);margin-bottom:8px">${escHtml(tc.description)}</p>
          <pre id="tc-output-${tc.id}">Not run yet.</pre>
        </div>
      </div>
    `).join("")}
  `).join("");
}

async function doRunTests() {
  const btn = document.getElementById("btn-run-tests");
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> Running…`;

  document.getElementById("test-summary-slot").innerHTML = "";

  // Reset all badges
  TEST_CASES.forEach((tc) => {
    const badge = document.getElementById(`tc-badge-${tc.id}`);
    const status = document.querySelector(`#tc-${tc.id} .tc-status`);
    if (badge) { badge.className = "tc-badge running"; badge.textContent = "Running…"; }
    if (status) status.textContent = "🔄";
  });

  let passed = 0, failed = 0;

  await runTests((result) => {
    const badge = document.getElementById(`tc-badge-${result.id}`);
    const status = document.querySelector(`#tc-${result.id} .tc-status`);
    const output = document.getElementById(`tc-output-${result.id}`);

    if (result.status === "pass") {
      passed++;
      if (badge) { badge.className = "tc-badge pass"; badge.textContent = "PASS ✓"; }
      if (status) status.textContent = "✅";
      if (output) output.textContent = "Test passed.";
    } else {
      failed++;
      if (badge) { badge.className = "tc-badge fail"; badge.textContent = "FAIL ✗"; }
      if (status) status.textContent = "❌";
      if (output) output.textContent = `FAILED: ${result.error}`;
      // Auto-open failing tests
      const body = document.querySelector(`#tc-${result.id} .test-case-body`);
      if (body) body.classList.add("open");
    }
  });

  document.getElementById("test-summary-slot").innerHTML = `
    <div class="test-summary">
      <span class="ts-total">Total: ${TEST_CASES.length}</span>
      <span class="ts-pass">✅ Passed: ${passed}</span>
      ${failed > 0 ? `<span class="ts-fail">❌ Failed: ${failed}</span>` : ""}
    </div>
  `;

  btn.disabled = false;
  btn.innerHTML = `▶ Run All Tests`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (typeof str !== "string") return str ?? "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
