/**
 * clauseEngine.js — Core parser and clause-flagging engine
 *
 * Responsibility: given extracted agreement text + financial inputs,
 * return a structured AuditReport.
 */

// ─── Clause definitions ───────────────────────────────────────────────────────
// Each rule has an id, category, description, regex patterns, severity,
// and a recommendation function that takes the matched text.

export const CLAUSE_RULES = [
  {
    id: "lock_in_excessive",
    category: "Lock-in Period",
    description: "Lock-in period longer than 6 months is considered predatory in most Bengaluru rental agreements.",
    patterns: [
      // "lock-in period of N months" / "N months lock-in"
      /lock[\s-]?in\s+(?:period\s+)?(?:of\s+)?(\d+)\s*(?:months?|mths?)/i,
      /(\d+)\s*(?:months?|mths?)\s+lock[\s-]?in/i,
      // "remain for at least N months" / "remain for a period of N months"
      /(?:remain|stay)\s+for\s+(?:a\s+period\s+of\s+|at\s+least\s+)?(\d+)\s*(?:months?|mths?)/i,
      // "lock-in" anywhere near a number on the same line
      /lock[\s-]?in[^.]{0,60}(\d+)\s*(?:months?|mths?)/i,
    ],
    severity: (months) => months >= 11 ? "critical" : months > 6 ? "warning" : "ok",
    extract: (match) => {
      const m = parseInt(match, 10);
      return { value: m, unit: "months", label: `${m} month lock-in` };
    },
    recommend: (months) =>
      months > 11
        ? "🚨 Lock-in exceeds 11 months. Karnataka Rent Control Act limits lock-in. Negotiate down to 6 months or less."
        : months > 6
        ? "⚠️ Lock-in is above market norm (6 months). Request landlord to reduce it."
        : "✅ Lock-in period is within acceptable range.",
  },

  {
    id: "deposit_months",
    category: "Security Deposit",
    description: "RBI guidelines and common practice suggest 2–3 months rent as deposit. Bengaluru landlords often demand 10 months — flag when > 3 months.",
    patterns: [
      // "deposit of N months rent" or "N months deposit"
      /(?:security\s+)?deposit\s+(?:of\s+)?(?:equivalent\s+to\s+)?(\d+)\s*(?:months?|mths?)\s+(?:of\s+)?(?:rent|monthly)/i,
      /(\d+)\s*(?:months?|mths?)\s+(?:rent\s+)?(?:security\s+)?deposit/i,
      /(\d+)\s*months?\s+advance/i,
      // "deposit of Rs/₹/n X,XX,XXX" — large flat amount (₹ may be encoded as "n" by PDF fonts)
      /(?:security\s+)?deposit\s+(?:of\s+)?(?:rs\.?|₹|inr|\s*n\s)?\s*(\d[\d,]+)/i,
    ],
    severity: (val, raw) => {
      const n = parseInt(String(val).replace(/,/g, ""), 10);
      // If it's clearly months (small number ≤ 24) treat directly
      if (n <= 24) return n > 5 ? "critical" : n > 3 ? "warning" : "ok";
      // Otherwise it's a rupee amount — flag as info (can't compare without rent)
      return "info";
    },
    extract: (match) => {
      const n = parseInt(String(match).replace(/,/g, ""), 10);
      if (n <= 24) return { value: n, unit: "months", label: `${n}-month deposit` };
      return { value: n, unit: "₹", label: `₹${Number(n).toLocaleString("en-IN")} deposit` };
    },
    recommend: (val) => {
      const n = parseInt(String(val).replace(/,/g, ""), 10);
      if (n <= 24) {
        return n > 5
          ? "🚨 Deposit exceeds 5 months. BBMP and consumer courts have ruled > 3 months deposits as excessive. Negotiate."
          : n > 3
          ? "⚠️ Deposit above the 2–3 month norm. Try to bring it to 2–3 months."
          : "✅ Deposit amount is within acceptable range.";
      }
      return "ℹ️ Large flat deposit amount. Verify this is not more than 2–3 months' rent.";
    },
  },

  {
    id: "painting_charge",
    category: "Painting / Whitewash Charges",
    description: "Deducting full painting costs from deposit is predatory if tenancy > 2 years; wear-and-tear must be shared.",
    patterns: [
      /painting\s+charges?\s+(?:shall\s+)?(?:be\s+)?(?:deducted|charged|borne)\s+by\s+(?:the\s+)?tenant/i,
      /tenant\s+(?:shall\s+)?(?:be\s+)?(?:responsible|liable)\s+for\s+painting/i,
      /painting\s+cost[^.]*deduct/i,
      /whitewash[^.]*(?:tenant|deduct)/i,
      // "painting charge … shall be deducted from the security deposit"
      /painting\s+charge[^.]{0,80}(?:deducted|charged)/i,
      // "fixed painting charge"
      /fixed\s+painting\s+charge/i,
    ],
    severity: () => "critical",
    extract: () => ({ label: "Painting cost deducted from deposit" }),
    recommend: () =>
      "🚨 Full painting deduction is illegal after 2+ years of tenancy (normal wear & tear). Negotiate: landlord pays after 2 years; tenant pays only for damage beyond fair use.",
  },

  {
    id: "maintenance_blanket",
    category: "Maintenance Charges",
    description: "Blanket maintenance clauses that hold tenant responsible for all repairs are unenforceable.",
    patterns: [
      /tenant\s+(?:shall\s+)?(?:bear|pay|be\s+responsible\s+for)\s+(?:all\s+)?(?:maintenance|repair)/i,
      /all\s+(?:maintenance|repair)\s+costs?\s+(?:shall\s+be\s+)?(?:borne|paid)\s+by\s+(?:the\s+)?tenant/i,
      /maintenance[^.]*at\s+(?:the\s+)?(?:tenant['s]+|lessee['s]+)\s+(?:cost|expense)/i,
      // "tenant shall pay maintenance and repair expenses"
      /tenant\s+shall\s+pay\s+(?:maintenance|repair)\s+(?:and\s+repair\s+)?expenses/i,
      // catch-all: "maintenance … expenses … tenant" close together
      /maintenance\s+and\s+repair\s+expenses[^.]{0,60}(?:tenant|lessee)/i,
    ],
    severity: () => "critical",
    extract: () => ({ label: "Tenant bears all maintenance" }),
    recommend: () =>
      "🚨 Clause is unenforceable per Karnataka Rent Control Act. Landlord is responsible for structural repairs. Tenant only liable for negligent damage.",
  },

  {
    id: "arbitrary_deduction",
    category: "Arbitrary Deductions",
    description: "Vague deduction clauses that allow landlord full discretion without itemised proof.",
    patterns: [
      /landlord\s+(?:shall\s+)?(?:have\s+the\s+right|be\s+entitled)\s+to\s+deduct[^.]*at\s+(?:his|her|their|sole)\s+discretion/i,
      /deductions?\s+as\s+deemed\s+(?:fit|necessary|appropriate)\s+by\s+(?:the\s+)?landlord/i,
      /landlord[^.]*sole\s+discretion[^.]*deduct/i,
      // "landlord may deduct … any other amount considered payable"
      /landlord\s+may\s+deduct[^.]{0,100}any\s+(?:other\s+)?amount/i,
      // "deduct … any amount considered payable by the tenant"
      /deduct[^.]{0,80}any\s+(?:other\s+)?amount\s+considered\s+(?:payable|due)/i,
      // deposit "may be retained at the landlord's discretion"
      /deposit[^.]{0,60}(?:retained|withheld)[^.]{0,40}(?:landlord|discretion)/i,
    ],
    severity: () => "critical",
    extract: () => ({ label: "Vague/unlimited deduction clause" }),
    recommend: () =>
      "🚨 Any deduction must be backed by receipts. Demand an amendment: 'Deductions only allowed with itemised receipts provided within 7 days of vacating.'",
  },

  {
    id: "notice_period_excessive",
    category: "Notice Period",
    description: "Notice period beyond 2 months (tenant-side) is unusual and potentially problematic.",
    patterns: [
      /notice\s+period\s+(?:of\s+)?(\d+)\s*(?:months?|mths?)/i,
      /(\d+)\s*(?:months?|mths?)\s+(?:prior\s+)?notice/i,
      // days-based notice: "60 days' notice" / "60 days written notice"
      /(\d+)\s*days[\u2019\u2018'']?\s*(?:written\s+)?notice/i,
      /provide\s+(\d+)\s*days[\u2019\u2018'']?\s*(?:written\s+)?notice/i,
    ],
    severity: (val, raw) => {
      // If the raw match was "days", convert to months
      const isDays = /days/i.test(raw || "");
      const n = parseInt(val, 10);
      const months = isDays ? n / 30 : n;
      return months > 2 ? "warning" : "ok";
    },
    extract: (val, raw) => {
      const isDays = /days/i.test(raw || "");
      const n = parseInt(val, 10);
      if (isDays) return { value: n, unit: "days", label: `${n}-day notice` };
      return { value: n, unit: "months", label: `${n}-month notice` };
    },
    recommend: (val, raw) => {
      const isDays = /days/i.test(raw || "");
      const n = parseInt(val, 10);
      const months = isDays ? n / 30 : n;
      return months > 2
        ? `⚠️ Notice of ${isDays ? n + " days" : n + " months"} restricts flexibility. Try to negotiate to 30–60 days.`
        : "✅ Notice period is fair.";
    },
  },

  {
    id: "unilateral_rent_hike",
    category: "Rent Escalation",
    description: "Annual rent hikes > 10% or unilateral hike clauses without tenant agreement.",
    patterns: [
      /rent\s+(?:shall\s+)?(?:be\s+)?increased?\s+by\s+(\d+)\s*%/i,
      /(\d+)\s*%\s+(?:annual|yearly|per\s+annum|p\.?a\.?)\s+(?:rent\s+)?(?:increase|hike|escalation)/i,
      /landlord\s+(?:may|can|shall)\s+(?:increase|revise|hike)\s+(?:the\s+)?rent\s+(?:at\s+)?(?:any\s+time|anytime|sole\s+discretion)/i,
    ],
    severity: (pct) => {
      if (pct === null) return "critical"; // unilateral clause
      return pct > 10 ? "warning" : "ok";
    },
    extract: (match) => match ? ({ value: parseInt(match, 10), unit: "%", label: `${match}% rent hike` }) : ({ label: "Unilateral rent hike" }),
    recommend: (pct) =>
      pct === null
        ? "🚨 Unilateral rent hike without tenant agreement is void. Demand a fixed escalation cap (e.g., 5–8% per year)."
        : pct > 10
        ? `⚠️ ${pct}% annual hike is above market norm (~5–8%). Negotiate down.`
        : `✅ Rent escalation of ${pct}% is reasonable.`,
  },

  {
    id: "subletting_ban",
    category: "Subletting",
    description: "Complete prohibition on subletting — note for awareness.",
    patterns: [
      /tenant\s+(?:shall\s+not|must\s+not|cannot|may\s+not)\s+sublet/i,
      /subletting?\s+(?:is\s+)?(?:strictly\s+)?(?:prohibited|not\s+allowed|not\s+permitted)/i,
    ],
    severity: () => "info",
    extract: () => ({ label: "No subletting allowed" }),
    recommend: () =>
      "ℹ️ Subletting prohibition is standard. Keep in mind if you plan to have paying guests or Airbnb use.",
  },

  {
    id: "police_verification",
    category: "Police Verification",
    description: "Police verification is a legal obligation — this is a good clause.",
    patterns: [
      /police\s+verification/i,
      /tenant\s+(?:shall|must|will)\s+(?:undergo|complete|submit)\s+(?:a\s+)?(?:police|background)/i,
    ],
    severity: () => "ok",
    extract: () => ({ label: "Police verification required" }),
    recommend: () =>
      "✅ Police verification is mandatory by law (Section 188 IPC). This protects both parties.",
  },

  {
    id: "unilateral_termination",
    category: "Termination Rights",
    description: "Landlord-only termination clause with no equivalent tenant right.",
    patterns: [
      /landlord\s+(?:may|can|shall|reserves\s+the\s+right\s+to)\s+terminate[^.]*without\s+(?:prior\s+)?(?:notice|reason|cause)/i,
      /landlord\s+(?:may|can)\s+terminate\s+(?:this\s+)?(?:agreement|lease|tenancy)\s+at\s+(?:any\s+time|anytime|sole\s+discretion)/i,
    ],
    severity: () => "critical",
    extract: () => ({ label: "Landlord can terminate anytime" }),
    recommend: () =>
      "🚨 One-sided termination clause is unenforceable without reasonable notice. Demand minimum 2-month notice for landlord-initiated termination.",
  },

  {
    id: "overdue_interest",
    category: "Late Payment Interest",
    description: "Interest on overdue rent — flag if > 24% per annum.",
    patterns: [
      /interest\s+(?:of\s+)?(\d+)\s*%\s+(?:per\s+(?:annum|month|year)|p\.?a\.?|p\.?m\.?)/i,
      /(\d+)\s*%\s+(?:per\s+(?:annum|month|year)|p\.?a\.?)\s+interest/i,
    ],
    severity: (pct, unit) => {
      const annual = unit === "month" ? pct * 12 : pct;
      return annual > 24 ? "warning" : "ok";
    },
    extract: (pct, unit) => ({ value: pct, unit, label: `${pct}% per ${unit || "annum"} late interest` }),
    recommend: (pct, unit) => {
      const annual = unit === "month" ? pct * 12 : pct;
      return annual > 24
        ? `⚠️ ${annual}% per annum interest is high (legal ceiling is ~18-24%). Negotiate to 12–18% p.a.`
        : `✅ Late payment interest of ${annual}% p.a. is within acceptable range.`;
    },
  },
];

