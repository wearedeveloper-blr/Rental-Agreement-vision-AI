// headless-test.mjs — Node.js headless test runner for clauseEngine + deposit calculator
// Run: node headless-test.mjs

// ─── Inline engine (mirrors clauseEngine.js without browser deps) ─────────────

const CLAUSE_RULES = [
  {
    id: "lock_in_excessive",
    patterns: [
      /lock[\s-]?in\s+(?:period\s+)?(?:of\s+)?(\d+)\s*(?:months?|mths?)/i,
      /(\d+)\s*(?:months?|mths?)\s+lock[\s-]?in/i,
    ],
    severity: (m) => (m >= 11 ? "critical" : m > 6 ? "warning" : "ok"),
  },
  {
    id: "deposit_months",
    patterns: [
      /(?:security\s+)?deposit\s+(?:of\s+)?(?:equivalent\s+to\s+)?(\d+)\s*(?:months?|mths?)\s+(?:of\s+)?(?:rent|monthly)/i,
      /(\d+)\s*(?:months?|mths?)\s+(?:rent\s+)?(?:security\s+)?deposit/i,
      /(\d+)\s*months?\s+advance/i,
    ],
    severity: (m) => (m > 5 ? "critical" : m > 3 ? "warning" : "ok"),
  },
  {
    id: "painting_charge",
    patterns: [
      /painting\s+charges?\s+(?:shall\s+)?(?:be\s+)?(?:deducted|charged|borne)\s+by\s+(?:the\s+)?tenant/i,
      /tenant\s+(?:shall\s+)?(?:be\s+)?(?:responsible|liable)\s+for\s+painting/i,
    ],
    severity: () => "critical",
  },
  {
    id: "maintenance_blanket",
    patterns: [
      /tenant\s+(?:shall\s+)?(?:bear|pay|be\s+responsible\s+for)\s+all\s+(?:maintenance|repair)/i,
    ],
    severity: () => "critical",
  },
  {
    id: "arbitrary_deduction",
    patterns: [
      /landlord\s+(?:shall\s+)?(?:have\s+the\s+right|be\s+entitled)\s+to\s+deduct[^.]*at\s+(?:his|her|their|sole)\s+discretion/i,
      /deductions?\s+as\s+deemed\s+(?:fit|necessary|appropriate)\s+by\s+(?:the\s+)?landlord/i,
      /landlord[^.]*sole\s+discretion[^.]*deduct/i,
    ],
    severity: () => "critical",
  },
  {
    id: "notice_period_excessive",
    patterns: [
      /notice\s+period\s+(?:of\s+)?(\d+)\s*(?:months?|mths?)/i,
      /(\d+)\s*(?:months?|mths?)\s+(?:prior\s+)?notice/i,
    ],
    severity: (m) => (m > 2 ? "warning" : "ok"),
  },
  {
    id: "unilateral_rent_hike",
    patterns: [
      /rent\s+(?:shall\s+)?(?:be\s+)?increased?\s+by\s+(\d+)\s*%/i,
      /(\d+)\s*%\s+(?:annual|yearly|per\s+annum|p\.?a\.?)\s+(?:rent\s+)?(?:increase|hike|escalation)/i,
      /landlord\s+(?:may|can|shall)\s+(?:increase|revise|hike)\s+(?:the\s+)?rent\s+(?:at\s+)?(?:any\s+time|anytime|sole\s+discretion)/i,
    ],
    severity: (pct) => (pct === null ? "critical" : pct > 10 ? "warning" : "ok"),
  },
  {
    id: "subletting_ban",
    patterns: [
      /tenant\s+(?:shall\s+not|must\s+not|cannot|may\s+not)\s+sublet/i,
      /subletting?\s+(?:is\s+)?(?:strictly\s+)?(?:prohibited|not\s+allowed|not\s+permitted)/i,
    ],
    severity: () => "info",
  },
  {
    id: "police_verification",
    patterns: [/police\s+verification/i],
    severity: () => "ok",
  },
  {
    id: "unilateral_termination",
    patterns: [
      /landlord\s+(?:may|can|shall|reserves\s+the\s+right\s+to)\s+terminate[^.]*without\s+(?:prior\s+)?(?:notice|reason|cause)/i,
      /landlord\s+(?:may|can)\s+terminate\s+(?:this\s+)?(?:agreement|lease|tenancy)\s+at\s+(?:any\s+time|anytime|sole\s+discretion)/i,
    ],
    severity: () => "critical",
  },
];

