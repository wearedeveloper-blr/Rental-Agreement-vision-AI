/**
 * tests.js — Full test suite for the Rental Auditor
 *
 * Tests:
 *   - Clause detection (each rule)
 *   - Deposit calculation (edge cases)
 *   - Risk scoring
 *   - Refund computation
 *   - False positives
 */

import { auditAgreement, calculateDeposit, CLAUSE_RULES } from "./clauseEngine.js";

// ─── Minimal test runner ──────────────────────────────────────────────────────

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toEqual(expected) {
      const a = JSON.stringify(actual);
      const b = JSON.stringify(expected);
      if (a !== b) throw new Error(`Expected ${b}, got ${a}`);
    },
    toContain(str) {
      if (typeof actual !== "string" || !actual.includes(str)) {
        throw new Error(`Expected "${actual}" to contain "${str}"`);
      }
    },
    toBeGreaterThan(n) {
      if (!(actual > n)) throw new Error(`Expected ${actual} > ${n}`);
    },
    toBeGreaterThanOrEqual(n) {
      if (!(actual >= n)) throw new Error(`Expected ${actual} >= ${n}`);
    },
    toBeLessThanOrEqual(n) {
      if (!(actual <= n)) throw new Error(`Expected ${actual} <= ${n}`);
    },
    toBeLessThan(n) {
      if (!(actual < n)) throw new Error(`Expected ${actual} < ${n}`);
    },
    toBeTruthy() {
      if (!actual) throw new Error(`Expected truthy, got ${actual}`);
    },
    toBeFalsy() {
      if (actual) throw new Error(`Expected falsy, got ${actual}`);
    },
  };
}

// ─── Test cases ───────────────────────────────────────────────────────────────

