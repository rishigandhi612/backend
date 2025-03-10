const express = require("express");
const { sendInvoiceEmail } = require("../controllers/email.controller.js");

const router = express.Router();

router.post("/email", sendInvoiceEmail);

module.exports = router;
