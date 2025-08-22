// controllers/invoicemail.controller.js
const { sendEmailWithAttachment } = require("../services/brevoEmail.service");
require("dotenv").config();

const sendInvoiceEmail = async (req, res) => {
  try {
    const { email, invoiceNumber, customerName, subject, message } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "At least one file is required" });
    }

    // Function to sanitize filename by replacing problematic characters
    const sanitizeFilename = (filename) => {
      return filename
        .replace(/\//g, "-") // Replace forward slashes with hyphens
        .replace(/\\/g, "-") // Replace backslashes with hyphens
        .replace(/:/g, "-") // Replace colons with hyphens
        .replace(/\*/g, "") // Remove asterisks
        .replace(/\?/g, "") // Remove question marks
        .replace(/"/g, "") // Remove double quotes
        .replace(/</g, "") // Remove less than
        .replace(/>/g, "") // Remove greater than
        .replace(/\|/g, "-") // Replace pipe with hyphen
        .trim(); // Remove leading/trailing spaces
    };

    const attachments = files.map((file) => ({
      content: file.buffer.toString("base64"),
      name: file.originalname || `Accounting Voucher.pdf`,
    }));

    // Use provided subject or fallback to default
    const emailSubject = subject || `Invoice ${invoiceNumber} | Hemant Traders`;

    // Use provided message or fallback to default, convert newlines to HTML
    const htmlContent = message
      ? `<div style="white-space: pre-line;">${message.replace(
          /\n/g,
          "<br>"
        )}</div>`
      : `
        <p>Invoice from Hemant Traders</p>
        <p>Dear ${customerName},</p>
        <p>Please find your invoice(s) attached.</p>
        <p>Thank you for your business!</p>
      `;

    const response = await sendEmailWithAttachment(
      email,
      emailSubject,
      htmlContent,
      attachments
    );

    res.status(200).json({
      message: "Invoice email sent successfully",
      response,
    });
  } catch (error) {
    console.error("Error sending invoice email:", error);
    res.status(500).json({
      message: "Failed to send invoice email",
      error: error.message,
    });
  }
};

module.exports = {
  sendInvoiceEmail,
};