// ─── Deposit Deduction Calculator ────────────────────────────────────────────

/**
 * @param {Object} params
 * @param {number} params.depositMonths        – deposit in months of rent
 * @param {number} params.monthlyRent          – monthly rent (₹)
 * @param {number} params.tenancyMonths        – actual months stayed
 * @param {number} params.outstandingRent      – overdue rent (₹)
 * @param {number} params.damageClaim          – landlord's damage claim (₹)
 * @param {boolean} params.paintingClaimed     – landlord claims painting charge
 * @param {number} params.paintingCost         – quoted painting cost (₹)
 * @param {number} params.advanceRent          – months of advance rent paid (₹)
 * @returns {DepositCalculation}
 */
export function calculateDeposit(params) {
  const {
    depositMonths = 2,
    monthlyRent = 0,
    tenancyMonths = 12,
    outstandingRent = 0,
    damageClaim = 0,
    paintingClaimed = false,
    paintingCost = 0,
    advanceRent = 0,
  } = params;

  const totalDeposit = depositMonths * monthlyRent;

  // Painting: legal only if tenancy < 24 months; pro-rated after that
  let paintingAllowed = 0;
  let paintingNote = "";
  if (paintingClaimed && paintingCost > 0) {
    if (tenancyMonths < 12) {
      paintingAllowed = paintingCost;
      paintingNote = "Full painting allowed (tenancy < 12 months)";
    } else if (tenancyMonths < 24) {
      paintingAllowed = Math.round(paintingCost * 0.5);
      paintingNote = "50% painting (tenancy 12–24 months, shared wear & tear)";
    } else {
      paintingAllowed = 0;
      paintingNote = "Painting NOT deductible (tenancy ≥ 24 months — normal wear & tear)";
    }
  }

  const totalDeductions = outstandingRent + damageClaim + paintingAllowed;
  const refundable = Math.max(0, totalDeposit - totalDeductions + advanceRent * monthlyRent);
  const wrongfullyDeducted = paintingClaimed && paintingCost > 0
    ? paintingCost - paintingAllowed
    : 0;

  return {
    totalDeposit,
    deductions: {
      outstandingRent,
      damageClaim,
      painting: { claimed: paintingCost, allowed: paintingAllowed, note: paintingNote, wrongful: wrongfullyDeducted },
    },
    advanceRefund: advanceRent * monthlyRent,
    totalDeductions,
    refundable,
    wrongfullyDeducted,
  };
}

