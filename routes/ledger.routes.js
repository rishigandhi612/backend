/**
 * Reporting Routes — mount at /api/reports
 */

const express = require("express");
const router = express.Router();
const {
  customerLedger,
  outstandingBills,
  receivablesSummary,
  ageingAnalysis,
  bankwiseCollection,
} = require("../controllers/ledger.controller");

router.get("/ledger/:customerId", customerLedger);
router.get("/outstanding", outstandingBills);
router.get("/receivables", receivablesSummary);
router.get("/ageing", ageingAnalysis);
router.get("/bank-collection", bankwiseCollection);

module.exports = router;