export const TEST_CASES = [

  // ── CLAUSE DETECTION TESTS ──────────────────────────────────────────────────

  {
    id: "TC-01",
    name: "Detects 11-month lock-in clause (CRITICAL)",
    group: "Clause Detection",
    description: "Agreement with 11-month lock-in must be flagged as critical.",
    run() {
      const text = "The lock-in period of 11 months shall apply from the commencement date.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "lock_in_excessive");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-02",
    name: "Detects 6-month lock-in as OK",
    group: "Clause Detection",
    description: "6-month lock-in is within acceptable range — should be flagged as 'ok'.",
    run() {
      const text = "The lock-in period of 6 months shall apply.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "lock_in_excessive");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("ok");
    },
  },

  {
    id: "TC-03",
    name: "Detects 10-month deposit clause (CRITICAL)",
    group: "Clause Detection",
    description: "Classic Bengaluru 10-month deposit must trigger critical flag.",
    run() {
      const text = "A security deposit equivalent to 10 months of rent shall be paid.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "deposit_months");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-04",
    name: "Detects 2-month deposit as OK",
    group: "Clause Detection",
    description: "2-month deposit is the ideal range — should pass.",
    run() {
      const text = "The tenant shall pay 2 months deposit before occupancy.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "deposit_months");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("ok");
    },
  },

  {
    id: "TC-05",
    name: "Detects painting charge clause (CRITICAL)",
    group: "Clause Detection",
    description: "Painting charges deducted from tenant deposit must be flagged.",
    run() {
      const text = "Painting charges shall be deducted by tenant from the security deposit at time of vacating.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "painting_charge");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-06",
    name: "Detects blanket maintenance clause (CRITICAL)",
    group: "Clause Detection",
    description: "'Tenant shall bear all maintenance costs' must be flagged.",
    run() {
      const text = "Tenant shall bear all maintenance and repair costs during the tenancy period.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "maintenance_blanket");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-07",
    name: "Detects sole-discretion deduction clause (CRITICAL)",
    group: "Clause Detection",
    description: "Deductions at landlord's sole discretion must be flagged.",
    run() {
      const text = "The landlord shall have the right to deduct amounts from the deposit at sole discretion.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "arbitrary_deduction");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-08",
    name: "Detects 3-month notice period as WARNING",
    group: "Clause Detection",
    description: "3-month notice is above market norm and should warn.",
    run() {
      const text = "Either party shall provide 3 months notice before vacating.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "notice_period_excessive");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("warning");
    },
  },

  {
    id: "TC-09",
    name: "Detects 15% annual rent hike as WARNING",
    group: "Clause Detection",
    description: "15% rent escalation exceeds market norm.",
    run() {
      const text = "Rent shall be increased by 15% annually effective from the second year.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "unilateral_rent_hike");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("warning");
    },
  },

  {
    id: "TC-10",
    name: "Detects 5% annual rent hike as OK",
    group: "Clause Detection",
    description: "5% rent escalation is acceptable.",
    run() {
      const text = "Rent shall be increased by 5% per annum from the second year.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "unilateral_rent_hike");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("ok");
    },
  },

  {
    id: "TC-11",
    name: "Detects unilateral termination clause (CRITICAL)",
    group: "Clause Detection",
    description: "Landlord can terminate at any time — must be critical.",
    run() {
      const text = "The landlord may terminate this agreement at any time without prior notice.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "unilateral_termination");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("critical");
    },
  },

  {
    id: "TC-12",
    name: "Detects subletting ban as INFO",
    group: "Clause Detection",
    description: "Subletting prohibition is standard — info only, not a critical flag.",
    run() {
      const text = "The tenant shall not sublet the premises to any third party.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "subletting_ban");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("info");
    },
  },

  {
    id: "TC-13",
    name: "Detects police verification as OK (good clause)",
    group: "Clause Detection",
    description: "Police verification required is a positive clause.",
    run() {
      const text = "The tenant must complete police verification within 7 days of occupancy.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "police_verification");
      expect(f).toBeTruthy();
      expect(f.severity).toBe("ok");
    },
  },

  {
    id: "TC-14",
    name: "High-risk agreement scores >= 70",
    group: "Risk Scoring",
    description: "Agreement with 3+ critical clauses must exceed risk score 70.",
    run() {
      const text = [
        "The lock-in period of 11 months shall apply.",
        "Security deposit equivalent to 10 months of rent.",
        "Painting charges shall be deducted by tenant.",
        "Tenant shall bear all maintenance costs.",
        "Landlord may terminate this agreement at any time without prior notice.",
      ].join(" ");
      const report = auditAgreement(text, {});
      expect(report.riskScore).toBeGreaterThanOrEqual(70);
      expect(report.riskLevel).toBe("high");
    },
  },

  {
    id: "TC-15",
    name: "Clean agreement scores 0 risk",
    group: "Risk Scoring",
    description: "Agreement with no flagged clauses should have risk score 0.",
    run() {
      const text = "The premises shall be used solely for residential purposes. Rent is due on the 5th.";
      const report = auditAgreement(text, {});
      expect(report.riskScore).toBe(0);
      expect(report.riskLevel).toBe("low");
    },
  },

  // ── DEPOSIT CALCULATION TESTS ───────────────────────────────────────────────

  {
    id: "TC-16",
    name: "Full deposit refund — no deductions",
    group: "Deposit Calculation",
    description: "2-month deposit, no damage, no outstanding rent → full refund.",
    run() {
      const result = calculateDeposit({
        depositMonths: 2,
        monthlyRent: 20000,
        tenancyMonths: 12,
        outstandingRent: 0,
        damageClaim: 0,
        paintingClaimed: false,
        paintingCost: 0,
        advanceRent: 0,
      });
      expect(result.totalDeposit).toBe(40000);
      expect(result.refundable).toBe(40000);
      expect(result.totalDeductions).toBe(0);
    },
  },

  {
    id: "TC-17",
    name: "Painting NOT deductible after 24+ months tenancy",
    group: "Deposit Calculation",
    description: "If tenant stayed 30 months, landlord cannot deduct painting (wear & tear).",
    run() {
      const result = calculateDeposit({
        depositMonths: 2,
        monthlyRent: 25000,
        tenancyMonths: 30,
        outstandingRent: 0,
        damageClaim: 0,
        paintingClaimed: true,
        paintingCost: 15000,
        advanceRent: 0,
      });
      expect(result.deductions.painting.allowed).toBe(0);
      expect(result.deductions.painting.wrongful).toBe(15000);
      expect(result.refundable).toBe(50000); // full deposit back
    },
  },

  {
    id: "TC-18",
    name: "50% painting allowed for 12-24 month tenancy",
    group: "Deposit Calculation",
    description: "If stayed 18 months, only 50% painting cost can be deducted.",
    run() {
      const result = calculateDeposit({
        depositMonths: 2,
        monthlyRent: 20000,
        tenancyMonths: 18,
        outstandingRent: 0,
        damageClaim: 0,
        paintingClaimed: true,
        paintingCost: 10000,
        advanceRent: 0,
      });
      expect(result.deductions.painting.allowed).toBe(5000);
      expect(result.deductions.painting.wrongful).toBe(5000);
      expect(result.refundable).toBe(35000); // 40000 - 5000
    },
  },

  {
    id: "TC-19",
    name: "Full painting allowed for < 12 month tenancy",
    group: "Deposit Calculation",
    description: "If stayed only 6 months, full painting cost is deductible.",
    run() {
      const result = calculateDeposit({
        depositMonths: 3,
        monthlyRent: 20000,
        tenancyMonths: 6,
        outstandingRent: 0,
        damageClaim: 0,
        paintingClaimed: true,
        paintingCost: 8000,
        advanceRent: 0,
      });
      expect(result.deductions.painting.allowed).toBe(8000);
      expect(result.deductions.painting.wrongful).toBe(0);
      expect(result.refundable).toBe(52000); // 60000 - 8000
    },
  },

  {
    id: "TC-20",
    name: "Deposit with outstanding rent deduction",
    group: "Deposit Calculation",
    description: "2 months outstanding rent deducted from 3-month deposit.",
    run() {
      const result = calculateDeposit({
        depositMonths: 3,
        monthlyRent: 15000,
        tenancyMonths: 12,
        outstandingRent: 30000, // 2 months unpaid
        damageClaim: 0,
        paintingClaimed: false,
        paintingCost: 0,
        advanceRent: 0,
      });
      expect(result.totalDeposit).toBe(45000);
      expect(result.refundable).toBe(15000); // 45000 - 30000
    },
  },

  {
    id: "TC-21",
    name: "10-month deposit with damage + painting for 30-month tenancy",
    group: "Deposit Calculation",
    description: "Classic predatory scenario: 10-month deposit, landlord claims painting after 30 months + damage.",
    run() {
      const result = calculateDeposit({
        depositMonths: 10,
        monthlyRent: 30000,
        tenancyMonths: 30,
        outstandingRent: 0,
        damageClaim: 50000,
        paintingClaimed: true,
        paintingCost: 40000,
        advanceRent: 0,
      });
      expect(result.totalDeposit).toBe(300000);
      expect(result.deductions.painting.allowed).toBe(0); // 30 months → no painting
      expect(result.deductions.painting.wrongful).toBe(40000);
      expect(result.refundable).toBe(250000); // 300000 - 50000 damage
      expect(result.wrongfullyDeducted).toBe(40000);
    },
  },

  {
    id: "TC-22",
    name: "Deposit cannot go below zero",
    group: "Deposit Calculation",
    description: "Deductions exceeding deposit → refundable is 0, not negative.",
    run() {
      const result = calculateDeposit({
        depositMonths: 1,
        monthlyRent: 10000,
        tenancyMonths: 6,
        outstandingRent: 15000, // more than deposit
        damageClaim: 5000,
        paintingClaimed: false,
        paintingCost: 0,
        advanceRent: 0,
      });
      expect(result.refundable).toBe(0);
    },
  },

  {
    id: "TC-23",
    name: "Advance rent refund adds to deposit refund",
    group: "Deposit Calculation",
    description: "If tenant paid 1 month advance rent, it must be included in refund.",
    run() {
      const result = calculateDeposit({
        depositMonths: 2,
        monthlyRent: 20000,
        tenancyMonths: 12,
        outstandingRent: 0,
        damageClaim: 0,
        paintingClaimed: false,
        paintingCost: 0,
        advanceRent: 1,
      });
      expect(result.advanceRefund).toBe(20000);
      expect(result.refundable).toBe(60000); // 40000 deposit + 20000 advance
    },
  },

  // ── EDGE CASES ──────────────────────────────────────────────────────────────

  {
    id: "TC-24",
    name: "Empty text produces no findings",
    group: "Edge Cases",
    description: "An empty agreement text should produce zero findings and zero risk score.",
    run() {
      const report = auditAgreement("", {});
      expect(report.findings.length).toBe(0);
      expect(report.riskScore).toBe(0);
    },
  },

  {
    id: "TC-25",
    name: "Case-insensitive clause detection",
    group: "Edge Cases",
    description: "Clause detection must work regardless of text casing.",
    run() {
      const text = "TENANT SHALL BEAR ALL MAINTENANCE AND REPAIR COSTS.";
      const report = auditAgreement(text, {});
      const f = report.findings.find((x) => x.ruleId === "maintenance_blanket");
      expect(f).toBeTruthy();
    },
  },

  {
    id: "TC-26",
    name: "Multiple critical clauses compound risk correctly",
    group: "Risk Scoring",
    description: "4 critical clauses should give risk score >= 70 (high).",
    run() {
      const text = [
        "Painting charges shall be deducted by tenant.",
        "Tenant shall bear all maintenance and repair costs.",
        "The landlord may terminate this agreement at any time without prior notice.",
        "The landlord shall have the right to deduct amounts at sole discretion.",
      ].join(" ");
      const report = auditAgreement(text, {});
      const criticals = report.findings.filter((f) => f.severity === "critical").length;
      expect(criticals).toBeGreaterThanOrEqual(4);
      expect(report.riskScore).toBeGreaterThanOrEqual(70);
    },
  },

  {
    id: "TC-27",
    name: "Findings sorted: critical before warning before info before ok",
    group: "Edge Cases",
    description: "Output findings must be ordered by severity.",
    run() {
      const text = [
        "Tenant shall not sublet.",                                  // info
        "Police verification required.",                             // ok
        "3 months notice period required.",                          // warning
        "Painting charges shall be deducted by tenant.",             // critical
      ].join(" ");
      const report = auditAgreement(text, {});
      const severities = report.findings.map((f) => f.severity);
      const order = { critical: 0, warning: 1, info: 2, ok: 3 };
      for (let i = 1; i < severities.length; i++) {
        expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]]);
      }
    },
  },

  {
    id: "TC-28",
    name: "CLAUSE_RULES array has at least 10 rules",
    group: "Engine Integrity",
    description: "Minimum expected number of rules are defined in the engine.",
    run() {
      expect(CLAUSE_RULES.length).toBeGreaterThanOrEqual(10);
    },
  },

  {
    id: "TC-29",
    name: "Every rule has required fields",
    group: "Engine Integrity",
    description: "Each rule must have id, category, patterns, severity fn, and recommend fn.",
    run() {
      for (const rule of CLAUSE_RULES) {
        if (!rule.id) throw new Error(`Rule missing id: ${JSON.stringify(rule)}`);
        if (!rule.category) throw new Error(`Rule ${rule.id} missing category`);
        if (!Array.isArray(rule.patterns)) throw new Error(`Rule ${rule.id} patterns must be array`);
        if (typeof rule.severity !== "function") throw new Error(`Rule ${rule.id} severity must be function`);
        if (typeof rule.recommend !== "function") throw new Error(`Rule ${rule.id} recommend must be function`);
      }
    },
  },

  {
    id: "TC-30",
    name: "Deposit with zero monthly rent returns zero refund",
    group: "Deposit Calculation",
    description: "If rent is 0 (incomplete input), refund must be 0.",
    run() {
      const result = calculateDeposit({
        depositMonths: 10,
        monthlyRent: 0,
        tenancyMonths: 12,
      });
      expect(result.totalDeposit).toBe(0);
      expect(result.refundable).toBe(0);
    },
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

export async function runTests(onResult = () => {}) {
  const results = [];
  for (const tc of TEST_CASES) {
    let status = "pass";
    let error = null;
    try {
      await tc.run();
    } catch (err) {
      status = "fail";
      error = err.message;
    }
    const r = { ...tc, status, error };
    results.push(r);
    onResult(r);
  }
  return results;
}
