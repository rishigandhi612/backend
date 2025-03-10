import sgMail from "@sendgrid/mail";
import dotenv from "dotenv";

dotenv.config();

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export const sendInvoiceEmail = async (req, res) => {
  try {
    const { email, invoice } = req.body;

    if (!email || !invoice) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const msg = {
      to: email,
      from: 'rishigandhi021@gmail.com', 
      subject: `Invoice #${invoice.invoiceNumber}`,
      text: `Invoice Number: ${invoice.invoiceNumber}\nTotal: ₹${invoice.grandTotal}`,
      html: `
        <h2>Invoice Details</h2>
        <p><strong>Invoice Number:</strong> ${invoice.invoiceNumber}</p>
        <p><strong>Total Amount:</strong> ₹${invoice.grandTotal}</p>
      `,
    };

    await sgMail.send(msg);
    res.json({ message: "Email sent successfully!" });
  } catch (error) {
    console.error("SendGrid Error:", error);
    res.status(500).json({ message: "Failed to send email." });
  }
};
