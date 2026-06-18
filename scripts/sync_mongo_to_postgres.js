#!/usr/bin/env node
/**
 * scripts/sync_mongo_to_postgres.js
 *
 * Compare MongoDB invoices (CustomerProduct) with PostgreSQL bills and upsert
 * Postgres records so that Mongo is the source of truth.
 *
 * Usage: NODE_ENV=production node scripts/sync_mongo_to_postgres.js
 */

const mongoose = require("mongoose");
const CustomerProduct = require("../models/cust-prod.models");
const { syncInvoiceToBill } = require("../services/billSync.service");
const dotenv = require("dotenv");

dotenv.config();

async function main() {
  console.log("Starting Mongo → Postgres sync...");

  // Ensure Mongoose connection (models expect a mongoose connection elsewhere in app)
  const mongoUri =
    process.env.MONGODB_URI ||
    process.env.MONGO_URL ||
    "mongodb://localhost:27017/hub";

  await mongoose.connect(mongoUri);

  try {
    const total = await CustomerProduct.countDocuments();
    console.log(`Found ${total} invoices in MongoDB`);

    const cursor = CustomerProduct.find().cursor();

    let processed = 0;
    let createdOrUpdated = 0;
    let errors = 0;

    for (
      let doc = await cursor.next();
      doc != null;
      doc = await cursor.next()
    ) {
      processed += 1;
      try {
        await syncInvoiceToBill(doc);
        createdOrUpdated += 1;
        if (processed % 100 === 0) {
          console.log(`Processed ${processed}/${total}...`);
        }
      } catch (err) {
        errors += 1;
        console.error(
          `Failed to sync invoice ${doc.invoiceNumber}:`,
          err.message,
        );
      }
    }

    console.log(
      `Sync complete. Processed: ${processed}, Upserted: ${createdOrUpdated}, Errors: ${errors}`,
    );
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Sync failed:", err);
  process.exit(1);
});
