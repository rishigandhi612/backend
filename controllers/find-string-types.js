const mongoose = require("mongoose");
require("dotenv").config();

const findStringTypes = async () => {
  try {
    const mongoURI = process.env.MONGODB_URI; // Get MongoDB URI from the environment variable

    await mongoose.connect(mongoURI);

    console.log("Connected to MongoDB\n");

    const collection = mongoose.connection.db.collection("invoices");

    // Find invoices with string types in main fields
    const invoicesWithStringTypes = await collection
      .aggregate([
        {
          $project: {
            invoiceNumber: 1,
            createdAt: 1,
            grandTotal: 1,
            cgst: 1,
            sgst: 1,
            igst: 1,
            totalAmount: 1,
            otherCharges: 1,
            grandTotalType: { $type: "$grandTotal" },
            cgstType: { $type: "$cgst" },
            sgstType: { $type: "$sgst" },
            igstType: { $type: "$igst" },
            totalAmountType: { $type: "$totalAmount" },
            otherChargesType: { $type: "$otherCharges" },
          },
        },
        {
          $match: {
            $or: [
              { grandTotalType: "string" },
              { cgstType: "string" },
              { sgstType: "string" },
              { igstType: "string" },
              { totalAmountType: "string" },
              { otherChargesType: "string" },
            ],
          },
        },
      ])
      .toArray();

    console.log(
      `Found ${invoicesWithStringTypes.length} invoices with string type fields:\n`
    );

    invoicesWithStringTypes.forEach((inv, idx) => {
      console.log(`${idx + 1}. Invoice: ${inv.invoiceNumber}`);
      console.log(`   Date: ${inv.createdAt}`);
      if (inv.grandTotalType === "string")
        console.log(`   ❌ grandTotal is string: "${inv.grandTotal}"`);
      if (inv.cgstType === "string")
        console.log(`   ❌ cgst is string: "${inv.cgst}"`);
      if (inv.sgstType === "string")
        console.log(`   ❌ sgst is string: "${inv.sgst}"`);
      if (inv.igstType === "string")
        console.log(`   ❌ igst is string: "${inv.igst}"`);
      if (inv.totalAmountType === "string")
        console.log(`   ❌ totalAmount is string: "${inv.totalAmount}"`);
      if (inv.otherChargesType === "string")
        console.log(`   ❌ otherCharges is string: "${inv.otherCharges}"`);
      console.log("");
    });

    // Check for string types in products array
    console.log("\n=== Checking Products Array ===\n");

    const invoices = await collection.find({}).limit(100).toArray();
    let productsWithStrings = [];

    invoices.forEach((inv) => {
      if (inv.products && inv.products.length > 0) {
        inv.products.forEach((prod, idx) => {
          if (
            typeof prod.quantity === "string" ||
            typeof prod.unit_price === "string" ||
            typeof prod.total_price === "string" ||
            typeof prod.width === "string"
          ) {
            productsWithStrings.push({
              invoiceNumber: inv.invoiceNumber,
              productIndex: idx,
              productName: prod.name,
              issues: {
                quantity:
                  typeof prod.quantity === "string"
                    ? `"${prod.quantity}"`
                    : null,
                unit_price:
                  typeof prod.unit_price === "string"
                    ? `"${prod.unit_price}"`
                    : null,
                total_price:
                  typeof prod.total_price === "string"
                    ? `"${prod.total_price}"`
                    : null,
                width:
                  typeof prod.width === "string" ? `"${prod.width}"` : null,
              },
            });
          }
        });
      }
    });

    console.log(
      `Found ${productsWithStrings.length} products with string types:\n`
    );

    productsWithStrings.slice(0, 10).forEach((item, idx) => {
      console.log(
        `${idx + 1}. Invoice: ${item.invoiceNumber}, Product: ${
          item.productName
        }`
      );
      if (item.issues.quantity)
        console.log(`   ❌ quantity: ${item.issues.quantity}`);
      if (item.issues.unit_price)
        console.log(`   ❌ unit_price: ${item.issues.unit_price}`);
      if (item.issues.total_price)
        console.log(`   ❌ total_price: ${item.issues.total_price}`);
      if (item.issues.width) console.log(`   ❌ width: ${item.issues.width}`);
      console.log("");
    });

    console.log("\n=== Summary ===");
    console.log(
      `Invoices with string fields: ${invoicesWithStringTypes.length}`
    );
    console.log(`Products with string fields: ${productsWithStrings.length}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

const testPipeline = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB\n");

    const CustomerProduct = require("../models/cust-prod.models"); // Adjust path

    const year = 2025; // or current year
    const startDate = new Date(`${year}-04-01`);
    const endDate = new Date(`${year}-12-31`);

    console.log("Testing Step 1: Basic match and addFields...");

    // Test Step 1
    const step1 = await CustomerProduct.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $addFields: {
          month: { $month: "$createdAt" },
        },
      },
      { $limit: 1 },
    ]);

    console.log("✅ Step 1 passed");
    console.log("Sample invoice:", JSON.stringify(step1[0], null, 2));

    console.log("\nTesting Step 2: Adding invoiceQuantity calculation...");

    // Test Step 2 - This is likely where it fails
    try {
      const step2 = await CustomerProduct.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $addFields: {
            month: { $month: "$createdAt" },
          },
        },
        {
          $addFields: {
            invoiceQuantity: {
              $reduce: {
                input: "$products",
                initialValue: 0,
                in: { $add: ["$$value", "$$this.quantity"] },
              },
            },
          },
        },
        { $limit: 1 },
      ]);

      console.log("✅ Step 2 passed");
      console.log("Invoice with quantity:", step2[0].invoiceQuantity);
    } catch (error) {
      console.log("❌ Step 2 FAILED - This is where the error occurs!");
      console.log("Error:", error.message);

      // Check products array structure
      console.log("\nChecking products array structure...");
      const sample = await CustomerProduct.findOne({
        createdAt: { $gte: startDate, $lte: endDate },
      }).lean();

      if (sample && sample.products) {
        console.log("\nProducts array sample:");
        console.log(JSON.stringify(sample.products.slice(0, 2), null, 2));

        console.log("\nProduct field types:");
        sample.products.slice(0, 2).forEach((p, i) => {
          console.log(`Product ${i}:`);
          console.log(`  quantity: ${p.quantity} (${typeof p.quantity})`);
          console.log(`  unit_price: ${p.unit_price} (${typeof p.unit_price})`);
          console.log(
            `  total_price: ${p.total_price} (${typeof p.total_price})`
          );
        });
      }
    }

    console.log("\nTesting Step 3: Group stage...");

    try {
      const step3 = await CustomerProduct.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $addFields: {
            month: { $month: "$createdAt" },
          },
        },
        {
          $group: {
            _id: "$month",
            totalRevenue: { $sum: "$grandTotal" },
            totalAmount: { $sum: "$totalAmount" },
            totalCGST: { $sum: "$cgst" },
            totalSGST: { $sum: "$sgst" },
            totalIGST: { $sum: "$igst" },
          },
        },
        { $limit: 1 },
      ]);

      console.log("✅ Step 3 passed");
      console.log("Group result:", step3[0]);
    } catch (error) {
      console.log("❌ Step 3 FAILED!");
      console.log("Error:", error.message);
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

const findAllStrings = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("Connected to MongoDB\n");

    const collection = mongoose.connection.db.collection("invoice");

    // Count total invoices
    const total = await collection.countDocuments();
    console.log(`Total invoices: ${total}\n`);

    // Use aggregation to find ALL invoices with string types
    console.log("Searching for invoices with string types in tax fields...\n");

    const invoicesWithStringTax = await collection
      .aggregate([
        {
          $project: {
            invoiceNumber: 1,
            createdAt: 1,
            cgst: 1,
            sgst: 1,
            igst: 1,
            cgstType: { $type: "$cgst" },
            sgstType: { $type: "$sgst" },
            igstType: { $type: "$igst" },
          },
        },
        {
          $match: {
            $or: [
              { cgstType: "string" },
              { sgstType: "string" },
              { igstType: "string" },
            ],
          },
        },
      ])
      .toArray();

    console.log(
      `Found ${invoicesWithStringTax.length} invoices with string tax fields\n`
    );

    if (invoicesWithStringTax.length > 0) {
      console.log("Sample invoices with string types:");
      invoicesWithStringTax.slice(0, 10).forEach((inv, idx) => {
        console.log(`\n${idx + 1}. Invoice: ${inv.invoiceNumber}`);
        console.log(`   Date: ${inv.createdAt}`);
        if (inv.cgstType === "string")
          console.log(`   ❌ cgst: "${inv.cgst}" (string)`);
        if (inv.sgstType === "string")
          console.log(`   ❌ sgst: "${inv.sgst}" (string)`);
        if (inv.igstType === "string")
          console.log(`   ❌ igst: "${inv.igst}" (string)`);
      });
    }

    // Check for the specific date range causing the error
    const year = new Date().getFullYear();
    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    console.log(`\n\nChecking date range: ${year}-01-01 to ${year}-12-31\n`);

    const invoicesInRange = await collection
      .aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $project: {
            invoiceNumber: 1,
            createdAt: 1,
            cgst: 1,
            sgst: 1,
            igst: 1,
            cgstType: { $type: "$cgst" },
            sgstType: { $type: "$sgst" },
            igstType: { $type: "$igst" },
          },
        },
        {
          $match: {
            $or: [
              { cgstType: "string" },
              { sgstType: "string" },
              { igstType: "string" },
            ],
          },
        },
      ])
      .toArray();

    console.log(
      `Found ${invoicesInRange.length} invoices with strings in ${year}\n`
    );

    if (invoicesInRange.length > 0) {
      console.log("These invoices will cause the aggregation to fail:");
      invoicesInRange.forEach((inv, idx) => {
        console.log(`\n${idx + 1}. ${inv.invoiceNumber} (${inv.createdAt})`);
        if (inv.cgstType === "string") console.log(`   cgst: "${inv.cgst}"`);
        if (inv.sgstType === "string") console.log(`   sgst: "${inv.sgst}"`);
        if (inv.igstType === "string") console.log(`   igst: "${inv.igst}"`);
      });
    }

    // Check for null or missing values
    console.log("\n\nChecking for null/missing/NaN values...\n");

    const problematicValues = await collection
      .find({
        createdAt: { $gte: startDate, $lte: endDate },
        $or: [
          { cgst: null },
          { sgst: null },
          { igst: null },
          { cgst: { $exists: false } },
          { sgst: { $exists: false } },
          { igst: { $exists: false } },
        ],
      })
      .limit(10)
      .toArray();

    if (problematicValues.length > 0) {
      console.log(
        `Found ${problematicValues.length} invoices with null/missing tax values:`
      );
      problematicValues.forEach((inv) => {
        console.log(
          `  ${inv.invoiceNumber}: cgst=${inv.cgst}, sgst=${inv.sgst}, igst=${inv.igst}`
        );
      });
    }

    await mongoose.disconnect();
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
};

module.exports = {
  findStringTypes,
  testPipeline,
  findAllStrings,
};
