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

    // Generate items HTML with email-safe styling
    const itemsHTML = items.map((item, index) => `
      <tr style="border-bottom: 1px solid #ddd;">
        <td style="padding: 12px 8px; text-align: center; font-weight: bold; color: #333; font-size: 14px; background-color: #f8f9fa;">${index + 1}</td>
        <td style="padding: 12px 8px; text-align: left; color: #333; background-color: #ffffff;">
          <div style="font-weight: bold; margin-bottom: 4px; font-size: 15px; color: #2c3e50;">${item.name}</div>
          ${item.description ? `<div style="font-size: 13px; color: #666; line-height: 1.4;">${item.description}</div>` : ''}
        </td>
        <td style="padding: 12px 8px; text-align: center; color: #333; font-weight: 500; font-size: 14px; background-color: #f8f9fa;">${item.packSize || '-'}</td>
        <td style="padding: 12px 8px; text-align: center; color: #333; font-weight: 500; font-size: 14px; background-color: #ffffff;">${item.nos || 0}</td>
        <td style="padding: 12px 8px; text-align: center; color: #e67e22; font-weight: bold; font-size: 16px; background-color: #fff3cd;">${item.totalQty || 0}</td>
      </tr>
    `).join('');

    const currentDate = orderDate || new Date().toLocaleDateString('en-IN');

    // Professional third-party delivery information
    let deliveryInfo = '';
    if (deliveryType === 'THIRD_PARTY_DELIVERY' && thirdPartyCustomer) {
      deliveryInfo = `
        <table style="width: 100%; margin-bottom: 25px; border: 2px solid #e67e22; border-radius: 8px; background-color: #fff;">
          <tr>
            <td style="padding: 20px;">
              <div style="border-left: 4px solid #e67e22; padding-left: 15px; margin-bottom: 15px;">
                <h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">Third Party Delivery</h3>
                <p style="color: #666; margin: 0; font-size: 14px;">Delivery to be made in the name of the customer</p>
              </div>
              <table style="width: 100%; background-color: #fef9e7; border: 1px solid #f39c12; border-radius: 6px;">
                <tr>
                  <td style="padding: 15px;">
                    <table style="width: 100%;">
                      <tr>
                        <td style="width: 50%; vertical-align: top;">
                          <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Customer Name</div>
                          <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${thirdPartyCustomer.name}</div>
                        </td>
                        <td style="width: 50%; vertical-align: top;">
                          <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Delivery City</div>
                          <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${thirdPartyCustomer.address?.city || 'Not specified'}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      `;
    }

    // Remarks section
    let remarksSection = '';
    if (remarks && remarks.trim()) {
      remarksSection = `
        <table style="width: 100%; margin-bottom: 25px; border: 2px solid #e67e22; border-radius: 8px; background-color: #fff;">
          <tr>
            <td style="padding: 20px;">
              <div style="border-left: 4px solid #e67e22; padding-left: 15px; margin-bottom: 15px;">
                <h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 18px; font-weight: bold;">Special Instructions</h3>
                <p style="color: #666; margin: 0; font-size: 14px;">Please note the following requirements</p>
              </div>
              <div style="background-color: #fef9e7; border: 1px solid #f39c12; border-radius: 6px; padding: 15px;">
                <div style="color: #2c3e50; font-size: 15px; line-height: 1.6; font-weight: 500;">${remarks}</div>
              </div>
            </td>
          </tr>
        </table>
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
        </head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4;">
          
          <!-- Main Container -->
          <table style="max-width: 700px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 10px; overflow: hidden;">
            
            <!-- Header Section -->
            <tr>
              <td style="background-color: #e67e22; color: #ffffff; padding: 30px; text-align: center;">
                <h1 style="margin: 0; font-size: 32px; font-weight: bold;">Purchase Order</h1>
                <div style="margin: 15px 0;">
                  <div style="background-color: #2c3e50; color: #ffffff; padding: 10px 20px; border-radius: 25px; font-size: 14px; font-weight: bold; text-transform: uppercase; display: inline-block;">${poNumber}</div>
                </div>
                <p style="margin: 15px 0 0 0; font-size: 16px; opacity: 0.9;">Professional Procurement Request</p>
              </td>
            </tr>

            <!-- Main Content -->
            <tr>
              <td style="padding: 30px;">

                <!-- Greeting Section -->
                <table style="width: 100%; margin-bottom: 25px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px;">
                  <tr>
                    <td style="padding: 25px;">
                      <div style="border-left: 4px solid #e67e22; padding-left: 20px; margin-bottom: 20px;">
                        <h2 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 24px; font-weight: bold;">Dear ${supplierName},</h2>
                        <p style="margin: 0; color: #666; font-size: 14px;">We value our partnership and appreciate your continued service excellence</p>
                      </div>
                      <p style="font-size: 16px; margin: 0; color: #2c3e50; line-height: 1.6;">
                        Please review the detailed purchase order specifications below. We request your prompt confirmation along with the proposed delivery schedule.
                      </p>
                    </td>
                  </tr>
                </table>
       
                <!-- Billing Details Section -->
                ${companyName || gstNumber ? `
                <table style="width: 100%; margin-bottom: 25px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px;">
                  <tr>
                    <td style="padding: 25px;">
                      <div style="border-left: 4px solid #e67e22; padding-left: 20px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 20px; font-weight: bold;">Billing Information</h3>
                        <p style="color: #666; margin: 0; font-size: 14px;">Company details and tax information</p>
                      </div>
                      
                      <table style="width: 100%; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px;">
                        <tr>
                          <td style="padding: 20px;">
                            <table style="width: 100%;">
                              <tr>
                                ${companyName ? `
                                <td style="width: 50%; vertical-align: top; padding-right: 15px;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Company Name</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${companyName}</div>
                                </td>
                                ` : ''}
                                ${gstNumber ? `
                                <td style="width: 50%; vertical-align: top;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">GST Number</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${gstNumber}</div>
                                </td>
                                ` : ''}
                              </tr>
                              <tr>
                                <td colspan="2" style="padding-top: 15px;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Business Address</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 14px; line-height: 1.5;">1281, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
                ` : ''}

                <!-- Order Details Section -->
                <table style="width: 100%; margin-bottom: 25px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px;">
                  <tr>
                    <td style="padding: 25px;">
                      <div style="border-left: 4px solid #e67e22; padding-left: 20px; margin-bottom: 20px;">
                        <h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 20px; font-weight: bold;">Order Information</h3>
                        <p style="color: #666; margin: 0; font-size: 14px;">Complete order details and specifications</p>
                      </div>
                      
                      <table style="width: 100%; background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px;">
                        <tr>
                          <td style="padding: 20px;">
                            <table style="width: 100%;">
                              <tr>
                                <td style="width: 50%; vertical-align: top; padding: 0 10px 15px 0;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Purchase Order Number</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${poNumber}</div>
                                </td>
                                <td style="width: 50%; vertical-align: top; padding: 0 0 15px 10px;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Order Date</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${currentDate}</div>
                                </td>
                              </tr>
                              ${expectedDeliveryDate ? `
                              <tr>
                                <td style="width: 50%; vertical-align: top; padding: 0 10px 15px 0;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Expected Delivery</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${expectedDeliveryDate}</div>
                                </td>
                                <td style="width: 50%; vertical-align: top; padding: 0 0 15px 10px;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Delivery Type</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${deliveryType === 'NORMAL_DELIVERY' ? 'Standard Delivery' : 'Third Party Delivery'}</div>
                                </td>
                              </tr>
                              ` : `
                              <tr>
                                <td colspan="2" style="padding: 0 0 15px 0;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Delivery Type</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${deliveryType === 'NORMAL_DELIVERY' ? 'Standard Delivery' : 'Third Party Delivery'}</div>
                                </td>
                              </tr>
                              `}
                              ${contactPerson || phoneNumber ? `
                              <tr>
                                ${contactPerson ? `
                                <td style="width: 50%; vertical-align: top; padding: 0 10px 0 0;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Contact Person</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${contactPerson}</div>
                                </td>
                                ` : '<td style="width: 50%;"></td>'}
                                ${phoneNumber ? `
                                <td style="width: 50%; vertical-align: top; padding: 0 0 0 10px;">
                                  <div style="color: #e67e22; font-weight: bold; font-size: 12px; text-transform: uppercase; margin-bottom: 8px;">Contact Number</div>
                                  <div style="color: #2c3e50; font-weight: bold; font-size: 16px;">${phoneNumber}</div>
                                </td>
                                ` : '<td style="width: 50%;"></td>'}
                              </tr>
                              ` : ''}
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>

                <!-- Items Section -->
                <table style="width: 100%; margin-bottom: 25px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px;">
                  <tr>
                    <td style="padding: 25px;">
                      <table style="width: 100%; margin-bottom: 20px;">
                        <tr>
                          <td style="border-left: 4px solid #27ae60; padding-left: 20px;">
                            <h3 style="color: #2c3e50; margin: 0 0 8px 0; font-size: 20px; font-weight: bold;">Items Required</h3>
                            <p style="color: #666; margin: 0; font-size: 14px;">Detailed item specifications and quantities</p>
                          </td>
                          <td style="text-align: right; vertical-align: top;">
                            <div style="background-color: #27ae60; color: #ffffff; padding: 6px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; margin-bottom: 5px; display: inline-block;">${totalItems} Items</div>
                            <div style="color: #666; font-size: 12px; font-weight: bold;">Total Quantity: ${totalQuantity}</div>
                          </td>
                        </tr>
                      </table>
                      
                      <table style="width: 100%; border-collapse: collapse; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                        <thead>
                          <tr style="background-color: #2c3e50; color: #ffffff;">
                            <th style="padding: 15px 8px; text-align: center; font-weight: bold; font-size: 13px;">Sr. No.</th>
                            <th style="padding: 15px 8px; text-align: left; font-weight: bold; font-size: 13px;">Item Description</th>
                            <th style="padding: 15px 8px; text-align: center; font-weight: bold; font-size: 13px;">Pack Size</th>
                            <th style="padding: 15px 8px; text-align: center; font-weight: bold; font-size: 13px;">Quantity</th>
                            <th style="padding: 15px 8px; text-align: center; font-weight: bold; font-size: 13px;">Total Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${itemsHTML}
                        </tbody>
                        <tfoot>
                          <tr style="background-color: #f8f9fa; border-top: 2px solid #e67e22;">
                            <td colspan="4" style="padding: 20px 15px; text-align: right; color: #2c3e50; font-size: 16px; font-weight: bold;">Grand Total:</td>
                            <td style="padding: 20px 15px; text-align: center; color: #e74c3c; font-size: 18px; font-weight: bold; background-color: #fff3cd;">${totalQuantity} Kg</td>
                          </tr>
                        </tfoot>
                      </table>
                    </td>
                  </tr>
                </table>

                ${deliveryInfo}
                ${remarksSection}

                <!-- Action Required Section -->
                <table style="width: 100%; margin-bottom: 25px; background-color: #fff3cd; border: 2px solid #e67e22; border-radius: 8px;">
                  <tr>
                    <td style="padding: 30px; text-align: center;">
                      <h3 style="color: #2c3e50; margin: 0 0 15px 0; font-size: 22px; font-weight: bold;">Confirmation Required</h3>
                      <p style="margin: 0 0 20px 0; font-size: 16px; color: #2c3e50; line-height: 1.6;">
                        Please acknowledge receipt of this purchase order and provide your delivery schedule. Your prompt response ensures smooth order processing.
                      </p>
                      <div style="background-color: #e67e22; color: #ffffff; padding: 12px 25px; border-radius: 25px; display: inline-block; font-weight: bold; font-size: 14px; text-transform: uppercase;">
                        Response Expected Within 24 Hours
                      </div>
                    </td>
                  </tr>
                </table>

                <!-- Contact Information -->
                <table style="width: 100%; background-color: #e9ecef; border: 1px solid #ced4da; border-radius: 8px;">
                  <tr>
                    <td style="padding: 25px; text-align: center;">
                      <div style="color: #2c3e50; font-weight: bold; font-size: 18px; margin-bottom: 15px;">Contact Information</div>
                      <div style="color: #495057; font-size: 15px; line-height: 1.8;">
                        <strong style="color: #2c3e50;">Email:</strong> <a href="mailto:hemanttraders111@yahoo.in" style="color: #e67e22; text-decoration: none; font-weight: bold;">hemanttraders111@yahoo.in</a><br>
                        <strong style="color: #2c3e50;">Address:</strong> 1281, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030<br>
                        ${contactPerson ? `<strong style="color: #2c3e50;">Contact Person:</strong> ${contactPerson}<br>` : ''}
                        ${phoneNumber ? `<strong style="color: #2c3e50;">Phone:</strong> ${phoneNumber}` : ''}
                      </div>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="background-color: #2c3e50; color: #ffffff; padding: 25px; text-align: center;">
                <div style="margin-bottom: 15px;">
                  <div style="font-weight: bold; font-size: 20px; margin-bottom: 5px;">Hemant Traders</div>
                  <div style="opacity: 0.8; font-size: 14px;">1281, Shop No.5, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030.</div>
                </div>
                <div style="opacity: 0.7; font-size: 12px; line-height: 1.5;">
                  © ${new Date().getFullYear()} Hemant Traders. All rights reserved.<br>
                  This is an automated business communication. Please respond via the provided contact details.
                </div>
              </td>
            </tr>

          </table>
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