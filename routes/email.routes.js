// routes/email.routes.js
const express = require("express");
const multer = require("multer");
const { sendOrderEmail } = require("../controllers/email.controller.js");
const {
  sendInvoiceEmail,
} = require("../controllers/invoicemail.controller.js");

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

router.post("/email", sendOrderEmail);
router.post("/invoice", upload.any(), sendInvoiceEmail);

module.exports = router;
