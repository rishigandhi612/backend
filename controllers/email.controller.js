const SibApiV3Sdk = require('sib-api-v3-sdk');
const Counter = require('../models/counter.models'); // Adjust path as needed
require("dotenv").config();

const defaultClient = SibApiV3Sdk.ApiClient.instance;
const apiKey = defaultClient.authentications['api-key'];
apiKey.apiKey = process.env.BREVO_API_KEY;

const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();

// Function to get next PO number (automatic)
const getNextPONumber = async () => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: 'purchase_order' },
      { $inc: { value: 9 } },
      { 
        new: true, 
        upsert: true,
        setDefaultsOnInsert: true 
      }
    );
    
    // Format PO number with prefix and padding
    const poNumber = `PO-${String(counter.value).padStart(6, '0')}`;
    return poNumber;
  } catch (error) {
    console.error('Error generating PO number:', error);
    throw new Error('Failed to generate PO number');
  }
};

const sendOrderEmail = async (req, res) => {
  try {
    const { 
      email, 
      supplierName, 
      items, 
      orderDate,
      deliveryType,
      thirdPartyCustomer,
      contactPerson,
      phoneNumber,
      expectedDeliveryDate,
    } = req.body;

    // Validate required fields
    if (!email || !supplierName || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ 
        message: "Missing required fields: email, supplierName, items" 
      });
    }

    // Always generate PO number automatically
    const poNumber = await getNextPONumber();

    // Calculate totals
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, item) => sum + (item.totalQty || 0), 0);

    // Generate items HTML with new columns
    const itemsHTML = items.map((item, index) => `
      <tr style="border-bottom: 1px solid #e0e0e0; transition: background-color 0.2s;">
        <td style="padding: 15px 12px; text-align: center; font-weight: 500; color: #424242;">${index + 1}</td>
        <td style="padding: 15px 12px; text-align: left; color: #424242;">
          <div style="font-weight: 500; margin-bottom: 2px;">${item.name}</div>
          ${item.description ? `<div style="font-size: 12px; color: #757575; font-style: italic;">${item.description}</div>` : ''}
        </td>
        <td style="padding: 15px 12px; text-align: center; color: #424242; font-weight: 500;">${item.packSize || '-'}</td>
        <td style="padding: 15px 12px; text-align: center; color: #424242; font-weight: 500;">${item.nos || 0}</td>
        <td style="padding: 15px 12px; text-align: center; color: #FF5722; font-weight: 600; background: rgba(255, 87, 34, 0.05);">${item.totalQty || 0}</td>
      </tr>
    `).join('');

    const currentDate = orderDate || new Date().toLocaleDateString('en-IN');

    // Enhanced delivery information with better styling
    let deliveryInfo = '';
    if (deliveryType === 'THIRD_PARTY_DELIVERY' && thirdPartyCustomer) {
      deliveryInfo = `
        <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffecb3 100%); padding: 25px; border-radius: 12px; margin-bottom: 25px; border-left: 4px solid #FF5722; box-shadow: 0 2px 8px rgba(255, 87, 34, 0.1);">
          <div style="display: flex; align-items: center; margin-bottom: 15px;">
            <div style="background: #FF5722; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; margin-right: 12px; font-weight: bold; font-size: 14px;">3</div>
            <h3 style="color: #FF5722; margin: 0; font-size: 18px; font-weight: 600;">Third Party Delivery Information</h3>
          </div>
          <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #ffcc80;">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
              <div>
                <strong style="color: #FF5722;">Customer Name:</strong>
                <div style="color: #424242; margin-top: 4px;">${thirdPartyCustomer.name}</div>
              </div>
              <div>
                <strong style="color: #FF5722;">Email:</strong>
                <div style="color: #424242; margin-top: 4px;">${thirdPartyCustomer.email_id}</div>
              </div>
              <div>
                <strong style="color: #FF5722;">Phone:</strong>
                <div style="color: #424242; margin-top: 4px;">${thirdPartyCustomer.phone_no}</div>
              </div>
              <div style="grid-column: 1 / -1;">
                <strong style="color: #FF5722;">Delivery Address:</strong>
                <div style="color: #424242; margin-top: 4px; line-height: 1.4;">
                  ${thirdPartyCustomer.address.line1}<br>
                  ${thirdPartyCustomer.address.city}, ${thirdPartyCustomer.address.state} - ${thirdPartyCustomer.address.pincode}
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = `Purchase Order - ${poNumber} | Hemant Traders`;
    sendSmtpEmail.to = [{ email: email, name: supplierName }];
    sendSmtpEmail.sender = { name: "Hemant Traders", email: "hemanttraders111@yahoo.in" };
    
    sendSmtpEmail.textContent = `
        Dear ${supplierName},
        
        Greetings from Hemant Traders!
        
        Please find our purchase order details below:
        
        Purchase Order Number: ${poNumber}
        Order Date: ${currentDate}
        ${expectedDeliveryDate ? `Expected Delivery: ${expectedDeliveryDate}` : ''}
        Delivery Type: ${deliveryType === 'NORMAL_DELIVERY' ? 'Normal Delivery' : 'Third Party Delivery'}
        
        Items Required:
        ${items.map((item, index) => `${index + 1}. ${item.name} - Pack Size: ${item.packSize || 'N/A'}, Nos: ${item.nos || 0}, Total Qty: ${item.totalQty || 0}`).join('\n')}
        
        Summary:
        - Total Items: ${totalItems}
        - Total Quantity: ${totalQuantity}
        
        ${deliveryType === 'THIRD_PARTY_DELIVERY' && thirdPartyCustomer ? `
        Third Party Delivery Details:
        Customer: ${thirdPartyCustomer.name}
        Address: ${thirdPartyCustomer.address.line1}, ${thirdPartyCustomer.address.city}, ${thirdPartyCustomer.address.state} - ${thirdPartyCustomer.address.pincode}
        Contact: ${thirdPartyCustomer.email_id} | ${thirdPartyCustomer.phone_no}
        ` : ''}
        
        Please confirm receipt and provide delivery timeline within 24 hours.
        
        Best regards,
        Hemant Traders
        ${contactPerson ? `Contact: ${contactPerson}` : ''}
        ${phoneNumber ? `Phone: ${phoneNumber}` : ''}
        Email: hemanttraders111@yahoo.in
      `;

    sendSmtpEmail.htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Purchase Order - ${poNumber}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
            
            .hover-effect:hover {
              background-color: #fff3e0 !important;
            }
            
            .status-badge {
              background: linear-gradient(135deg, #FF5722, #ff7043);
              color: white;
              padding: 8px 16px;
              border-radius: 20px;
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              display: inline-block;
            }
            
            .info-card {
              background: white;
              border-radius: 12px;
              padding: 20px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
              border: 1px solid #f0f0f0;
              margin-bottom: 20px;
            }
            
            .gradient-header {
              background: linear-gradient(135deg, #FF5722 0%, #ff7043 50%, #ff8a65 100%);
              background-size: 200% 200%;
              animation: gradientShift 6s ease infinite;
            }
            
            @keyframes gradientShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
          </style>
        </head>
        <body style="font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);">
          <div style="max-width: 700px; margin: 40px auto; background: white; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.1);">
            
            <!-- Header Section -->
            <div class="gradient-header" style="color: white; padding: 40px 30px; text-align: center; position: relative;">
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="20" cy="20" r="2" fill="white" opacity="0.1"/><circle cx="80" cy="80" r="2" fill="white" opacity="0.1"/><circle cx="40" cy="70" r="1" fill="white" opacity="0.1"/><circle cx="70" cy="30" r="1.5" fill="white" opacity="0.1"/></svg>'); opacity: 0.3;"></div>
              <div style="position: relative; z-index: 1;">
                <h1 style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.5px;">Purchase Order</h1>
                <div style="margin: 15px 0; opacity: 0.95;">
                  <div class="status-badge">${poNumber}</div>
                </div>
                <p style="margin: 15px 0 0 0; font-size: 16px; opacity: 0.9; font-weight: 400;">Professional procurement request from Hemant Traders</p>
              </div>
            </div>

            <!-- Main Content -->
            <div style="padding: 35px 30px;">
              
              <!-- Greeting Section -->
              <div class="info-card">
                <div style="display: flex; align-items: center; margin-bottom: 20px;">
                  <div style="background: linear-gradient(135deg, #FF5722, #ff7043); color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-weight: bold; font-size: 18px;">👋</div>
                  <div>
                    <h2 style="color: #FF5722; margin: 0; font-size: 24px; font-weight: 600;">Dear ${supplierName},</h2>
                    <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">We appreciate your continued partnership</p>
                  </div>
                </div>
                <p style="font-size: 16px; margin: 0; color: #424242; line-height: 1.6;">
                  We hope this message finds you well. Please find our detailed purchase order below and kindly confirm receipt with your delivery timeline.
                </p>
              </div>

              <!-- Order Details Section -->
              <div class="info-card">
                <div style="display: flex; align-items: center; margin-bottom: 20px;">
                  <div style="background: linear-gradient(135deg, #FF5722, #ff7043); color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-weight: bold; font-size: 16px;">📋</div>
                  <h3 style="color: #FF5722; margin: 0; font-size: 20px; font-weight: 600;">Order Information</h3>
                </div>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; padding: 20px; background: linear-gradient(135deg, #fff3e0 0%, #ffecb3 20%, #fff3e0 100%); border-radius: 12px; border-left: 4px solid #FF5722;">
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">PO Number</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${poNumber}</div>
                  </div>
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Order Date</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${currentDate}</div>
                  </div>
                  ${expectedDeliveryDate ? `
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Expected Delivery</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${expectedDeliveryDate}</div>
                  </div>
                  ` : ''}
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Delivery Type</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${deliveryType === 'NORMAL_DELIVERY' ? 'Normal Delivery' : 'Third Party Delivery'}</div>
                  </div>
                  ${contactPerson ? `
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Contact Person</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${contactPerson}</div>
                  </div>
                  ` : ''}
                  ${phoneNumber ? `
                  <div>
                    <div style="color: #FF5722; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Phone</div>
                    <div style="color: #424242; font-weight: 600; font-size: 16px;">${phoneNumber}</div>
                  </div>
                  ` : ''}
                </div>
              </div>

              <!-- Items Section -->
              <div class="info-card">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px;">
                  <div style="display: flex; align-items: center;">
                    <div style="background: linear-gradient(135deg, #FF5722, #ff7043); color: white; border-radius: 50%; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-weight: bold; font-size: 16px;">📦</div>
                    <h3 style="color: #FF5722; margin: 0; font-size: 20px; font-weight: 600;">Items Required</h3>
                  </div>
                  <div style="text-align: right;">
                    <div style="background: linear-gradient(135deg, #FF5722, #ff7043); color: white; padding: 6px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; margin-bottom: 4px;">${totalItems} Items</div>
                    <div style="color: #666; font-size: 12px;">Total Qty: ${totalQuantity}</div>
                  </div>
                </div>
                
                <div style="overflow-x: auto; border-radius: 12px; border: 1px solid #e0e0e0;">
                  <table style="width: 100%; border-collapse: collapse; background: white;">
                    <thead>
                      <tr style="background: linear-gradient(135deg, #FF5722, #ff7043); color: white;">
                        <th style="padding: 16px 12px; text-align: center; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Sr.</th>
                        <th style="padding: 16px 12px; text-align: left; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Item Description</th>
                        <th style="padding: 16px 12px; text-align: center; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Pack Size</th>
                        <th style="padding: 16px 12px; text-align: center; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Nos</th>
                        <th style="padding: 16px 12px; text-align: center; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">Total Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsHTML}
                    </tbody>
                    <tfoot>
                      <tr style="background: linear-gradient(135deg, #fff3e0, #ffecb3); font-weight: 600;">
                        <td colspan="4" style="padding: 18px 15px; text-align: right; color: #FF5722; font-size: 16px;">Grand Total:</td>
                        <td style="padding: 18px 15px; text-align: center; color: #FF5722; font-size: 18px; font-weight: 700;">${totalQuantity}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              ${deliveryInfo}

              <!-- Action Required Section -->
              <div style="background: linear-gradient(135deg, #fff3e0 0%, #ffecb3 100%); padding: 25px; border-radius: 12px; text-align: center; border: 2px solid #ffcc80; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -20px; right: -20px; background: #FF5722; color: white; border-radius: 50%; width: 60px; height: 60px; display: flex; align-items: center; justify-content: center; font-size: 24px; opacity: 0.1;">⚡</div>
                <h3 style="color: #FF5722; margin: 0 0 15px 0; font-size: 22px; font-weight: 700;">Action Required</h3>
                <p style="margin: 0 0 20px 0; font-size: 16px; color: #424242; line-height: 1.6;">
                  Please confirm receipt of this purchase order and provide your delivery timeline. We appreciate your prompt response.
                </p>
                <div style="background: #ff5722; background: linear-gradient(135deg, #ff1744, #FF5722); color: white; padding: 12px 20px; border-radius: 25px; display: inline-block; font-weight: 600; font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(255, 87, 34, 0.3);">
                  ⏰ Confirm within 24 hours
                </div>
              </div>

              <!-- Contact Information -->
              <div style="margin-top: 30px; padding: 25px; background: linear-gradient(135deg, #f5f5f5, #eeeeee); border-radius: 12px; text-align: center; border: 1px solid #e0e0e0;">
                <div style="color: #FF5722; font-weight: 600; font-size: 16px; margin-bottom: 10px;">📞 Need Help? Contact Us</div>
                <div style="color: #666; font-size: 14px; line-height: 1.6;">
                  <strong>Email:</strong> <a href="mailto:hemanttraders111@yahoo.in" style="color: #FF5722; text-decoration: none;">hemanttraders111@yahoo.in</a><br>
                  ${contactPerson ? `<strong>Contact:</strong> ${contactPerson}<br>` : ''}
                  ${phoneNumber ? `<strong>Phone:</strong> ${phoneNumber}` : ''}
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="background: linear-gradient(135deg, #424242, #616161); color: white; padding: 25px 30px; text-align: center;">
              <div style="margin-bottom: 15px;">
                <div style="font-weight: 700; font-size: 18px; color: #FF5722; margin-bottom: 5px;">Hemant Traders</div>
                <div style="opacity: 0.8; font-size: 14px;">Your Trusted Business Partner</div>
              </div>
              <div style="opacity: 0.6; font-size: 12px; line-height: 1.4;">
                © ${new Date().getFullYear()} Hemant Traders. All rights reserved.<br>
                This is an automated message. Please do not reply directly to this email.
              </div>
            </div>
          </div>
        </body>
        </html>
      `;

    await apiInstance.sendTransacEmail(sendSmtpEmail);
    
    res.status(200).json({ 
      success: true,
      message: "Purchase order sent successfully!",
      poNumber: poNumber,
      totalItems: totalItems,
      totalQuantity: totalQuantity
    });

  } catch (error) {
    console.error("Error:", error);
    
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

// Optional: Function to get current counter value
const getCurrentPONumber = async (req, res) => {
  try {
    const counter = await Counter.findOne({ name: 'purchase_order' });
    const currentValue = counter ? counter.value : 0;
    const nextPONumber = `PO-${String(currentValue + 9).padStart(6, '0')}`;
    
    res.status(200).json({
      success: true,
      currentValue,
      nextPONumber
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get PO number",
      error: error.message
    });
  }
};

// Optional: Function to reset counter (for admin use)
const resetPOCounter = async (req, res) => {
  try {
    const { startValue = 0 } = req.body;
    
    await Counter.findOneAndUpdate(
      { name: 'purchase_order' },
      { value: startValue },
      { upsert: true }
    );
    
    res.status(200).json({
      success: true,
      message: `PO counter reset to ${startValue}`,
      value: startValue
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to reset PO counter",
      error: error.message
    });
  }
};

module.exports = {
  sendOrderEmail,
  getCurrentPONumber,
  resetPOCounter
};