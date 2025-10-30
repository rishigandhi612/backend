const Counter = require("../models/counter.models"); // Adjust path as needed
const { jsPDF } = require("jspdf");
const autoTable = require("jspdf-autotable").default; // Import function
require("dotenv").config();

const { sendEmailWithAttachment } = require("../services/brevoEmail.service");
// Function to get next PO number (automatic)
const getNextPONumber = async () => {
  try {
    const counter = await Counter.findOneAndUpdate(
      { name: "purchase_order" },
      { $inc: { value: 1 } },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    // Format PO number with prefix and padding
    const poNumber = `PO-${String(counter.value).padStart(6, "0")}`;
    return poNumber;
  } catch (error) {
    console.error("Error generating PO number:", error);
    throw new Error("Failed to generate PO number");
  }
};

// Generate Purchase Order PDF (Invoice Theme) - FIXED VERSION
async function generatePDF(orderData) {
  return new Promise((resolve, reject) => {
    try {
      // Add logging to debug the data structure
      console.log(
        "PDF Generation - Order Data:",
        JSON.stringify(orderData, null, 2)
      );
      console.log("Items:", orderData.items);

      const doc = new jsPDF();

      // const logoPath = path.resolve(__dirname, "../assets/HoloLogo.png");
      const poNumber = orderData.poNumber || "PO-0001";
      const currentDate =
        orderData.currentDate || new Date().toLocaleDateString("en-IN");

      // ---------- HEADER ----------
      // doc.addImage(logoPath, "PNG", 10, 8, 25, 25);

      doc.setFontSize(28);
      doc.setFont("helvetica", "bold");
      doc.text("HEMANT TRADERS", 105, 20, { align: "center" });

      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      doc.text("1281, Sadashiv Peth, Vertex Arcade, Pune - 411030", 105, 26, {
        align: "center",
      });
      doc.text(
        "Contact: (+91) 9422080922 / 9420699675    Web: hemanttraders.vercel.app",
        105,
        32,
        { align: "center" }
      );

      doc.setLineWidth(0.5);
      doc.line(0, 36, 210, 36);

      doc.setFont("helvetica", "italic");
      doc.text("Dealers in BOPP, POLYESTER, PVC, THERMAL Films", 105, 42, {
        align: "center",
      });
      doc.text(
        "Adhesives for Lamination, Bookbinding, and Pasting, UV Coats",
        105,
        48,
        { align: "center" }
      );

      doc.line(0, 51, 210, 51);

      // Title Line
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text(`PURCHASE ORDER #${poNumber}`, 14, 60);
      doc.setFont("helvetica", "normal");
      doc.text(`Date: ${currentDate}`, 200, 60, { align: "right" });

      // ---------- SUPPLIER DETAILS ----------
      let yPos = 75;
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Supplier:", 14, yPos);

      doc.setFont("helvetica", "normal");
      yPos += 6;

      // Debug logging for supplier name
      console.log("Supplier Name:", orderData.supplierName);
      const supplierName = orderData.supplierName || "Supplier Name";
      doc.text(supplierName, 14, yPos);
      yPos += 5;

      // Add delivery information if available
      console.log("Delivery Type:", orderData.deliveryType);
      if (orderData.deliveryType) {
        doc.text(`Delivery Type: ${orderData.deliveryType}`, 14, yPos);
        yPos += 5;
      }
      if (orderData.thirdPartyCustomer) {
        doc.text(
          `Third Party Customer: ${orderData.thirdPartyCustomer}`,
          14,
          yPos
        );
        yPos += 5;
      }
      if (orderData.contactPerson) {
        doc.text(`Contact: ${orderData.contactPerson}`, 14, yPos);
        yPos += 5;
      }
      if (orderData.phoneNumber) {
        doc.text(`Phone: ${orderData.phoneNumber}`, 14, yPos);
        yPos += 5;
      }
      if (orderData.expectedDeliveryDate) {
        doc.text(
          `Expected Delivery: ${orderData.expectedDeliveryDate}`,
          14,
          yPos
        );
        yPos += 5;
      }

      // ---------- TABLE ----------
      yPos += 10;
      const tableColumns = [
        "Sr.",
        "Item Name",
        "Pack Size",
        "Units",
        "Qty",
        // "Rate",
        // "Amount",
      ];
      const tableRows = [];

      // let totalAmount = 0;

      console.log("Processing items for PDF:", orderData.items);

      orderData.items.forEach((item, index) => {
        console.log(`Item ${index + 1}:`, item);

        // Handle your actual data structure
        const quantity = item.totalQty || item.quantity || item.qty || 0;
        // const rate = item.rate || item.price || 0; // You're missing rate in your data
        // const amount = quantity * rate;
        // totalAmount += amount;

        // Use 'name' field which is what your frontend sends
        const itemName =
          item.name ||
          item.itemName ||
          item.description ||
          item.product ||
          "N/A";
        const packSize = item.packSize;
        const units = item.nos || "N/A";
        // console.log(
        //   `Processed - Name: ${itemName}, Qty: ${quantity}, Rate: ${rate}, Amount: ${amount}`
        // );

        tableRows.push([
          index + 1,
          itemName,
          packSize,
          units,
          quantity,
          // rate > 0 ? rate.toFixed(2) : "TBD", // Show "TBD" if no rate
          // amount > 0 ? amount.toFixed(2) : "TBD", // Show "TBD" if no amount
        ]);
      });

      // Summary Row - only show total if we have rates
      // if (totalAmount > 0) {
      //   tableRows.push(["", "", "", "", "Total", totalAmount.toFixed(2)]);
      // } else {
      //   tableRows.push(["", "", "", "", "Total", "TBD"]);
      // }

      autoTable(doc, {
        head: [["Sr.", "Item Name", "Pack Size", "Units", "Quantity"]],
        body: tableRows,
        startY: yPos,
        theme: "grid",

        // Base styles
        styles: {
          font: "helvetica",
          fontSize: 9,
          cellPadding: 4,
          lineWidth: 0.1,
          lineColor: [220, 220, 220], // subtle grid lines
          valign: "middle",
        },

        // Header styling
        headStyles: {
          fillColor: [30, 45, 70], // deep navy
          textColor: [255, 255, 255],
          fontSize: 11,
          fontStyle: "bold",
          halign: "center",
          valign: "middle",
        },

        // Body styling
        bodyStyles: {
          textColor: [40, 40, 40],
          fontSize: 9,
        },

        // Alternate rows
        alternateRowStyles: {
          fillColor: [248, 248, 248], // very light gray for zebra
        },

        // Column alignment
        columnStyles: {
          0: { halign: "center", cellWidth: 20 }, // Sr.
          1: { halign: "center", cellWidth: 60 }, // Item Name
          2: { halign: "center", cellWidth: 30 }, // Pack Size
          3: { halign: "center", cellWidth: 35 }, // Units
          4: { halign: "center", cellWidth: 35 }, // Quantity
        },

        // Special styling for last row (totals)
        didParseCell: function (data) {
          if (
            data.row.section === "body" &&
            data.row.index === tableRows.length - 1
          ) {
            data.cell.styles.fillColor = [230, 235, 240]; // steel gray background
            data.cell.styles.fontStyle = "bold";
            data.cell.styles.textColor = [20, 20, 20];
          }
        },
      });

      let finalY = doc.lastAutoTable.finalY + 10;

      // ---------- REMARKS ----------
      if (orderData.remarks) {
        doc.setFont("helvetica", "bold");
        doc.text("Remarks:", 14, finalY);
        doc.setFont("helvetica", "normal");
        doc.setFillColor(240, 240, 240);
        doc.rect(14, finalY + 2, 182, 10, "F");
        doc.text(orderData.remarks, 16, finalY + 9);
        finalY += 20;
      }

      // ---------- FOOTER ----------
      doc.setLineWidth(0.5);
      doc.line(0, 277, 210, 277);

      doc.setFont("helvetica", "normal");
      doc.text(
        "This is a computer-generated document and does not require a physical signature.",
        14,
        289
      );

      doc.setFont("helvetica", "bold");
      doc.text(`GSTIN: ${orderData.gstNumber || "27AAVPG7824M1ZX"}`, 14, 284);

      const pdfBuffer = Buffer.from(doc.output("arraybuffer"));
      resolve(pdfBuffer);
    } catch (err) {
      reject(err);
    }
  });
}

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
    let companyName = req.body.companyName || "HEMANT TRADERS";
    let gstNumber = req.body.gstNumber || "27AAVPG7824M1ZX";

    // Debug the incoming request
    console.log("=== DEBUG: Incoming Request Body ===");
    console.log("Full request body:", JSON.stringify(req.body, null, 2));
    console.log("Email:", email);
    console.log("Supplier Name:", supplierName);
    console.log("Items:", JSON.stringify(items, null, 2));
    console.log("Order Date:", orderDate);
    console.log("Delivery Type:", deliveryType);
    console.log("Expected Delivery Date:", expectedDeliveryDate);
    console.log("Remarks:", remarks);
    console.log("=======================");

    // Validate required fields
    if (
      !email ||
      !supplierName ||
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      return res.status(400).json({
        message: "Missing required fields: email, supplierName, items",
        receivedData: {
          email: !!email,
          supplierName: !!supplierName,
          items: items
            ? `Array with ${items.length} items`
            : "Missing or not array",
        },
      });
    }

    // More flexible item validation
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      console.log(`Validating item ${i + 1}:`, item);
    }

    // Always generate PO number automatically
    const poNumber = await getNextPONumber();

    // Calculate totals with better field handling
    const totalItems = items.length;
    const totalQuantity = items.reduce((sum, item) => {
      const qty = item.totalQty || item.quantity || item.qty || 0;
      console.log(`Item quantity: ${qty}`);
      return sum + qty;
    }, 0);

    console.log(
      "Calculated totals - Items:",
      totalItems,
      "Total Quantity:",
      totalQuantity
    );

    const currentDate = orderDate || new Date().toLocaleDateString("en-IN");

    // Prepare data for PDF generation
    const orderData = {
      poNumber,
      supplierName,
      items,
      currentDate,
      expectedDeliveryDate,
      deliveryType,
      thirdPartyCustomer,
      contactPerson,
      phoneNumber,
      remarks,
      companyName,
      gstNumber,
      totalItems,
      totalQuantity,
    };

    // Add detailed logging before PDF generation
    console.log("=== DEBUG: Order Data for PDF ===");
    console.log("PO Number:", poNumber);
    console.log("Supplier Name:", supplierName);
    console.log("Items Count:", items ? items.length : 0);
    console.log("Items:", JSON.stringify(items, null, 2));
    console.log("Current Date:", currentDate);
    console.log("Delivery Type:", deliveryType);
    console.log("Contact Person:", contactPerson);
    console.log("Phone Number:", phoneNumber);
    console.log("Remarks:", remarks);
    console.log("=======================");

    // Generate PDF
    const pdfBuffer = await generatePDF(orderData);
    const pdfBase64 = Buffer.from(pdfBuffer).toString("base64");

    // Prepare email subject and HTML content
    const subject = `Purchase Order - ${poNumber} | Hemant Traders`;

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Purchase Order - ${poNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 20px; background-color: #f4f4f4;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
          
          <!-- Header -->
          <div style="background-color: #e67e22; color: #ffffff; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 28px;">Purchase Order</h1>
            <div style="margin: 15px 0; background-color: #2c3e50; padding: 8px 20px; border-radius: 20px; display: inline-block;">
              <strong>${poNumber}</strong>
            </div>
          </div>

          <!-- Content -->
          <div style="padding: 30px;">
            <h2 style="color: #2c3e50; margin-bottom: 20px;">Dear ${supplierName},</h2>
            
            <p style="margin-bottom: 20px; font-size: 16px;">
              Greetings from Hemant Traders! Please find our purchase order attached as a PDF document.
            </p>

            <div style="background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
              <h3 style="color: #2c3e50; margin-bottom: 15px;">Order Summary:</h3>
              <ul style="list-style: none; padding: 0; margin: 0;">
                <li style="margin-bottom: 8px;"><strong>PO Number:</strong> ${poNumber}</li>
                <li style="margin-bottom: 8px;"><strong>Order Date:</strong> ${currentDate}</li>
                <li style="margin-bottom: 8px;"><strong>Total Items:</strong> ${totalItems}</li>
                <li style="margin-bottom: 8px;"><strong>Total Quantity:</strong> ${totalQuantity}</li>
                ${
                  expectedDeliveryDate
                    ? `<li style="margin-bottom: 8px;"><strong>Expected Delivery:</strong> ${expectedDeliveryDate}</li>`
                    : ""
                }
              </ul>
            </div>

            <div style="background-color: #fff3cd; border: 1px solid #ffeaa7; border-radius: 8px; padding: 20px; text-align: center;">
              <h3 style="color: #2c3e50; margin-bottom: 15px;">Action Required</h3>
              <p style="margin: 0; color: #2c3e50;">
                Please review the attached purchase order and confirm receipt along with your delivery timeline within 24 hours.
              </p>
            </div>
          </div>

          <!-- Footer -->
          <div style="background-color: #2c3e50; color: #ffffff; padding: 25px; text-align: center;">
            <div style="margin-bottom: 15px;">
              <strong style="font-size: 18px;">Hemant Traders</strong><br>
              <span style="opacity: 0.8;">1281, Vertex Arcade, Sadashiv Peth, Pune, Maharashtra 411030</span>
            </div>
            <div style="opacity: 0.7; font-size: 14px;">
              Email: hemanttraders111@yahoo.in<br>
              ${contactPerson ? `Contact: ${contactPerson}<br>` : ""}
              ${phoneNumber ? `Phone: ${phoneNumber}` : ""}
            </div>
          </div>

        </div>
      </body>
      </html>
    `;

    // Prepare attachment
    const attachments = [
      {
        content: pdfBase64,
        name: `PurchaseOrder_${poNumber}.pdf`,
        contentType: "application/pdf",
      },
    ];

    // Use your existing email service
    await sendEmailWithAttachment(email, subject, htmlContent, attachments);

    res.status(200).json({
      success: true,
      message: "Purchase order sent successfully with PDF attachment!",
      poNumber: poNumber,
      totalItems: totalItems,
      totalQuantity: totalQuantity,
    });
  } catch (error) {
    console.error("Error:", error);

    // Handle specific Brevo errors
    if (error.response) {
      console.error("Brevo Response Error:", error.response.text);
      return res.status(400).json({
        success: false,
        message: "Email service error",
        error: error.response.text || "Invalid email configuration",
      });
    }

    res.status(500).json({
      success: false,
      message: "Failed to send purchase order",
      error: error.message,
    });
  }
};

// Optional: Function to get current counter value
const getCurrentPONumber = async (req, res) => {
  try {
    const counter = await Counter.findOne({ name: "purchase_order" });
    const currentValue = counter ? counter.value : 0;
    const nextPONumber = `PO-${String(currentValue + 1).padStart(6, "0")}`;

    res.status(200).json({
      success: true,
      currentValue,
      nextPONumber,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to get PO number",
      error: error.message,
    });
  }
};

// Optional: Function to reset counter (for admin use)
const resetPOCounter = async (req, res) => {
  try {
    const { startValue = 0 } = req.body;

    await Counter.findOneAndUpdate(
      { name: "purchase_order" },
      { value: startValue },
      { upsert: true }
    );

    res.status(200).json({
      success: true,
      message: `PO counter reset to ${startValue}`,
      value: startValue,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to reset PO counter",
      error: error.message,
    });
  }
};

// Debug function to test PDF generation without sending email
const testPDFGeneration = async (req, res) => {
  try {
    console.log("=== TEST PDF GENERATION ===");
    console.log("Request body:", JSON.stringify(req.body, null, 2));

    const testData = {
      poNumber: "PO-TEST001",
      supplierName: req.body.supplierName || "Test Supplier",
      items: req.body.items || [
        {
          itemName: "Test Item 1",
          totalQty: 10,
          rate: 100,
          packSize: "1234",
        },
        {
          itemName: "Test Item 2",
          totalQty: 5,
          rate: 200,
          packSize: "5678",
        },
      ],
      currentDate: new Date().toLocaleDateString("en-IN"),
      expectedDeliveryDate: req.body.expectedDeliveryDate,
      deliveryType: req.body.deliveryType,
      thirdPartyCustomer: req.body.thirdPartyCustomer,
      contactPerson: req.body.contactPerson,
      phoneNumber: req.body.phoneNumber,
      remarks: req.body.remarks || "Test remarks",
      companyName: "HEMANT TRADERS",
      gstNumber: "27AAVPG7824M1ZX",
    };

    console.log("Test data for PDF:", JSON.stringify(testData, null, 2));

    const pdfBuffer = await generatePDF(testData);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=test-po.pdf");
    res.send(pdfBuffer);
  } catch (error) {
    console.error("Test PDF generation error:", error);
    res.status(500).json({
      success: false,
      message: "Test PDF generation failed",
      error: error.message,
    });
  }
};

module.exports = {
  sendOrderEmail,
  getCurrentPONumber,
  resetPOCounter,
  testPDFGeneration, // Add this for testing
};
