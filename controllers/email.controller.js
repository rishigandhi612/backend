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
      remarks,
    } = req.body;
   let companyName = req.body.companyName || 'HEMANT TRADERS';
    let gstNumber = req.body.gstNumber || '27AAVPG7824M1ZX';
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

    // Generate items HTML with professional styling
    const itemsHTML = items.map((item, index) => `
      <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); transition: all 0.3s ease;">
        <td style="padding: 20px 15px; text-align: center; font-weight: 600; color: #2c3e50; font-size: 14px;">${index + 1}</td>
        <td style="padding: 20px 15px; text-align: left; color: #2c3e50;">
          <div style="font-weight: 600; margin-bottom: 4px; font-size: 15px;">${item.name}</div>
          ${item.description ? `<div style="font-size: 13px; color: #7f8c8d; line-height: 1.4;">${item.description}</div>` : ''}
        </td>
        <td style="padding: 20px 15px; text-align: center; color: #2c3e50; font-weight: 500; font-size: 14px;">${item.packSize || '-'}</td>
        <td style="padding: 20px 15px; text-align: center; color: #2c3e50; font-weight: 500; font-size: 14px;">${item.nos || 0}</td>
        <td style="padding: 20px 15px; text-align: center; color: #e67e22; font-weight: 700; font-size: 16px;">${item.totalQty || 0}</td>
      </tr>
    `).join('');

    const currentDate = orderDate || new Date().toLocaleDateString('en-IN');

    // Professional third-party delivery information
    let deliveryInfo = '';
    if (deliveryType === 'THIRD_PARTY_DELIVERY' && thirdPartyCustomer) {
      deliveryInfo = `
        <div style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.85)); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 30px; margin-bottom: 25px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
          <div style="border-left: 4px solid #e67e22; padding-left: 20px; margin-bottom: 20px;">
            <h3 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">Third Party Delivery</h3>
            <p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.5;">Delivery to be made in the name of the customer with the following details</p>
          </div>
          <div style="background: linear-gradient(135deg, rgba(230, 126, 34, 0.05), rgba(230, 126, 34, 0.02)); border-radius: 12px; padding: 25px; border: 1px solid rgba(230, 126, 34, 0.15);">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px;">
              <div>
                <div style="color: #e67e22; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Customer Name</div>
                <div style="color: #2c3e50; font-weight: 600; font-size: 16px;">${thirdPartyCustomer.name}</div>
              </div>
              <div>
                <div style="color: #e67e22; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px;">Delivery City</div>
                <div style="color: #2c3e50; font-weight: 600; font-size: 16px;">${thirdPartyCustomer.address?.city || 'Not specified'}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // Remarks section
    let remarksSection = '';
    if (remarks && remarks.trim()) {
      remarksSection = `
        <div style="background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.85)); backdrop-filter: blur(20px); border: 1px solid rgba(255, 255, 255, 0.3); border-radius: 16px; padding: 30px; margin-bottom: 25px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);">
          <div style="border-left: 4px solid #e67e22; padding-left: 20px; margin-bottom: 20px;">
            <h3 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 20px; font-weight: 700; letter-spacing: -0.3px;">Special Instructions</h3>
            <p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.5;">Please note the following requirements</p>
          </div>
          <div style="background: linear-gradient(135deg, rgba(230, 126, 34, 0.05), rgba(230, 126, 34, 0.02)); border-radius: 12px; padding: 25px; border: 1px solid rgba(230, 126, 34, 0.15);">
            <div style="color: #2c3e50; font-size: 15px; line-height: 1.7; font-weight: 500;">${remarks}</div>
          </div>
        </div>
      `;
    }

    const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();

    sendSmtpEmail.subject = `Purchase Order - ${poNumber} | Hemant Traders`;
    sendSmtpEmail.to = [{ email: email, name: supplierName }];
    sendSmtpEmail.sender = { name: "Hemant Traders Purchase Order", email: "rishigandhi021@gmail.com" };
    
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
        
        ${companyName ? `Company: ${companyName}` : ''}
        ${gstNumber ? `GST: ${gstNumber}` : ''}
        
        ${remarks ? `Special Instructions: ${remarks}` : ''}
        
        Please confirm receipt and provide delivery timeline within 24 hours.
        
        Best regards,
        Hemant Traders
        Address: 1281, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030
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
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
            
            .glass-effect {
              background: linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05));
              backdrop-filter: blur(20px);
              border: 1px solid rgba(255, 255, 255, 0.2);
              border-radius: 16px;
            }
            
            .gradient-primary {
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            
            .gradient-secondary {
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            }
            
            .hover-effect:hover {
              background: linear-gradient(135deg, rgba(255, 255, 255, 0.15), rgba(255, 255, 255, 0.08));
              transform: translateY(-2px);
              box-shadow: 0 12px 40px rgba(0, 0, 0, 0.15);
            }
            
            .professional-badge {
              background: linear-gradient(135deg, #2c3e50, #34495e);
              color: white;
              padding: 12px 24px;
              border-radius: 25px;
              font-size: 13px;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 1.2px;
              display: inline-block;
              box-shadow: 0 4px 15px rgba(44, 62, 80, 0.3);
            }
            
            .animated-gradient {
              background: linear-gradient(-45deg, #e67e22, #f39c12, #d35400, #ff7043);
              background-size: 400% 400%;
              animation: gradientShift 8s ease infinite;
            }
            
            @keyframes gradientShift {
              0% { background-position: 0% 50%; }
              50% { background-position: 100% 50%; }
              100% { background-position: 0% 50%; }
            }
            
            .glass-card {
              background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.85));
              backdrop-filter: blur(20px);
              border: 1px solid rgba(255, 255, 255, 0.3);
              border-radius: 16px;
              box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
            }
            
            @media (max-width: 600px) {
              .responsive-grid {
                grid-template-columns: 1fr !important;
              }
            }
          </style>
        </head>
        <body style="font-family: 'Inter', Arial, sans-serif; line-height: 1.6; color: #2c3e50; margin: 0; padding: 0; min-height: 100vh;">
          <div style="max-width: 750px; margin: 40px auto; background: linear-gradient(135deg, rgba(255, 255, 255, 0.95), rgba(255, 255, 255, 0.9)); backdrop-filter: blur(30px); border-radius: 24px; overflow: hidden; box-shadow: 0 25px 80px rgba(0, 0, 0, 0.15); border: 1px solid black;  background: linear-gradient(135deg, #ffe4cfff 100%, #ffc15dff 50%, #d35400 0%);">
            
            <!-- Header Section -->
            <div class="animated-gradient" style="color: white; padding: 50px 40px; text-align: center; position: relative; overflow: hidden;">
              <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.1);"></div>
              <div style="position: relative; z-index: 1;">
                <h1 style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: -1px; text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);">Purchase Order</h1>
                <div style="margin: 20px 0;">
                  <div class="professional-badge">${poNumber}</div>
                </div>
                <p style="margin: 20px 0 0 0; font-size: 17px; opacity: 0.95; font-weight: 400; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);">Professional Procurement Request</p>
              </div>
            </div>

            <!-- Main Content -->
            <div style="padding: 40px;">

              <!-- Greeting Section -->
              <div class="glass-card" style="padding: 35px; margin-bottom: 30px;">
                <div style="border-left: 4px solid #e67e22; padding-left: 25px; margin-bottom: 25px;">
                  <h2 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 28px; font-weight: 700; letter-spacing: -0.5px;">Dear ${supplierName},</h2>
                  <p style="margin: 0; color: #7f8c8d; font-size: 16px; line-height: 1.6;">We value our partnership and appreciate your continued service excellence</p>
                </div>
                <p style="font-size: 17px; margin: 0; color: #2c3e50; line-height: 1.7; font-weight: 400;">
                  Please review the detailed purchase order specifications below. We request your prompt confirmation along with the proposed delivery schedule.
                </p>
              </div>
     
              <!-- Billing Details Section -->
              ${companyName || gstNumber ? `
              <div class="glass-card" style="padding: 35px; margin-bottom: 30px;">
                <div style="border-left: 4px solid #e67e22; padding-left: 25px; margin-bottom: 25px;">
                  <h3 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Billing Information</h3>
                  <p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.5;">Company details and tax information</p>
                </div>
                
                <div class="responsive-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 25px; padding: 30px; background: linear-gradient(135deg, rgba(230, 126, 34, 0.05), rgba(230, 126, 34, 0.02)); border-radius: 16px; border: 1px solid rgba(230, 126, 34, 0.15);">
                  ${companyName ? `
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Company Name</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${companyName}</div>
                  </div>
                  ` : ''}
                  ${gstNumber ? `
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">GST Number</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${gstNumber}</div>
                  </div>
                  ` : ''}
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Business Address</div>
                    <div style="color: #2c3e50; font-weight: 600; font-size: 16px; line-height: 1.5;">1281, Vertex Arcade, Sadashiv Peth,<br>Pune, Maharashtra 411030</div>
                  </div>
                </div>
              </div>
              ` : ''}
              <!-- Order Details Section -->
              <div class="glass-card" style="padding: 35px; margin-bottom: 30px;">
                <div style="border-left: 4px solid #e67e22; padding-left: 25px; margin-bottom: 25px;">
                  <h3 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Order Information</h3>
                  <p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.5;">Complete order details and specifications</p>
                </div>
                
                <div class="responsive-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 25px; padding: 30px; background: linear-gradient(135deg, rgba(230, 126, 34, 0.05), rgba(230, 126, 34, 0.02)); border-radius: 16px; border: 1px solid rgba(230, 126, 34, 0.15);">
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Purchase Order Number</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${poNumber}</div>
                  </div>
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Order Date</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${currentDate}</div>
                  </div>
                  ${expectedDeliveryDate ? `
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Expected Delivery</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${expectedDeliveryDate}</div>
                  </div>
                  ` : ''}
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Delivery Type</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${deliveryType === 'NORMAL_DELIVERY' ? 'Standard Delivery' : 'Third Party Delivery'}</div>
                  </div>
                  ${contactPerson ? `
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Contact Person</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${contactPerson}</div>
                  </div>
                  ` : ''}
                  ${phoneNumber ? `
                  <div>
                    <div style="color: #e67e22; font-weight: 700; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Contact Number</div>
                    <div style="color: #2c3e50; font-weight: 700; font-size: 18px;">${phoneNumber}</div>
                  </div>
                  ` : ''}
                </div>
              </div>

              <!-- Items Section -->
              <div class="glass-card" style="padding: 35px; margin-bottom: 30px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 25px; flex-wrap: wrap; gap: 15px;">
                  <div style="border-left: 4px solid #27ae60; padding-left: 25px;">
                    <h3 style="color: #2c3e50; margin: 0 0 10px 0; font-size: 22px; font-weight: 700; letter-spacing: -0.3px;">Items Required</h3>
                    <p style="color: #7f8c8d; margin: 0; font-size: 14px; line-height: 1.5;">Detailed item specifications and quantities</p>
                  </div>
                  <div style="text-align: right;">
                    <div style="background: linear-gradient(135deg, #27ae60, #2ecc71); color: white; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 700; margin-bottom: 6px; display: inline-block;">${totalItems} Items</div>
                    <div style="color: #7f8c8d; font-size: 13px; font-weight: 600;">Total Quantity: ${totalQuantity}</div>
                  </div>
                </div>
                
                <div style="overflow-x: auto; border-radius: 16px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);">
                  <table style="width: 100%; border-collapse: collapse; background: linear-gradient(135deg, rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.95)); backdrop-filter: blur(10px);">
                    <thead>
                      <tr style="background: linear-gradient(135deg, #2c3e50, #34495e); color: white;">
                        <th style="padding: 20px 15px; text-align: center; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;">Sr. No.</th>
                        <th style="padding: 20px 15px; text-align: left; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;">Item Description</th>
                        <th style="padding: 20px 15px; text-align: center; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;">Pack Size</th>
                        <th style="padding: 20px 15px; text-align: center; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;">Quantity</th>
                        <th style="padding: 20px 15px; text-align: center; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 0.8px;">Total Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${itemsHTML}
                    </tbody>
                    <tfoot>
                      <tr style="background: linear-gradient(135deg, rgba(231, 76, 60, 0.1), rgba(231, 76, 60, 0.05)); backdrop-filter: blur(10px);">
                        <td colspan="4" style="padding: 25px 20px; text-align: right; color: #2c3e50; font-size: 18px; font-weight: 700;">Grand Total:</td>
                        <td style="padding: 25px 20px; text-align: center; color: #e74c3c; font-size: 22px; font-weight: 800; background: linear-gradient(135deg, rgba(231, 76, 60, 0.15), rgba(231, 76, 60, 0.1)); border-radius: 8px;">${totalQuantity}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              ${deliveryInfo}
              ${remarksSection}

              <!-- Action Required Section -->
              <div style="background: linear-gradient(135deg, rgba(230, 126, 34, 0.1), rgba(230, 126, 34, 0.05)); backdrop-filter: blur(20px); border: 1px solid rgba(230, 126, 34, 0.2); padding: 35px; border-radius: 16px; text-align: center; position: relative; overflow: hidden;">
                <div style="position: absolute; top: -30px; right: -30px; background: linear-gradient(135deg, rgba(230, 126, 34, 0.1), rgba(230, 126, 34, 0.05)); border-radius: 50%; width: 80px; height: 80px; opacity: 0.3;"></div>
                <h3 style="color: #2c3e50; margin: 0 0 20px 0; font-size: 26px; font-weight: 800; letter-spacing: -0.5px;">Confirmation Required</h3>
                <p style="margin: 0 0 25px 0; font-size: 17px; color: #2c3e50; line-height: 1.7; font-weight: 400;">
                  Please acknowledge receipt of this purchase order and provide your delivery schedule. Your prompt response ensures smooth order processing.
                </p>
                <div style="background: linear-gradient(135deg, #e67e22, #f39c12); color: white; padding: 15px 25px; border-radius: 30px; display: inline-block; font-weight: 700; font-size: 14px; text-transform: uppercase; letter-spacing: 0.8px; box-shadow: 0 6px 20px rgba(230, 126, 34, 0.4);">
                  Response Expected Within 24 Hours
                </div>
              </div>

              <!-- Contact Information -->
              <div style="margin-top: 30px; padding: 35px; background: linear-gradient(135deg, rgba(149, 165, 166, 0.1), rgba(149, 165, 166, 0.05)); backdrop-filter: blur(20px); border: 1px solid rgba(149, 165, 166, 0.2); border-radius: 16px; text-align: center;">
                <div style="color: #2c3e50; font-weight: 700; font-size: 18px; margin-bottom: 15px; letter-spacing: -0.3px;">Contact Information</div>
                <div style="color: #7f8c8d; font-size: 15px; line-height: 1.8; font-weight: 500;">
                  <strong style="color: #2c3e50;">Email:</strong> <a href="mailto:hemanttraders111@yahoo.in" style="color: #e67e22; text-decoration: none; font-weight: 600;">hemanttraders111@yahoo.in</a><br>
                  <strong style="color: #2c3e50;">Address:</strong> 1281, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030<br>
                  ${contactPerson ? `<strong style="color: #2c3e50;">Contact Person:</strong> ${contactPerson}<br>` : ''}
                  ${phoneNumber ? `<strong style="color: #2c3e50;">Phone:</strong> ${phoneNumber}` : ''}
                </div>
              </div>
            </div>

            <!-- Footer -->
            <div style="background: linear-gradient(135deg, #2c3e50, #34495e); color: white; padding: 35px 40px; text-align: center;">
              <div style="margin-bottom: 20px;">
                <div style="font-weight: 800; font-size: 22px; color: #ecf0f1; margin-bottom: 8px; letter-spacing: -0.3px;">Hemant Traders</div>
                <div style="opacity: 0.8; font-size: 15px; font-weight: 500;">1281, Shop No.5, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030.</div>
              </div>
              <div style="opacity: 0.6; font-size: 13px; line-height: 1.6; font-weight: 400;">
                © ${new Date().getFullYear()} Hemant Traders. All rights reserved.<br>
                This is an automated business communication. Please respond via the provided contact details.
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