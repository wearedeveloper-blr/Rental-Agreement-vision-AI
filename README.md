# Rental Clause Auditor — Bengaluru

Upload your rental agreement. The tool flags illegal clauses and calculates exactly how much deposit your landlord must return.

**Live:** `npx serve .` → open http://localhost:3000

---

## What it does

Bengaluru landlords routinely demand 8–10 months' deposit (legal norm: 2–3), deduct full painting costs even after 2+ years of tenancy, and bury vague "sole discretion" deduction clauses that courts consistently void. Most tenants don't know which clauses are unenforceable — this tool tells them.

**Three steps:**

1. **Upload** your agreement — PDF, JPG, PNG, or WebP. Scanned pages go through Tesseract OCR. Digital PDFs use the native text layer via PDF.js.
2. **Review** the extracted text and fill in your financial figures (rent, deposit, months stayed, etc.).
3. **Analyze** — the clause engine flags every predatory or unusual clause, and the deposit calculator tells you the exact refundable amount under Karnataka law.

---

## Clause engine

11 rules across 4 severity levels, grounded in the Karnataka Rent Control Act and common Bengaluru tenancy norms.

| Rule | Severity | Trigger |
|---|---|---|
| Lock-in Period | Critical | > 6 months |
| Security Deposit | Critical / Warning | > 5 months (critical), > 3 months (warning) |
| Painting Charges | Critical | Fixed deduction from deposit regardless of tenancy |
| Blanket Maintenance | Critical | Tenant bears all repairs including structural |
| Arbitrary Deductions | Critical | Sole-discretion or unlimited deduction clauses |
| Unilateral Termination | Critical | Landlord can exit without notice |
| Notice Period | Warning | > 60 days (2 months) |
| Rent Escalation | Warning | > 10% per annum |
| Late Payment Interest | Warning | > 24% per annum |
| Subletting Prohibition | Info | Awareness only |
| Police Verification | Pass | Legal requirement — good clause |

The engine matches both months-based and days-based phrasing, handles PDF font encoding corruption (e.g. `₹` encoded as `n`), and normalises comma-separated Indian number formats.

---

## Deposit calculator

Inputs: monthly rent, months of deposit paid, months stayed, outstanding rent, landlord damage claim, advance rent paid, painting charges (amount + claimed yes/no).

**Karnataka law logic applied:**

- Painting deduction: **100%** allowed if tenancy < 12 months
- Painting deduction: **50%** allowed if tenancy 12–24 months (shared wear and tear)
- Painting deduction: **not allowed** if tenancy ≥ 24 months (normal wear and tear)
- Advance rent paid is added back to the refundable amount
- Any wrongful deduction is called out separately with the recoverable amount

---

## PDF pipeline

Two-pass extraction handles any PDF without user friction:

**Pass 1 — Native text layer (PDF.js)**
For digitally-created PDFs. Instant, no model inference. Uses `pdfjs-dist` legacy build loaded lazily from CDN on first upload.

**Pass 2 — Canvas OCR fallback (Tesseract.js)**
If a page has no text (scanned or image-based PDF), the page is rendered to an offscreen `<canvas>` at 2× scale and passed to Tesseract.js for OCR. Progress tracks per page.

Both libraries load from CDN on first use — users who only paste text pay zero load cost.

---

## Project structure

```
index.html          Entry point — loads app.js as ES module
app.js              UI orchestrator: render, event wiring, file handling, result rendering
clauseEngine.js     Clause rules, deposit calculator, audit function
ocrEngine.js        Tesseract.js OCR + PDF.js text extraction
style.css           Full design system (dark, DM Sans, indigo accent)
tests.js            In-browser test suite (clause detection, deposit calc, risk scoring)
gemini-svg.svg      App logo (inlined into header)
```

---

## Running locally

```bash
npx serve .
```

Open http://localhost:3000. No install, no build step, no backend.

---

## Tech stack

| Library | Purpose |
|---|---|
| Vanilla JS (ES modules) | No framework, no bundler |
| [PDF.js](https://mozilla.github.io/pdf.js/) `pdfjs-dist@4.4.168` legacy | Text layer extraction + canvas render |
| [Tesseract.js](https://tesseract.projectnaptha.com/) v5 | In-browser OCR for scanned documents |
| [DM Sans](https://fonts.google.com/specimen/DM+Sans) | UI typography |
| `npx serve` | Local static server |

---

## Running the test suite

Open http://localhost:3000 and scroll to the **Test suite** section at the bottom. Click **Run all**. The suite covers:

- Clause detection for all 11 rules (correct severity, correct label)
- Deposit calculation edge cases (painting at < 12, 12–24, ≥ 24 months; advance rent; wrongful deductions)
- Risk scoring thresholds
- False positive guards (acceptable clauses that must not fire as critical)

---

## Legal disclaimer

This tool is for informational purposes only. It is not legal advice. Calculations are based on Karnataka Rent Control Act provisions and common Bengaluru tenancy norms as of 2024–2026. Consult a lawyer for binding advice.
