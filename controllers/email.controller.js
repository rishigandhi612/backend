const SibApiV3Sdk = require('sib-api-v3-sdk');
require("dotenv").config();

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

const sendOrderEmail = async (req, res) => {
  try {
    const { 
      email, 
      supplierName, 
      poNumber, 
      items, 
      totalAmount, 
      orderDate,
      deliveryAddress,
      contactPerson,
      phoneNumber,
      expectedDeliveryDate,
      paymentTerms 
    } = req.body;

    // Validate required fields
    if (!email || !supplierName || !poNumber || !items || !totalAmount) {
      return res.status(400).json({ 
        message: "Missing required fields: email, supplierName, poNumber, items, totalAmount" 
      });
    }

    // Generate items HTML
    const itemsHTML = items.map(item => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 12px; text-align: left;">${item.name}</td>
        <td style="padding: 12px; text-align: center;">${item.quantity}</td>
        <td style="padding: 12px; text-align: right;">₹${item.price}</td>
        <td style="padding: 12px; text-align: right;">₹${(item.quantity * item.price).toFixed(2)}</td>
      </tr>
    `).join('');

    const currentDate = orderDate || new Date().toLocaleDateString('en-IN');

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = `Purchase Order - ${poNumber}`;
    sendSmtpEmail.to = [{ email: email, name: supplierName }];
    sendSmtpEmail.sender = { name: "Hemant Traders", email: "hemanttraders111@yahoo.in" };
    sendSmtpEmail.textContent = `
        Dear ${supplierName},
        
        Please find our purchase order details below:
        
        Purchase Order Number: ${poNumber}
        Order Date: ${currentDate}
        ${expectedDeliveryDate ? `Expected Delivery: ${expectedDeliveryDate}` : ''}
        
        Items Required:
        ${items.map(item => `- ${item.name} x${item.quantity} @ ₹${item.price} = ₹${(item.quantity * item.price).toFixed(2)}`).join('\n')}
        
        Total Amount: ₹${totalAmount}
        ${deliveryAddress ? `Delivery Address: ${deliveryAddress}` : ''}
        ${paymentTerms ? `Payment Terms: ${paymentTerms}` : ''}
        
        Please confirm receipt and provide delivery timeline.
        
        Best regards,
        Hemant Traders
        ${contactPerson ? `Contact: ${contactPerson}` : ''}
        ${phoneNumber ? `Phone: ${phoneNumber}` : ''}
      `;
    sendSmtpEmail.htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Order Confirmation</title>
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="margin: 0; font-size: 28px;">Purchase Order</h1>
            <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">Please process the following order</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #667eea; margin-top: 0; border-bottom: 2px solid #667eea; padding-bottom: 10px;">Dear ${supplierName},</h2>
              <p style="font-size: 16px; margin-bottom: 20px;">Please find our purchase order details below. Kindly confirm receipt and provide delivery timeline.</p>
              
              <div style="background: #e3f2fd; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                <p style="margin: 0;"><strong>PO Number:</strong> ${poNumber}</p>
                <p style="margin: 5px 0 0 0;"><strong>Order Date:</strong> ${currentDate}</p>
                ${expectedDeliveryDate ? `<p style="margin: 5px 0 0 0;"><strong>Expected Delivery:</strong> ${expectedDeliveryDate}</p>` : ''}
                ${contactPerson ? `<p style="margin: 5px 0 0 0;"><strong>Contact Person:</strong> ${contactPerson}</p>` : ''}
                ${phoneNumber ? `<p style="margin: 5px 0 0 0;"><strong>Phone:</strong> ${phoneNumber}</p>` : ''}
              </div>
            </div>

            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #667eea; margin-top: 0;">Items Required</h3>
              <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
                <thead>
                  <tr style="background: #667eea; color: white;">
                    <th style="padding: 12px; text-align: left;">Item Description</th>
                    <th style="padding: 12px; text-align: center;">Quantity</th>
                    <th style="padding: 12px; text-align: right;">Unit Price</th>
                    <th style="padding: 12px; text-align: right;">Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHTML}
                </tbody>
                <tfoot>
                  <tr style="background: #f8f9fa; font-weight: bold; font-size: 16px;">
                    <td colspan="3" style="padding: 15px; text-align: right;">Total Amount:</td>
                    <td style="padding: 15px; text-align: right; color: #667eea;">₹${totalAmount}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            ${deliveryAddress ? `
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #667eea; margin-top: 0;">Delivery Address</h3>
              <p style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 0;">${deliveryAddress}</p>
            </div>
            ` : ''}

            ${paymentTerms ? `
            <div style="background: white; padding: 25px; border-radius: 8px; margin-bottom: 20px;">
              <h3 style="color: #667eea; margin-top: 0;">Payment Terms</h3>
              <p style="background: #f8f9fa; padding: 15px; border-radius: 6px; margin: 0;">${paymentTerms}</p>
            </div>
            ` : ''}

            <div style="background: white; padding: 25px; border-radius: 8px; text-align: center;">
              <h3 style="color: #667eea; margin-top: 0;">Action Required</h3>
              <p style="margin-bottom: 20px;">Please confirm receipt of this purchase order and provide your delivery timeline. Contact us if you have any questions.</p>
              <div style="background: #fff3cd; padding: 15px; border-radius: 6px; margin-top: 20px;">
                <p style="margin: 0; color: #856404;"><strong>⚠️ Please confirm this order within 24 hours</strong></p>
              </div>
            </div>

            <div style="margin-top: 30px; text-align: center; padding-top: 20px; border-top: 1px solid #ddd;">
              <p style="margin: 0; color: #666; font-size: 14px;">
                For any queries, please contact us at hemanttraders111@yahoo.in
              </p>
              <p style="margin: 5px 0 0 0; color: #666; font-size: 12px;">
                © ${new Date().getFullYear()} Hemant Traders. All rights reserved.
              </p>
            </div>
          </div>
        </body>
        </html>
      `;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    res.status(200).json({ 
      success: true,
      message: "Purchase order sent successfully!",
      poNumber: poNumber
    });

  } catch (error) {
    console.error("Brevo Error:", error);
    
    // Handle specific Brevo errors
    if (error.response) {
      console.error("Brevo Response Error:", error.response.text);
      return res.status(400).json({ 
        success: false,
        message: "Email service error",
        error: error.response.text || "Invalid email configuration"
      });
    }
    
    res.status(500).json({ 
      success: false,
      message: "Failed to send purchase order",
      error: error.message 
    });
  }
};

module.exports = {
  sendOrderEmail
};