function auditAgreement(text, financials = {}) {
  const findings = [];
  const normalizedText = text || "";
  for (const rule of CLAUSE_RULES) {
    for (const pattern of rule.patterns) {
      const m = normalizedText.match(pattern);
      if (m) {
        const val = m[1] ? parseFloat(m[1]) : null;
        findings.push({ ruleId: rule.id, severity: rule.severity(val), matchedText: m[0] });
        break;
      }
    }
  }
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  let score = 0;
  for (const f of findings) {
    if (f.severity === "critical") score += 25;
    else if (f.severity === "warning") score += 10;
    else if (f.severity === "info") score += 2;
  }
  score = Math.min(100, score);
  return { findings, riskScore: score, riskLevel: score >= 70 ? "high" : score >= 35 ? "medium" : "low" };
}

function calculateDeposit(p) {
  const totalDeposit = (p.depositMonths || 2) * (p.monthlyRent || 0);
  let paintingAllowed = 0, paintingWrongful = 0, paintingNote = "";
  if (p.paintingClaimed && p.paintingCost > 0) {
    if (p.tenancyMonths < 12) {
      paintingAllowed = p.paintingCost; paintingNote = "Full painting (< 12m)";
    } else if (p.tenancyMonths < 24) {
      paintingAllowed = Math.round(p.paintingCost * 0.5); paintingNote = "50% painting (12-24m)";
    } else {
      paintingAllowed = 0; paintingNote = "No painting (>= 24m)";
    }
    paintingWrongful = p.paintingCost - paintingAllowed;
  }
  const totalDeductions = (p.outstandingRent || 0) + (p.damageClaim || 0) + paintingAllowed;
  const advanceRefund = (p.advanceRent || 0) * (p.monthlyRent || 0);
  const refundable = Math.max(0, totalDeposit - totalDeductions + advanceRefund);
  return {
    totalDeposit, refundable, totalDeductions,
    deductions: { painting: { allowed: paintingAllowed, wrongful: paintingWrongful, note: paintingNote } },
    advanceRefund, wrongfullyDeducted: paintingWrongful,
  };
}

// ─── Mini test framework ──────────────────────────────────────────────────────

let pass = 0, fail = 0;

