// controllers/invoicemail.controller.js
const { sendEmailWithAttachment } = require("../services/brevoEmail.service");
require("dotenv").config();

const sendInvoiceEmail = async (req, res) => {
  try {
    const { email, invoiceNumber, customerName } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "At least one file is required" });
    }

    const attachments = files.map((file, index) => ({
      content: file.buffer.toString("base64"),
      name: file.originalname || `Invoice_${invoiceNumber}_${index + 1}.pdf`,
    }));

    const subject = `Invoice ${invoiceNumber} | Hemant Traders`;
    const htmlContent = `
      <h1>Invoice from Hemant Traders</h1>
      <p>Dear ${customerName},</p>
      <p>Please find your invoice(s) attached.</p>
      <p>Thank you for your business!</p>
    `;

    const response = await sendEmailWithAttachment(
      email,
      subject,
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