// ─── Main Audit Function ──────────────────────────────────────────────────────

/**
 * @param {string} text          – extracted agreement text
 * @param {Object} financials    – user-supplied financial params
 * @returns {AuditReport}
 */
export function auditAgreement(text, financials = {}) {
  const findings = [];
  const normalizedText = text || "";

  for (const rule of CLAUSE_RULES) {
    let matched = false;
    let extractedValue = null;
    let matchedText = "";

    for (const pattern of rule.patterns) {
      const m = normalizedText.match(pattern);
      if (m) {
        matched = true;
        matchedText = m[0];
        extractedValue = m[1] || null;
        break;
      }
    }

    if (matched) {
      const numericValue = extractedValue ? parseFloat(String(extractedValue).replace(/,/g, "")) : null;
      const severity = rule.severity(numericValue, matchedText);
      const extracted = rule.extract(extractedValue, matchedText);
      const recommendation = rule.recommend(numericValue, matchedText);

      findings.push({
        ruleId: rule.id,
        category: rule.category,
        description: rule.description,
        severity,
        extracted,
        matchedText,
        recommendation,
      });
    }
  }

  // Sort: critical → warning → info → ok
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);

  const riskScore = computeRiskScore(findings);
  const depositCalc = calculateDeposit({
    depositMonths: financials.depositMonths || 2,
    monthlyRent: financials.monthlyRent || 0,
    tenancyMonths: financials.tenancyMonths || 12,
    outstandingRent: financials.outstandingRent || 0,
    damageClaim: financials.damageClaim || 0,
    paintingClaimed: financials.paintingClaimed || false,
    paintingCost: financials.paintingCost || 0,
    advanceRent: financials.advanceRent || 0,
  });

  return {
    findings,
    riskScore,
    riskLevel: riskScore >= 70 ? "high" : riskScore >= 35 ? "medium" : "low",
    depositCalc,
    summary: buildSummary(findings, riskScore),
  };
}

function computeRiskScore(findings) {
  let score = 0;
  for (const f of findings) {
    if (f.severity === "critical") score += 25;
    else if (f.severity === "warning") score += 10;
    else if (f.severity === "info") score += 2;
  }
  return Math.min(100, score);
}

function buildSummary(findings, score) {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const ok = findings.filter((f) => f.severity === "ok").length;
  return {
    total: findings.length,
    critical,
    warnings,
    ok,
    score,
    headline:
      critical > 0
        ? `${critical} predatory clause${critical > 1 ? "s" : ""} detected — review before signing`
        : warnings > 0
        ? `${warnings} clause${warnings > 1 ? "s" : ""} need attention before signing`
        : "Agreement appears reasonable — standard clauses found",
  };
}
