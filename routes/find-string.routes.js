const express = require("express");
const router = express.Router();

const {
  findStringTypes,
  testPipeline,
  findAllStrings,
} = require("../controllers/find-string-types");

// Find string types route
router.get("/find-string-types", findStringTypes);

// Test pipeline route
router.get("/test-pipeline", testPipeline);
router.get("/find-all-strings", findAllStrings);

module.exports = router;