function test(id, name, fn) {
  try {
    fn();
    console.log(`  \u2705 ${id} \u2014 ${name}`);
    pass++;
  } catch (e) {
    console.log(`  \u274C ${id} \u2014 ${name}\n     ${e.message}`);
    fail++;
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected)
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n))
        throw new Error(`Expected ${actual} >= ${n}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${JSON.stringify(actual)}`);
    },
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log("\n\u2550\u2550\u2550 Clause Detection Tests \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

test("TC-01", "11-month lock-in = critical", () => {
  const r = auditAgreement("The lock-in period of 11 months shall apply.");
  const f = r.findings.find((x) => x.ruleId === "lock_in_excessive");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-02", "6-month lock-in = ok", () => {
  const r = auditAgreement("The lock-in period of 6 months shall apply.");
  const f = r.findings.find((x) => x.ruleId === "lock_in_excessive");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("ok");
});

test("TC-03", "10-month deposit = critical", () => {
  const r = auditAgreement("A security deposit equivalent to 10 months of rent shall be paid.");
  const f = r.findings.find((x) => x.ruleId === "deposit_months");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-04", "2-month deposit = ok", () => {
  const r = auditAgreement("The tenant shall pay 2 months deposit before occupancy.");
  const f = r.findings.find((x) => x.ruleId === "deposit_months");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("ok");
});

test("TC-05", "Painting charge clause = critical", () => {
  const r = auditAgreement("Painting charges shall be deducted by tenant from the security deposit.");
  const f = r.findings.find((x) => x.ruleId === "painting_charge");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-06", "Blanket maintenance = critical", () => {
  const r = auditAgreement("Tenant shall bear all maintenance and repair costs.");
  const f = r.findings.find((x) => x.ruleId === "maintenance_blanket");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-07", "Sole-discretion deduction = critical", () => {
  const r = auditAgreement("The landlord shall have the right to deduct amounts from the deposit at sole discretion.");
  const f = r.findings.find((x) => x.ruleId === "arbitrary_deduction");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-08", "3-month notice = warning", () => {
  const r = auditAgreement("Either party shall provide 3 months notice before vacating.");
  const f = r.findings.find((x) => x.ruleId === "notice_period_excessive");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("warning");
});

test("TC-09", "15% rent hike = warning", () => {
  const r = auditAgreement("Rent shall be increased by 15% annually effective from the second year.");
  const f = r.findings.find((x) => x.ruleId === "unilateral_rent_hike");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("warning");
});

test("TC-10", "5% rent hike = ok", () => {
  const r = auditAgreement("Rent shall be increased by 5% per annum from the second year.");
  const f = r.findings.find((x) => x.ruleId === "unilateral_rent_hike");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("ok");
});

test("TC-11", "Unilateral termination = critical", () => {
  const r = auditAgreement("The landlord may terminate this agreement at any time without prior notice.");
  const f = r.findings.find((x) => x.ruleId === "unilateral_termination");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("critical");
});

test("TC-12", "Subletting ban = info", () => {
  const r = auditAgreement("The tenant shall not sublet the premises.");
  const f = r.findings.find((x) => x.ruleId === "subletting_ban");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("info");
});

test("TC-13", "Police verification = ok", () => {
  const r = auditAgreement("The tenant must complete police verification within 7 days.");
  const f = r.findings.find((x) => x.ruleId === "police_verification");
  expect(f).toBeTruthy();
  expect(f.severity).toBe("ok");
});

console.log("\n\u2550\u2550\u2550 Risk Scoring Tests \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

test("TC-14", "High-risk agreement scores >= 70", () => {
  const text = [
    "lock-in period of 11 months",
    "deposit equivalent to 10 months of rent",
    "Painting charges shall be deducted by tenant",
    "Tenant shall bear all maintenance and repair costs",
    "landlord may terminate this agreement at any time without prior notice",
  ].join(". ");
  const r = auditAgreement(text);
  expect(r.riskScore).toBeGreaterThanOrEqual(70);
  expect(r.riskLevel).toBe("high");
});

test("TC-15", "Clean agreement = 0 risk", () => {
  const r = auditAgreement("The premises shall be used solely for residential purposes.");
  if (r.riskScore !== 0) throw new Error(`Expected 0, got ${r.riskScore}`);
  expect(r.riskLevel).toBe("low");
});

console.log("\n\u2550\u2550\u2550 Deposit Calculation Tests \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

test("TC-16", "Full refund — no deductions", () => {
  const r = calculateDeposit({ depositMonths: 2, monthlyRent: 20000, tenancyMonths: 12 });
  expect(r.totalDeposit).toBe(40000);
  expect(r.refundable).toBe(40000);
});

test("TC-17", "Painting NOT deductible >= 24m", () => {
  const r = calculateDeposit({ depositMonths: 2, monthlyRent: 25000, tenancyMonths: 30, paintingClaimed: true, paintingCost: 15000 });
  expect(r.deductions.painting.allowed).toBe(0);
  expect(r.deductions.painting.wrongful).toBe(15000);
  expect(r.refundable).toBe(50000);
});

test("TC-18", "50% painting for 12-24m", () => {
  const r = calculateDeposit({ depositMonths: 2, monthlyRent: 20000, tenancyMonths: 18, paintingClaimed: true, paintingCost: 10000 });
  expect(r.deductions.painting.allowed).toBe(5000);
  expect(r.refundable).toBe(35000);
});

test("TC-19", "Full painting for < 12m", () => {
  const r = calculateDeposit({ depositMonths: 3, monthlyRent: 20000, tenancyMonths: 6, paintingClaimed: true, paintingCost: 8000 });
  expect(r.deductions.painting.allowed).toBe(8000);
  expect(r.refundable).toBe(52000);
});

test("TC-20", "Outstanding rent deduction", () => {
  const r = calculateDeposit({ depositMonths: 3, monthlyRent: 15000, tenancyMonths: 12, outstandingRent: 30000 });
  expect(r.totalDeposit).toBe(45000);
  expect(r.refundable).toBe(15000);
});

test("TC-21", "10m deposit, 30m tenancy, painting wrongful", () => {
  const r = calculateDeposit({ depositMonths: 10, monthlyRent: 30000, tenancyMonths: 30, damageClaim: 50000, paintingClaimed: true, paintingCost: 40000 });
  expect(r.totalDeposit).toBe(300000);
  expect(r.deductions.painting.allowed).toBe(0);
  expect(r.refundable).toBe(250000);
  expect(r.wrongfullyDeducted).toBe(40000);
});

test("TC-22", "Refund never negative", () => {
  const r = calculateDeposit({ depositMonths: 1, monthlyRent: 10000, tenancyMonths: 6, outstandingRent: 15000, damageClaim: 5000 });
  expect(r.refundable).toBe(0);
});

test("TC-23", "Advance rent adds to refund", () => {
  const r = calculateDeposit({ depositMonths: 2, monthlyRent: 20000, tenancyMonths: 12, advanceRent: 1 });
  expect(r.advanceRefund).toBe(20000);
  expect(r.refundable).toBe(60000);
});

console.log("\n\u2550\u2550\u2550 Edge Cases & Engine Integrity \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");

test("TC-24", "Empty text = 0 findings", () => {
  const r = auditAgreement("");
  if (r.findings.length !== 0) throw new Error(`Expected 0 findings, got ${r.findings.length}`);
  if (r.riskScore !== 0) throw new Error(`Expected score 0, got ${r.riskScore}`);
});

test("TC-25", "Case-insensitive detection", () => {
  const r = auditAgreement("TENANT SHALL BEAR ALL MAINTENANCE AND REPAIR COSTS.");
  const f = r.findings.find((x) => x.ruleId === "maintenance_blanket");
  expect(f).toBeTruthy();
});

test("TC-26", "4 criticals = high risk", () => {
  const text = [
    "Painting charges shall be deducted by tenant.",
    "Tenant shall bear all maintenance and repair costs.",
    "The landlord may terminate this agreement at any time without prior notice.",
    "The landlord shall have the right to deduct amounts at sole discretion.",
  ].join(" ");
  const r = auditAgreement(text);
  const c = r.findings.filter((f) => f.severity === "critical").length;
  if (c < 4) throw new Error(`Expected >=4 criticals, got ${c}`);
  expect(r.riskScore).toBeGreaterThanOrEqual(70);
});

test("TC-27", "Findings sorted by severity", () => {
  const text = [
    "Tenant shall not sublet.",
    "Police verification required.",
    "3 months notice period required.",
    "Painting charges shall be deducted by tenant.",
  ].join(" ");
  const r = auditAgreement(text);
  const order = { critical: 0, warning: 1, info: 2, ok: 3 };
  for (let i = 1; i < r.findings.length; i++) {
    if (order[r.findings[i].severity] < order[r.findings[i - 1].severity]) {
      throw new Error(`Not sorted at index ${i}: ${r.findings[i - 1].severity} -> ${r.findings[i].severity}`);
    }
  }
});

test("TC-28", "CLAUSE_RULES has >= 10 rules", () => {
  if (CLAUSE_RULES.length < 10) throw new Error(`Only ${CLAUSE_RULES.length} rules`);
});

test("TC-29", "Every rule has required fields", () => {
  for (const rule of CLAUSE_RULES) {
    if (!rule.id) throw new Error("Rule missing id");
    if (!Array.isArray(rule.patterns)) throw new Error(`Rule ${rule.id} patterns not array`);
    if (typeof rule.severity !== "function") throw new Error(`Rule ${rule.id} severity not function`);
  }
});

test("TC-30", "Zero rent = zero refund", () => {
  const r = calculateDeposit({ depositMonths: 10, monthlyRent: 0, tenancyMonths: 12 });
  expect(r.totalDeposit).toBe(0);
  expect(r.refundable).toBe(0);
});

console.log(`\n\u2550\u2550\u2550 RESULTS: ${pass} passed, ${fail} failed out of ${pass + fail} \u2550\u2550\u2550\n`);
if (fail > 0) process.exit(1);
