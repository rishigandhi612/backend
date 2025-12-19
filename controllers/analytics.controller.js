// analytics.controller.js
// Comprehensive Analytics Controller for Sales Data

const CustomerProduct = require("../models/cust-prod.models");
const Product = require("../models/product.models");
const Customer = require("../models/customer.models");
const mongoose = require("mongoose");

/**
 * Get quantity sold by width with filters
 * Supports filtering by date range, product, customer, and grouping options
 */
const getQuantitySoldByWidth = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      productId,
      customerId,
      groupBy = "month", // month, quarter, year, week
      widthRange, // e.g., "100-200" or specific width
      sortBy = "quantity", // quantity, width, revenue
      sortOrder = "desc",
      limit,
    } = req.query;

    // Build match stage
    const matchStage = {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    if (customerId) {
      matchStage.customer = mongoose.Types.ObjectId(customerId);
    }

    // Build aggregation pipeline
    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    // Add product filter after unwind
    if (productId) {
      pipeline.push({
        $match: { "products.product": mongoose.Types.ObjectId(productId) },
      });
    }

    // Add width range filter
    if (widthRange) {
      if (widthRange.includes("-")) {
        const [min, max] = widthRange.split("-").map(Number);
        pipeline.push({
          $match: {
            "products.width": { $gte: min, $lte: max },
          },
        });
      } else {
        pipeline.push({
          $match: { "products.width": parseFloat(widthRange) },
        });
      }
    }

    // Define grouping based on time period
    let timeGrouping = {};
    if (groupBy === "month") {
      timeGrouping = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
      };
    } else if (groupBy === "quarter") {
      timeGrouping = {
        year: { $year: "$createdAt" },
        quarter: { $ceil: { $divide: [{ $month: "$createdAt" }, 3] } },
      };
    } else if (groupBy === "week") {
      timeGrouping = {
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" },
      };
    } else if (groupBy === "year") {
      timeGrouping = {
        year: { $year: "$createdAt" },
      };
    }

    // Group by width and time period
    pipeline.push({
      $group: {
        _id: {
          width: "$products.width",
          ...timeGrouping,
        },
        totalQuantity: { $sum: "$products.quantity" },
        totalRevenue: { $sum: "$products.total_price" },
        averageUnitPrice: { $avg: "$products.unit_price" },
        invoiceCount: { $sum: 1 },
        productNames: { $addToSet: "$products.name" },
      },
    });

    // Project with formatted output
    pipeline.push({
      $project: {
        _id: 0,
        width: "$_id.width",
        period: {
          $concat: [
            { $toString: "$_id.year" },
            "-",
            {
              $cond: [
                { $lt: ["$_id.month", 10] },
                { $concat: ["0", { $toString: "$_id.month" }] },
                { $toString: "$_id.month" },
              ],
            },
          ],
        },
        totalQuantity: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        averageUnitPrice: { $round: ["$averageUnitPrice", 2] },
        invoiceCount: 1,
        productNames: 1,
      },
    });

    // Sort
    const sortStage = {};
    if (sortBy === "quantity") {
      sortStage.totalQuantity = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "revenue") {
      sortStage.totalRevenue = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "width") {
      sortStage.width = sortOrder === "desc" ? -1 : 1;
    }
    pipeline.push({ $sort: sortStage });

    if (limit && !isNaN(limit)) {
      pipeline.push({ $limit: parseInt(limit) });
    }

    const results = await CustomerProduct.aggregate(pipeline);

    // Calculate summary statistics
    const summary = results.reduce(
      (acc, curr) => {
        acc.totalQuantity += curr.totalQuantity;
        acc.totalRevenue += curr.totalRevenue;
        acc.uniqueWidths.add(curr.width);
        return acc;
      },
      { totalQuantity: 0, totalRevenue: 0, uniqueWidths: new Set() }
    );

    res.json({
      success: true,
      data: results,
      summary: {
        totalQuantity: summary.totalQuantity,
        totalRevenue: Math.round(summary.totalRevenue * 100) / 100,
        uniqueWidths: summary.uniqueWidths.size,
        recordsAnalyzed: results.length,
      },
      filters: {
        startDate,
        endDate,
        productId,
        customerId,
        widthRange,
        groupBy,
        limit,
      },
    });
  } catch (error) {
    console.error("Error in getQuantitySoldByWidth:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get width distribution analytics
 */
const getWidthDistribution = async (req, res) => {
  try {
    const { startDate, endDate, productId } = req.query;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    if (productId) {
      pipeline.push({
        $match: { "products.product": mongoose.Types.ObjectId(productId) },
      });
    }

    pipeline.push({
      $group: {
        _id: "$products.width",
        totalQuantity: { $sum: "$products.quantity" },
        totalRevenue: { $sum: "$products.total_price" },
        averagePrice: { $avg: "$products.unit_price" },
        invoiceCount: { $sum: 1 },
      },
    });

    pipeline.push({
      $project: {
        _id: 0,
        width: "$_id",
        totalQuantity: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        averagePrice: { $round: ["$averagePrice", 2] },
        invoiceCount: 1,
        revenuePerUnit: {
          $cond: [
            { $eq: ["$totalQuantity", 0] },
            0,
            { $round: [{ $divide: ["$totalRevenue", "$totalQuantity"] }, 2] },
          ],
        },
      },
    });

    pipeline.push({ $sort: { totalRevenue: -1 } });

    const results = await CustomerProduct.aggregate(pipeline);

    // Calculate percentages
    const totalRevenue = results.reduce(
      (sum, item) => sum + item.totalRevenue,
      0
    );
    const totalQuantity = results.reduce(
      (sum, item) => sum + item.totalQuantity,
      0
    );

    const enrichedResults = results.map((item) => ({
      ...item,
      revenuePercentage:
        Math.round((item.totalRevenue / totalRevenue) * 100 * 100) / 100,
      quantityPercentage:
        Math.round((item.totalQuantity / totalQuantity) * 100 * 100) / 100,
    }));

    res.json({
      success: true,
      data: enrichedResults,
      summary: {
        totalWidthsAnalyzed: results.length,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalQuantity,
        mostPopularWidth: results[0]?.width,
        highestRevenueWidth: results[0]?.width,
      },
      filters: { startDate, endDate, productId },
    });
  } catch (error) {
    console.error("Error in getWidthDistribution:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get sales trends and forecasting data
 */
const getSalesTrends = async (req, res) => {
  try {
    const { months = 12, productId, groupBy = "month" } = req.query;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - parseInt(months));

    const matchStage = {
      createdAt: { $gte: startDate },
    };

    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    if (productId) {
      pipeline.push({
        $match: { "products.product": mongoose.Types.ObjectId(productId) },
      });
    }

    let timeGrouping = {};
    if (groupBy === "month") {
      timeGrouping = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
      };
    } else if (groupBy === "week") {
      timeGrouping = {
        year: { $year: "$createdAt" },
        week: { $week: "$createdAt" },
      };
    }

    pipeline.push({
      $group: {
        _id: timeGrouping,
        totalRevenue: { $sum: "$products.total_price" },
        totalQuantity: { $sum: "$products.quantity" },
        invoiceCount: { $sum: 1 },
        averageInvoiceValue: { $avg: "$grandTotal" },
      },
    });

    pipeline.push({
      $project: {
        _id: 0,
        period: {
          $concat: [
            { $toString: "$_id.year" },
            "-",
            {
              $cond: [
                { $lt: ["$_id.month", 10] },
                { $concat: ["0", { $toString: "$_id.month" }] },
                { $toString: "$_id.month" },
              ],
            },
          ],
        },
        totalRevenue: { $round: ["$totalRevenue", 2] },
        totalQuantity: 1,
        invoiceCount: 1,
        averageInvoiceValue: { $round: ["$averageInvoiceValue", 2] },
      },
    });

    pipeline.push({ $sort: { period: 1 } });

    const results = await CustomerProduct.aggregate(pipeline);

    // Calculate growth rates
    const trendsWithGrowth = results.map((period, index) => {
      if (index === 0) {
        return { ...period, growthRate: null };
      }

      const prevRevenue = results[index - 1].totalRevenue;
      const growthRate =
        prevRevenue > 0
          ? Math.round(
              ((period.totalRevenue - prevRevenue) / prevRevenue) * 100 * 100
            ) / 100
          : null;

      return { ...period, growthRate };
    });

    // Simple moving average for forecasting
    const movingAverageWindow = 3;
    const recentPeriods = trendsWithGrowth.slice(-movingAverageWindow);
    const averageRevenue =
      recentPeriods.reduce((sum, p) => sum + p.totalRevenue, 0) /
      movingAverageWindow;

    res.json({
      success: true,
      data: trendsWithGrowth,
      forecast: {
        nextPeriodEstimate: Math.round(averageRevenue * 100) / 100,
        basedOnPeriods: movingAverageWindow,
        confidence: "Medium",
      },
      filters: { months, productId, groupBy },
    });
  } catch (error) {
    console.error("Error in getSalesTrends:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get comprehensive analytics dashboard
 */
const getAnalyticsDashboard = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    // Overall metrics
    const overallMetrics = await CustomerProduct.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$grandTotal" },
          totalInvoices: { $sum: 1 },
          averageInvoiceValue: { $avg: "$grandTotal" },
          totalCGST: { $sum: "$cgst" },
          totalSGST: { $sum: "$sgst" },
          totalIGST: { $sum: "$igst" },
        },
      },
    ]);

    // Top 5 products
    const topProducts = await CustomerProduct.aggregate([
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $group: {
          _id: {
            productId: "$products.product",
            productName: "$products.name",
          },
          totalRevenue: { $sum: "$products.total_price" },
          totalQuantity: { $sum: "$products.quantity" },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          productName: "$_id.productName",
          totalRevenue: { $round: ["$totalRevenue", 2] },
          totalQuantity: 1,
        },
      },
    ]);

    // Top 5 customers
    const topCustomers = await CustomerProduct.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$customer",
          totalPurchases: { $sum: "$grandTotal" },
          invoiceCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customerInfo",
        },
      },
      { $unwind: "$customerInfo" },
      { $sort: { totalPurchases: -1 } },
      { $limit: 5 },
      {
        $project: {
          _id: 0,
          customerName: "$customerInfo.name",
          totalPurchases: { $round: ["$totalPurchases", 2] },
          invoiceCount: 1,
        },
      },
    ]);

    // Width distribution
    const widthDistribution = await CustomerProduct.aggregate([
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.width",
          count: { $sum: 1 },
          totalQuantity: { $sum: "$products.quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 10 },
    ]);

    // Monthly trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await CustomerProduct.aggregate([
      {
        $match: {
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          revenue: { $sum: "$grandTotal" },
          invoiceCount: { $sum: 1 },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      {
        $project: {
          _id: 0,
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: [
                  { $lt: ["$_id.month", 10] },
                  { $concat: ["0", { $toString: "$_id.month" }] },
                  { $toString: "$_id.month" },
                ],
              },
            ],
          },
          revenue: { $round: ["$revenue", 2] },
          invoiceCount: 1,
        },
      },
    ]);

    res.json({
      success: true,
      dashboard: {
        overallMetrics: overallMetrics[0]
          ? {
              totalRevenue:
                Math.round(overallMetrics[0].totalRevenue * 100) / 100,
              totalInvoices: overallMetrics[0].totalInvoices,
              averageInvoiceValue:
                Math.round(overallMetrics[0].averageInvoiceValue * 100) / 100,
              totalTax:
                Math.round(
                  (overallMetrics[0].totalCGST +
                    overallMetrics[0].totalSGST +
                    overallMetrics[0].totalIGST) *
                    100
                ) / 100,
            }
          : null,
        topProducts,
        topCustomers,
        widthDistribution,
        monthlyTrend,
      },
      filters: { startDate, endDate },
    });
  } catch (error) {
    console.error("Error in getAnalyticsDashboard:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get total products sold with detailed analytics
 */
const getProductSalesAnalytics = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      productId,
      customerId,
      groupBy = "product", // product, month, customer
      minQuantity,
      maxQuantity,
      sortBy = "quantity",
      sortOrder = "desc",
      limit,
    } = req.query;

    const matchStage = {};

    // Date filtering
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) {
        // Include entire end date by setting to end of day
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = endDateTime;
      }
    }

    // Customer filtering - Fixed deprecated ObjectId usage
    if (customerId) {
      try {
        matchStage.customer = new mongoose.Types.ObjectId(customerId);
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: "Invalid customer ID format",
        });
      }
    }

    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    // Product filtering - Fixed deprecated ObjectId usage
    if (productId) {
      try {
        pipeline.push({
          $match: {
            "products.product": new mongoose.Types.ObjectId(productId),
          },
        });
      } catch (error) {
        return res.status(400).json({
          success: false,
          error: "Invalid product ID format",
        });
      }
    }

    // Add quantity range filter
    if (minQuantity || maxQuantity) {
      const quantityFilter = {};
      if (minQuantity) quantityFilter.$gte = parseInt(minQuantity);
      if (maxQuantity) quantityFilter.$lte = parseInt(maxQuantity);
      pipeline.push({
        $match: { "products.quantity": quantityFilter },
      });
    }

    // Lookup product details
    pipeline.push({
      $lookup: {
        from: "products",
        localField: "products.product",
        foreignField: "_id",
        as: "productDetails",
      },
    });

    pipeline.push({
      $unwind: { path: "$productDetails", preserveNullAndEmptyArrays: true },
    });

    // Lookup customer details (for groupBy customer)
    if (groupBy === "customer") {
      pipeline.push({
        $lookup: {
          from: "customers",
          localField: "customer",
          foreignField: "_id",
          as: "customerDetails",
        },
      });

      pipeline.push({
        $unwind: { path: "$customerDetails", preserveNullAndEmptyArrays: true },
      });
    }

    // Define grouping - Fixed to use lookup data instead of embedded data
    let groupId = {};
    if (groupBy === "product") {
      groupId = {
        productId: "$products.product",
      };
    } else if (groupBy === "month") {
      groupId = {
        year: { $year: "$createdAt" },
        month: { $month: "$createdAt" },
      };
    } else if (groupBy === "customer") {
      groupId = {
        customerId: "$customer",
      };
    }

    // Group and aggregate
    pipeline.push({
      $group: {
        _id: groupId,
        // Always get product/customer name from lookup, not embedded data
        productName: { $first: "$productDetails.name" },
        customerName: { $first: "$customerDetails.name" },
        totalQuantitySold: {
          $sum: { $toDouble: { $ifNull: ["$products.quantity", 0] } },
        },
        totalRevenue: {
          $sum: { $toDouble: { $ifNull: ["$products.total_price", 0] } },
        },
        totalCost: {
          $sum: {
            $multiply: [
              { $toDouble: { $ifNull: ["$products.quantity", 0] } },
              { $toDouble: { $ifNull: ["$productDetails.cost", 0] } },
            ],
          },
        },
        averageSalePrice: {
          $avg: { $toDouble: { $ifNull: ["$products.unit_price", 0] } },
        },
        averageQuantityPerInvoice: {
          $avg: { $toDouble: { $ifNull: ["$products.quantity", 0] } },
        },
        minSalePrice: {
          $min: { $toDouble: { $ifNull: ["$products.unit_price", 0] } },
        },
        maxSalePrice: {
          $max: { $toDouble: { $ifNull: ["$products.unit_price", 0] } },
        },
        invoiceCount: { $sum: 1 },
        uniqueInvoices: { $addToSet: "$_id" },
        uniqueCustomers: { $addToSet: "$customer" },
        widthsSold: { $addToSet: "$products.width" },
      },
    });

    // Calculate profit margin
    pipeline.push({
      $project: {
        _id: 1,
        productName: 1,
        customerName: 1,
        totalQuantitySold: 1,
        totalRevenue: { $round: ["$totalRevenue", 2] },
        totalCost: { $round: ["$totalCost", 2] },
        grossProfit: {
          $round: [{ $subtract: ["$totalRevenue", "$totalCost"] }, 2],
        },
        profitMargin: {
          $cond: [
            { $eq: ["$totalRevenue", 0] },
            0,
            {
              $round: [
                {
                  $multiply: [
                    {
                      $divide: [
                        { $subtract: ["$totalRevenue", "$totalCost"] },
                        "$totalRevenue",
                      ],
                    },
                    100,
                  ],
                },
                2,
              ],
            },
          ],
        },
        averageSalePrice: { $round: ["$averageSalePrice", 2] },
        averageQuantityPerInvoice: {
          $round: ["$averageQuantityPerInvoice", 2],
        },
        minSalePrice: { $round: ["$minSalePrice", 2] },
        maxSalePrice: { $round: ["$maxSalePrice", 2] },
        invoiceCount: 1,
        uniqueInvoiceCount: { $size: "$uniqueInvoices" },
        uniqueCustomerCount: { $size: "$uniqueCustomers" },
        widthsSold: 1,
      },
    });

    // Sort - Fixed empty sort stage bug
    const sortStage = {};
    if (sortBy === "quantity") {
      sortStage.totalQuantitySold = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "revenue") {
      sortStage.totalRevenue = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "profit") {
      sortStage.grossProfit = sortOrder === "desc" ? -1 : 1;
    } else {
      // Default sort by revenue if invalid sortBy provided
      sortStage.totalRevenue = -1;
    }
    pipeline.push({ $sort: sortStage });

    // Apply limit
    if (limit && !isNaN(limit) && parseInt(limit) > 0) {
      pipeline.push({ $limit: parseInt(limit) });
    }

    const results = await CustomerProduct.aggregate(pipeline);

    // Calculate overall summary - Fixed parseInt bug that was losing decimals
    const overallSummary = results.reduce(
      (acc, curr) => {
        acc.totalQuantity += curr.totalQuantitySold;
        acc.totalRevenue += curr.totalRevenue;
        acc.totalProfit += curr.grossProfit || 0;
        acc.totalInvoices += curr.invoiceCount;
        acc.uniqueInvoices.add(curr._id.toString());
        return acc;
      },
      {
        totalQuantity: 0,
        totalRevenue: 0,
        totalProfit: 0,
        totalInvoices: 0,
        uniqueInvoices: new Set(),
      }
    );

    res.json({
      success: true,
      data: results,
      summary: {
        totalQuantitySold: Math.round(overallSummary.totalQuantity * 100) / 100,
        totalRevenue: Math.round(overallSummary.totalRevenue * 100) / 100,
        totalProfit: Math.round(overallSummary.totalProfit * 100) / 100,
        totalInvoices: overallSummary.totalInvoices,
        totalLineItems: overallSummary.totalLineItems,
        totalUniqueInvoices: overallSummary.uniqueInvoices.size,
        averageRevenuePerInvoice:
          overallSummary.totalInvoices > 0
            ? Math.round(
                (overallSummary.totalRevenue / overallSummary.totalInvoices) *
                  100
              ) / 100
            : 0,
        productsAnalyzed: results.length,
      },
      filters: { startDate, endDate, productId, customerId, groupBy },
    });
  } catch (error) {
    console.error("Error in getProductSalesAnalytics:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get average sale cost of products with price trends
 */
const getAverageSaleCost = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      productId,
      includeTimeTrend = "false",
      groupBy = "month", // For time trend analysis
    } = req.query;

    const matchStage = {};

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    if (productId) {
      pipeline.push({
        $match: { "products.product": mongoose.Types.ObjectId(productId) },
      });
    }

    // Main aggregation for average costs
    pipeline.push({
      $group: {
        _id: {
          productId: "$products.product",
          productName: "$products.name",
        },
        averageSalePrice: { $avg: "$products.unit_price" },
        minSalePrice: { $min: "$products.unit_price" },
        maxSalePrice: { $max: "$products.unit_price" },
        totalQuantitySold: { $sum: "$products.quantity" },
        totalRevenue: { $sum: "$products.total_price" },
        standardDeviation: { $stdDevPop: "$products.unit_price" },
        sampleCount: { $sum: 1 },
      },
    });

    pipeline.push({
      $project: {
        _id: 0,
        productId: "$_id.productId",
        productName: "$_id.productName",
        averageSalePrice: {
          $round: [{ $ifNull: ["$averageSalePrice", 0] }, 2],
        },
        minSalePrice: { $round: [{ $ifNull: ["$minSalePrice", 0] }, 2] },
        maxSalePrice: { $round: [{ $ifNull: ["$maxSalePrice", 0] }, 2] },
        priceRange: {
          $round: [
            {
              $subtract: [
                { $ifNull: ["$maxSalePrice", 0] },
                { $ifNull: ["$minSalePrice", 0] },
              ],
            },
            2,
          ],
        },
        priceVolatility: {
          $round: [{ $ifNull: ["$standardDeviation", 0] }, 2],
        },
        totalQuantitySold: 1,
        totalRevenue: { $round: [{ $ifNull: ["$totalRevenue", 0] }, 2] },
        sampleCount: 1,
        confidenceLevel: {
          $cond: [
            { $gte: ["$sampleCount", 30] },
            "High",
            { $cond: [{ $gte: ["$sampleCount", 10] }, "Medium", "Low"] },
          ],
        },
      },
    });

    pipeline.push({ $sort: { totalRevenue: -1 } });

    const results = await CustomerProduct.aggregate(pipeline);

    // Time trend analysis if requested
    let timeTrend = null;
    if (includeTimeTrend === "true") {
      const trendPipeline = [{ $match: matchStage }, { $unwind: "$products" }];

      if (productId) {
        trendPipeline.push({
          $match: { "products.product": mongoose.Types.ObjectId(productId) },
        });
      }

      let timeGrouping = {};
      if (groupBy === "month") {
        timeGrouping = {
          year: { $year: "$createdAt" },
          month: { $month: "$createdAt" },
        };
      } else if (groupBy === "quarter") {
        timeGrouping = {
          year: { $year: "$createdAt" },
          quarter: { $ceil: { $divide: [{ $month: "$createdAt" }, 3] } },
        };
      }

      trendPipeline.push({
        $group: {
          _id: {
            ...timeGrouping,
            productId: "$products.product",
          },
          averagePrice: { $avg: "$products.unit_price" },
          quantitySold: { $sum: "$products.quantity" },
        },
      });

      trendPipeline.push({
        $project: {
          _id: 0,
          productId: "$_id.productId",
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: [
                  { $ifNull: ["$_id.month", false] },
                  {
                    $cond: [
                      { $lt: ["$_id.month", 10] },
                      { $concat: ["0", { $toString: "$_id.month" }] },
                      { $toString: "$_id.month" },
                    ],
                  },
                  { $concat: ["Q", { $toString: "$_id.quarter" }] },
                ],
              },
            ],
          },
          averagePrice: { $round: [{ $ifNull: ["$averagePrice", 0] }, 2] },
          quantitySold: 1,
        },
      });

      trendPipeline.push({ $sort: { period: 1 } });

      timeTrend = await CustomerProduct.aggregate(trendPipeline);
    }

    // Overall market summary
    const marketSummary = results.reduce(
      (acc, curr) => {
        acc.totalRevenue += curr.totalRevenue;
        acc.totalQuantity += curr.totalQuantitySold;
        acc.weightedPriceSum += curr.averageSalePrice * curr.totalQuantitySold;
        return acc;
      },
      { totalRevenue: 0, totalQuantity: 0, weightedPriceSum: 0 }
    );

    const overallAveragePrice =
      marketSummary.totalQuantity > 0
        ? Math.round(
            (marketSummary.weightedPriceSum / marketSummary.totalQuantity) * 100
          ) / 100
        : 0;

    res.json({
      success: true,
      data: results,
      timeTrend: includeTimeTrend === "true" ? timeTrend : null,
      marketSummary: {
        overallAveragePrice,
        totalRevenue: Math.round(marketSummary.totalRevenue * 100) / 100,
        totalQuantitySold: marketSummary.totalQuantity,
        productsAnalyzed: results.length,
      },
      filters: { startDate, endDate, productId, includeTimeTrend, groupBy },
    });
  } catch (error) {
    console.error("Error in getAverageSaleCost:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get comprehensive monthly sales dashboard with accurate invoice counting
 */
const getMonthlySalesDashboard = async (req, res) => {
  try {
    const { year = new Date().getFullYear(), compareWithLastYear = "false" } =
      req.query;

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const currentYearPipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $addFields: {
          month: { $month: "$createdAt" },
          // Force all numeric fields to numbers
          grandTotal_num: { $toDouble: { $ifNull: ["$grandTotal", 0] } },
          totalAmount_num: { $toDouble: { $ifNull: ["$totalAmount", 0] } },
          cgst_num: { $toDouble: { $ifNull: ["$cgst", 0] } },
          sgst_num: { $toDouble: { $ifNull: ["$sgst", 0] } },
          igst_num: { $toDouble: { $ifNull: ["$igst", 0] } },
          otherCharges_num: { $toDouble: { $ifNull: ["$otherCharges", 0] } },
          invoiceQuantity: {
            $reduce: {
              input: "$products",
              initialValue: 0,
              in: {
                $add: [
                  "$$value",
                  { $toDouble: { $ifNull: ["$$this.quantity", 0] } },
                ],
              },
            },
          },
        },
      },
      {
        $group: {
          _id: "$month",
          totalRevenue: { $sum: "$grandTotal_num" },
          totalAmount: { $sum: "$totalAmount_num" },
          totalCGST: { $sum: "$cgst_num" },
          totalSGST: { $sum: "$sgst_num" },
          totalIGST: { $sum: "$igst_num" },
          totalOtherCharges: { $sum: "$otherCharges_num" },
          totalQuantity: { $sum: "$invoiceQuantity" },
          invoiceCount: { $sum: 1 },
          uniqueInvoiceIds: { $addToSet: "$_id" },
        },
      },
      {
        $addFields: {
          calculatedTotalTax: {
            $add: ["$totalCGST", "$totalSGST", "$totalIGST"],
          },
        },
      },
      {
        $project: {
          _id: 0,
          month: "$_id",
          monthName: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id", 1] }, then: "January" },
                { case: { $eq: ["$_id", 2] }, then: "February" },
                { case: { $eq: ["$_id", 3] }, then: "March" },
                { case: { $eq: ["$_id", 4] }, then: "April" },
                { case: { $eq: ["$_id", 5] }, then: "May" },
                { case: { $eq: ["$_id", 6] }, then: "June" },
                { case: { $eq: ["$_id", 7] }, then: "July" },
                { case: { $eq: ["$_id", 8] }, then: "August" },
                { case: { $eq: ["$_id", 9] }, then: "September" },
                { case: { $eq: ["$_id", 10] }, then: "October" },
                { case: { $eq: ["$_id", 11] }, then: "November" },
                { case: { $eq: ["$_id", 12] }, then: "December" },
              ],
              default: "Unknown",
            },
          },
          totalQuantity: { $round: ["$totalQuantity", 2] },
          totalRevenue: { $round: ["$totalRevenue", 2] },
          totalAmount: { $round: ["$totalAmount", 2] },
          totalCGST: { $round: ["$totalCGST", 2] },
          totalSGST: { $round: ["$totalSGST", 2] },
          totalIGST: { $round: ["$totalIGST", 2] },
          totalTax: { $round: ["$calculatedTotalTax", 2] },
          totalOtherCharges: { $round: ["$totalOtherCharges", 2] },
          totalInvoices: { $size: "$uniqueInvoiceIds" },
          averageInvoiceValue: {
            $round: [
              {
                $cond: [
                  { $eq: [{ $size: "$uniqueInvoiceIds" }, 0] },
                  0,
                  {
                    $divide: ["$totalRevenue", { $size: "$uniqueInvoiceIds" }],
                  },
                ],
              },
              2,
            ],
          },
        },
      },
      {
        $sort: { month: 1 },
      },
    ];

    const currentYearData = await CustomerProduct.aggregate(
      currentYearPipeline
    );

    // Last year comparison if requested
    let lastYearData = null;
    let comparison = null;

    if (compareWithLastYear === "true") {
      const lastYearStart = new Date(`${parseInt(year) - 1}-01-01`);
      const lastYearEnd = new Date(`${parseInt(year) - 1}-12-31`);

      const lastYearPipeline = [
        {
          $match: {
            createdAt: {
              $gte: lastYearStart,
              $lte: lastYearEnd,
            },
          },
        },
        {
          $addFields: {
            month: { $month: "$createdAt" },
            invoiceQuantity: {
              $reduce: {
                input: "$products",
                initialValue: 0,
                in: { $add: ["$$value", "$$this.quantity"] },
              },
            },
          },
        },
        {
          $group: {
            _id: "$month",
            totalQuantity: { $sum: "$invoiceQuantity" },
            totalRevenue: { $sum: "$grandTotal" },
            uniqueInvoiceIds: { $addToSet: "$_id" },
          },
        },
        {
          $project: {
            _id: 1,
            totalQuantity: 1,
            totalRevenue: 1,
            totalInvoices: { $size: "$uniqueInvoiceIds" },
          },
        },
        {
          $sort: { _id: 1 },
        },
      ];

      lastYearData = await CustomerProduct.aggregate(lastYearPipeline);

      // Calculate comparison
      comparison = currentYearData.map((current) => {
        const lastYear = lastYearData.find(
          (ly) => ly._id === current.month
        ) || {
          totalQuantity: 0,
          totalRevenue: 0,
          totalInvoices: 0,
        };

        const quantityChange = current.totalQuantity - lastYear.totalQuantity;
        const revenueChange = current.totalRevenue - lastYear.totalRevenue;
        const invoiceChange = current.totalInvoices - lastYear.totalInvoices;

        return {
          month: current.month,
          monthName: current.monthName,
          currentYear: {
            quantity: current.totalQuantity,
            revenue: current.totalRevenue,
            invoices: current.totalInvoices,
          },
          lastYear: {
            quantity: lastYear.totalQuantity,
            revenue: lastYear.totalRevenue,
            invoices: lastYear.totalInvoices,
          },
          growth: {
            quantityChange,
            revenueChange: Math.round(revenueChange * 100) / 100,
            invoiceChange,
            quantityGrowthPercent:
              lastYear.totalQuantity > 0
                ? Math.round(
                    (quantityChange / lastYear.totalQuantity) * 100 * 100
                  ) / 100
                : null,
            revenueGrowthPercent:
              lastYear.totalRevenue > 0
                ? Math.round(
                    (revenueChange / lastYear.totalRevenue) * 100 * 100
                  ) / 100
                : null,
            invoiceGrowthPercent:
              lastYear.totalInvoices > 0
                ? Math.round(
                    (invoiceChange / lastYear.totalInvoices) * 100 * 100
                  ) / 100
                : null,
          },
        };
      });
    }

    // Year summary
    const yearSummary = currentYearData.reduce(
      (acc, month) => {
        acc.totalQuantity += month.totalQuantity;
        acc.totalRevenue += month.totalRevenue;
        acc.totalInvoices += month.totalInvoices;
        return acc;
      },
      { totalQuantity: 0, totalRevenue: 0, totalInvoices: 0 }
    );

    // Calculate best and worst performing months
    const bestMonth = currentYearData.reduce((best, current) =>
      current.totalRevenue > best.totalRevenue ? current : best
    );

    const worstMonth = currentYearData.reduce((worst, current) =>
      current.totalRevenue < worst.totalRevenue ? current : worst
    );

    res.json({
      success: true,
      year: parseInt(year),
      monthlyData: currentYearData,
      yearSummary: {
        totalQuantity: yearSummary.totalQuantity,
        totalRevenue: Math.round(yearSummary.totalRevenue * 100) / 100,
        totalInvoices: yearSummary.totalInvoices,
        averageMonthlyRevenue:
          Math.round((yearSummary.totalRevenue / 12) * 100) / 100,
        averageMonthlyInvoices: Math.round(yearSummary.totalInvoices / 12),
        averageInvoiceValue:
          yearSummary.totalInvoices > 0
            ? Math.round(
                (yearSummary.totalRevenue / yearSummary.totalInvoices) * 100
              ) / 100
            : 0,
      },
      insights: {
        bestPerformingMonth: {
          month: bestMonth.monthName,
          revenue: bestMonth.totalRevenue,
        },
        worstPerformingMonth: {
          month: worstMonth.monthName,
          revenue: worstMonth.totalRevenue,
        },
        revenueVolatility:
          Math.round(
            ((bestMonth.totalRevenue - worstMonth.totalRevenue) /
              worstMonth.totalRevenue) *
              100 *
              100
          ) / 100,
      },
      comparison: compareWithLastYear === "true" ? comparison : null,
    });
  } catch (error) {
    console.error("Error in getMonthlySalesDashboard:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get top performing products
 */
const getTopPerformingProducts = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      limit = 10,
      metric = "revenue", // revenue, quantity, profit
    } = req.query;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    const pipeline = [
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $group: {
          _id: {
            productId: "$products.product",
            productName: "$products.name",
          },
          totalQuantitySold: { $sum: "$products.quantity" },
          totalRevenue: { $sum: "$products.total_price" },
          averagePrice: { $avg: "$products.unit_price" },
          invoiceCount: { $sum: 1 },
          uniqueCustomers: { $addToSet: "$customer" },
        },
      },
      {
        $project: {
          _id: 0,
          productId: "$_id.productId",
          productName: "$_id.productName",
          totalQuantitySold: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          averagePrice: { $round: ["$averagePrice", 2] },
          invoiceCount: 1,
          uniqueCustomerCount: { $size: "$uniqueCustomers" },
        },
      },
    ];

    // Sort based on metric
    const sortStage = {};
    if (metric === "quantity") {
      sortStage.totalQuantitySold = -1;
    } else if (metric === "revenue") {
      sortStage.totalRevenue = -1;
    }
    pipeline.push({ $sort: sortStage });

    pipeline.push({ $limit: parseInt(limit) });

    const results = await CustomerProduct.aggregate(pipeline);

    res.json({
      success: true,
      data: results,
      metric,
      filters: { startDate, endDate, limit },
    });
  } catch (error) {
    console.error("Error in getTopPerformingProducts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Get customer purchase patterns
 */
const getCustomerPurchasePatterns = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      customerId,
      minPurchaseValue,
      limit = 20,
    } = req.query;

    const matchStage = {};
    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    if (customerId) {
      matchStage.customer = mongoose.Types.ObjectId(customerId);
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: "$customer",
          totalPurchaseValue: { $sum: "$grandTotal" },
          totalInvoices: { $sum: 1 },
          averageInvoiceValue: { $avg: "$grandTotal" },
          totalQuantityPurchased: {
            $sum: {
              $reduce: {
                input: "$products",
                initialValue: 0,
                in: { $add: ["$value", "$this.quantity"] },
              },
            },
          },
          firstPurchase: { $min: "$createdAt" },
          lastPurchase: { $max: "$createdAt" },
          preferredWidths: { $push: "$products.width" },
        },
      },
      {
        $lookup: {
          from: "customers",
          localField: "_id",
          foreignField: "_id",
          as: "customerInfo",
        },
      },
      { $unwind: "$customerInfo" },
    ];

    if (minPurchaseValue) {
      pipeline.push({
        $match: { totalPurchaseValue: { $gte: parseFloat(minPurchaseValue) } },
      });
    }

    pipeline.push({
      $project: {
        _id: 0,
        customerId: "$_id",
        customerName: "$customerInfo.name",
        customerEmail: "$customerInfo.email",
        totalPurchaseValue: { $round: ["$totalPurchaseValue", 2] },
        totalInvoices: 1,
        averageInvoiceValue: { $round: ["$averageInvoiceValue", 2] },
        totalQuantityPurchased: 1,
        firstPurchase: 1,
        lastPurchase: 1,
        daysSinceLastPurchase: {
          $dateDiff: {
            startDate: "$lastPurchase",
            endDate: new Date(),
            unit: "day",
          },
        },
        customerLifetimeDays: {
          $dateDiff: {
            startDate: "$firstPurchase",
            endDate: "$lastPurchase",
            unit: "day",
          },
        },
      },
    });

    pipeline.push({ $sort: { totalPurchaseValue: -1 } });
    pipeline.push({ $limit: parseInt(limit) });

    const results = await CustomerProduct.aggregate(pipeline);

    res.json({
      success: true,
      data: results,
      summary: {
        customersAnalyzed: results.length,
        totalValueAnalyzed: results.reduce(
          (sum, c) => sum + c.totalPurchaseValue,
          0
        ),
      },
      filters: { startDate, endDate, customerId, minPurchaseValue, limit },
    });
  } catch (error) {
    console.error("Error in getCustomerPurchasePatterns:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
/**
 * Diagnostic function to identify data quality issues
 * This helps find zero revenue widths and other data problems
 */
const diagnoseWidthRevenueIssues = async (req, res) => {
  try {
    const { year = new Date().getFullYear(), month } = req.query;

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    const matchStage = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (month) {
      matchStage.$expr = {
        $eq: [{ $month: "$createdAt" }, parseInt(month)],
      };
    }

    // Find all product entries with issues
    const issuesPipeline = [
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $addFields: {
          // Convert string values to numbers
          "products.total_price_num": {
            $toDouble: { $ifNull: ["$products.total_price", 0] },
          },
          "products.quantity_num": {
            $toDouble: { $ifNull: ["$products.quantity", 0] },
          },
          "products.unit_price_num": {
            $toDouble: { $ifNull: ["$products.unit_price", 0] },
          },
        },
      },
      {
        $project: {
          invoiceId: "$_id",
          invoiceNumber: 1,
          customerName: "$customer",
          createdAt: 1,
          productName: "$products.name",
          width: "$products.width",
          quantity: "$products.quantity_num",
          unitPrice: "$products.unit_price_num",
          totalPrice: "$products.total_price_num",
          hasIssue: {
            $or: [
              { $eq: ["$products.total_price_num", 0] },
              { $eq: ["$products.total_price", null] },
              { $lte: ["$products.total_price_num", 0] },
              { $eq: ["$products.quantity_num", 0] },
              { $eq: ["$products.quantity", null] },
              { $lte: ["$products.quantity_num", 0] },
              { $eq: ["$products.width", null] },
            ],
          },
          issueType: {
            $switch: {
              branches: [
                {
                  case: { $eq: ["$products.total_price", null] },
                  then: "NULL_TOTAL_PRICE",
                },
                {
                  case: { $eq: ["$products.total_price_num", 0] },
                  then: "ZERO_TOTAL_PRICE",
                },
                {
                  case: { $lt: ["$products.total_price_num", 0] },
                  then: "NEGATIVE_TOTAL_PRICE",
                },
                {
                  case: { $eq: ["$products.quantity", null] },
                  then: "NULL_QUANTITY",
                },
                {
                  case: { $eq: ["$products.quantity_num", 0] },
                  then: "ZERO_QUANTITY",
                },
                {
                  case: { $lt: ["$products.quantity_num", 0] },
                  then: "NEGATIVE_QUANTITY",
                },
                {
                  case: { $eq: ["$products.width", null] },
                  then: "NULL_WIDTH",
                },
              ],
              default: "UNKNOWN",
            },
          },
        },
      },
      {
        $match: {
          hasIssue: true,
        },
      },
    ];

    const issues = await CustomerProduct.aggregate(issuesPipeline);

    // Group issues by type
    const issuesByType = issues.reduce((acc, issue) => {
      if (!acc[issue.issueType]) {
        acc[issue.issueType] = [];
      }
      acc[issue.issueType].push(issue);
      return acc;
    }, {});

    // Get width breakdown with zero revenue - FIXED WITH TYPE CONVERSION
    const widthBreakdownPipeline = [
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $addFields: {
          // Convert string values to numbers before aggregation
          "products.total_price_num": {
            $toDouble: { $ifNull: ["$products.total_price", 0] },
          },
          "products.quantity_num": {
            $toDouble: { $ifNull: ["$products.quantity", 0] },
          },
          "products.unit_price_num": {
            $toDouble: { $ifNull: ["$products.unit_price", 0] },
          },
        },
      },
      {
        $group: {
          _id: "$products.width",
          totalQuantity: { $sum: "$products.quantity_num" },
          totalRevenue: { $sum: "$products.total_price_num" },
          averageUnitPrice: { $avg: "$products.unit_price_num" },
          minPrice: { $min: "$products.unit_price_num" },
          maxPrice: { $max: "$products.unit_price_num" },
          recordCount: { $sum: 1 },
          nullPriceCount: {
            $sum: {
              $cond: [{ $eq: ["$products.total_price", null] }, 1, 0],
            },
          },
          zeroPriceCount: {
            $sum: {
              $cond: [{ $eq: ["$products.total_price_num", 0] }, 1, 0],
            },
          },
          negativePriceCount: {
            $sum: {
              $cond: [{ $lt: ["$products.total_price_num", 0] }, 1, 0],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          width: "$_id",
          totalQuantity: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          averageUnitPrice: { $round: ["$averageUnitPrice", 2] },
          minPrice: { $round: ["$minPrice", 2] },
          maxPrice: { $round: ["$maxPrice", 2] },
          recordCount: 1,
          nullPriceCount: 1,
          zeroPriceCount: 1,
          negativePriceCount: 1,
          hasDataIssues: {
            $or: [
              { $gt: ["$nullPriceCount", 0] },
              { $gt: ["$zeroPriceCount", 0] },
              { $gt: ["$negativePriceCount", 0] },
            ],
          },
        },
      },
      { $sort: { totalRevenue: 1 } }, // Sort to show zero/low revenue first
    ];

    const widthBreakdown = await CustomerProduct.aggregate(
      widthBreakdownPipeline
    );

    // Get sample invoices with issues for manual review
    const sampleIssues = await CustomerProduct.aggregate([
      { $match: matchStage },
      { $unwind: "$products" },
      {
        $addFields: {
          "products.total_price_num": {
            $toDouble: { $ifNull: ["$products.total_price", 0] },
          },
          "products.quantity_num": {
            $toDouble: { $ifNull: ["$products.quantity", 0] },
          },
          "products.unit_price_num": {
            $toDouble: { $ifNull: ["$products.unit_price", 0] },
          },
        },
      },
      {
        $match: {
          $or: [
            { "products.total_price_num": { $lte: 0 } },
            { "products.total_price": null },
            { "products.quantity_num": { $lte: 0 } },
            { "products.quantity": null },
          ],
        },
      },
      { $limit: 10 },
      {
        $project: {
          invoiceId: "$_id",
          invoiceNumber: 1,
          createdAt: 1,
          productName: "$products.name",
          width: "$products.width",
          quantity: "$products.quantity_num",
          unitPrice: "$products.unit_price_num",
          totalPrice: "$products.total_price_num",
        },
      },
    ]);

    // Summary statistics
    const summary = {
      totalIssuesFound: issues.length,
      issueBreakdown: Object.keys(issuesByType).map((type) => ({
        issueType: type,
        count: issuesByType[type].length,
      })),
      widthsWithZeroRevenue: widthBreakdown.filter((w) => w.totalRevenue === 0)
        .length,
      widthsWithDataIssues: widthBreakdown.filter((w) => w.hasDataIssues)
        .length,
      totalWidthsAnalyzed: widthBreakdown.length,
    };

    res.json({
      success: true,
      summary,
      widthBreakdown: widthBreakdown.slice(0, 20), // First 20 widths
      issuesByType,
      sampleProblematicInvoices: sampleIssues,
      recommendations: [
        issues.length > 0
          ? "Data quality issues detected. Review and fix invoices with null or zero values."
          : "No major data quality issues found.",
        widthBreakdown.filter((w) => w.totalRevenue === 0).length > 0
          ? "Some widths have zero revenue. Check if products are being given away for free or if there's a data entry issue."
          : "All widths have valid revenue data.",
        "Consider adding validation at invoice creation to prevent null or zero values in quantity and total_price fields.",
        "Some numeric fields are stored as strings - consider converting them to numbers at the database level for better performance.",
      ],
    });
  } catch (error) {
    console.error("Error in diagnoseWidthRevenueIssues:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * Helper function to clean up data issues
 * WARNING: This modifies data - use with caution!
 */
const suggestDataFixes = async (req, res) => {
  try {
    const { year = new Date().getFullYear(), dryRun = "true" } = req.query;

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Find invoices that need fixing
    const invoicesNeedingFix = await CustomerProduct.find({
      createdAt: { $gte: startDate, $lte: endDate },
      $or: [
        { "products.total_price": { $in: [0, null] } },
        { "products.quantity": { $in: [0, null] } },
      ],
    }).limit(100);

    const fixes = [];

    for (const invoice of invoicesNeedingFix) {
      for (let i = 0; i < invoice.products.length; i++) {
        const product = invoice.products[i];
        const issues = [];
        const suggestedFixes = {};

        // Check total_price
        if (!product.total_price || product.total_price <= 0) {
          issues.push("Invalid total_price");
          // Calculate from quantity and unit_price if available
          if (product.quantity > 0 && product.unit_price > 0) {
            suggestedFixes.total_price = product.quantity * product.unit_price;
          }
        }

        // Check quantity
        if (!product.quantity || product.quantity <= 0) {
          issues.push("Invalid quantity");
          // Calculate from total_price and unit_price if available
          if (product.total_price > 0 && product.unit_price > 0) {
            suggestedFixes.quantity = product.total_price / product.unit_price;
          }
        }

        if (issues.length > 0) {
          fixes.push({
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            productIndex: i,
            productName: product.name,
            currentValues: {
              quantity: product.quantity,
              unit_price: product.unit_price,
              total_price: product.total_price,
            },
            issues,
            suggestedFixes,
            canAutoFix: Object.keys(suggestedFixes).length > 0,
          });
        }
      }
    }

    // Apply fixes if not dry run
    if (dryRun === "false") {
      let fixedCount = 0;
      for (const fix of fixes) {
        if (fix.canAutoFix) {
          const updateFields = {};
          Object.keys(fix.suggestedFixes).forEach((key) => {
            updateFields[`products.${fix.productIndex}.${key}`] =
              fix.suggestedFixes[key];
          });

          await CustomerProduct.updateOne(
            { _id: fix.invoiceId },
            { $set: updateFields }
          );
          fixedCount++;
        }
      }

      return res.json({
        success: true,
        message: `Fixed ${fixedCount} out of ${fixes.length} issues`,
        fixedCount,
        totalIssues: fixes.length,
      });
    }

    res.json({
      success: true,
      dryRun: true,
      message: "This is a dry run. Set dryRun=false to apply fixes.",
      totalIssuesFound: fixes.length,
      autoFixableIssues: fixes.filter((f) => f.canAutoFix).length,
      fixes: fixes.slice(0, 20), // Show first 20
    });
  } catch (error) {
    console.error("Error in suggestDataFixes:", error);
    res.status(500).json({ success: false, error: error.message });
  }
};
/**
 * Get month-wise quantity for multiple widths and specific product
 * @route POST /api/analytics/multi-width-monthly
 * @body { productId: string, widths: number[], year?: number, startDate?: string, endDate?: string }
 */
const getMultiWidthMonthlyAnalytics = async (req, res) => {
  try {
    const { productId, widths = [], year, startDate, endDate } = req.body;

    // Validation
    if (!productId) {
      return res.status(400).json({
        success: false,
        error: "productId is required",
      });
    }

    if (!Array.isArray(widths) || widths.length === 0) {
      return res.status(400).json({
        success: false,
        error: "widths array is required and must not be empty",
      });
    }

    // Validate product ID format
    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return res.status(400).json({
        success: false,
        error: "Invalid product ID format",
      });
    }

    // Build date filter
    const matchStage = {};

    if (year) {
      const yearStart = new Date(`${year}-01-01`);
      const yearEnd = new Date(`${year}-12-31`);
      yearEnd.setHours(23, 59, 59, 999);
      matchStage.createdAt = { $gte: yearStart, $lte: yearEnd };
    } else if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) {
        matchStage.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setHours(23, 59, 59, 999);
        matchStage.createdAt.$lte = endDateTime;
      }
    } else {
      // Default to current year if no date filter provided
      const currentYear = new Date().getFullYear();
      matchStage.createdAt = {
        $gte: new Date(`${currentYear}-01-01`),
        $lte: new Date(`${currentYear}-12-31`),
      };
    }

    // Convert widths to numbers and remove duplicates
    const uniqueWidths = [...new Set(widths.map((w) => parseFloat(w)))];

    // Build aggregation pipeline
    const pipeline = [
      // Match date range
      { $match: matchStage },

      // Unwind products array
      { $unwind: "$products" },

      // Match specific product and widths
      {
        $match: {
          "products.product": new mongoose.Types.ObjectId(productId),
          "products.width": { $in: uniqueWidths },
        },
      },

      // Convert quantity to number for accurate aggregation
      {
        $addFields: {
          "products.quantity_num": {
            $toDouble: { $ifNull: ["$products.quantity", 0] },
          },
          "products.total_price_num": {
            $toDouble: { $ifNull: ["$products.total_price", 0] },
          },
        },
      },

      // Group by month and sum quantities across all widths
      {
        $group: {
          _id: {
            year: { $year: "$createdAt" },
            month: { $month: "$createdAt" },
          },
          totalQuantity: { $sum: "$products.quantity_num" },
          totalRevenue: { $sum: "$products.total_price_num" },
          invoiceCount: { $sum: 1 },
          widthBreakdown: {
            $push: {
              width: "$products.width",
              quantity: "$products.quantity_num",
              revenue: "$products.total_price_num",
            },
          },
        },
      },

      // Format the output
      {
        $project: {
          _id: 0,
          year: "$_id.year",
          month: "$_id.month",
          monthName: {
            $switch: {
              branches: [
                { case: { $eq: ["$_id.month", 1] }, then: "January" },
                { case: { $eq: ["$_id.month", 2] }, then: "February" },
                { case: { $eq: ["$_id.month", 3] }, then: "March" },
                { case: { $eq: ["$_id.month", 4] }, then: "April" },
                { case: { $eq: ["$_id.month", 5] }, then: "May" },
                { case: { $eq: ["$_id.month", 6] }, then: "June" },
                { case: { $eq: ["$_id.month", 7] }, then: "July" },
                { case: { $eq: ["$_id.month", 8] }, then: "August" },
                { case: { $eq: ["$_id.month", 9] }, then: "September" },
                { case: { $eq: ["$_id.month", 10] }, then: "October" },
                { case: { $eq: ["$_id.month", 11] }, then: "November" },
                { case: { $eq: ["$_id.month", 12] }, then: "December" },
              ],
              default: "Unknown",
            },
          },
          period: {
            $concat: [
              { $toString: "$_id.year" },
              "-",
              {
                $cond: [
                  { $lt: ["$_id.month", 10] },
                  { $concat: ["0", { $toString: "$_id.month" }] },
                  { $toString: "$_id.month" },
                ],
              },
            ],
          },
          totalQuantity: { $round: ["$totalQuantity", 2] },
          totalRevenue: { $round: ["$totalRevenue", 2] },
          averageRevenuePerUnit: {
            $cond: [
              { $eq: ["$totalQuantity", 0] },
              0,
              { $round: [{ $divide: ["$totalRevenue", "$totalQuantity"] }, 2] },
            ],
          },
          invoiceCount: 1,
          widthBreakdown: 1,
        },
      },

      // Sort by year and month
      {
        $sort: { year: 1, month: 1 },
      },
    ];

    const results = await CustomerProduct.aggregate(pipeline);

    // Process width breakdown for each month
    const processedResults = results.map((month) => {
      // Aggregate quantities by width
      const widthSummary = month.widthBreakdown.reduce((acc, item) => {
        if (!acc[item.width]) {
          acc[item.width] = {
            width: item.width,
            quantity: 0,
            revenue: 0,
          };
        }
        acc[item.width].quantity += item.quantity;
        acc[item.width].revenue += item.revenue;
        return acc;
      }, {});

      // Convert to array and format
      const widthBreakdownFormatted = Object.values(widthSummary).map((w) => ({
        width: w.width,
        quantity: Math.round(w.quantity * 100) / 100,
        revenue: Math.round(w.revenue * 100) / 100,
      }));

      return {
        ...month,
        widthBreakdown: widthBreakdownFormatted,
      };
    });

    // Calculate overall summary
    const summary = processedResults.reduce(
      (acc, month) => {
        acc.totalQuantity += month.totalQuantity;
        acc.totalRevenue += month.totalRevenue;
        acc.totalInvoices += month.invoiceCount;
        return acc;
      },
      {
        totalQuantity: 0,
        totalRevenue: 0,
        totalInvoices: 0,
      }
    );

    // Get width-wise summary across all months
    const widthWiseSummary = {};
    processedResults.forEach((month) => {
      month.widthBreakdown.forEach((item) => {
        if (!widthWiseSummary[item.width]) {
          widthWiseSummary[item.width] = {
            width: item.width,
            totalQuantity: 0,
            totalRevenue: 0,
          };
        }
        widthWiseSummary[item.width].totalQuantity += item.quantity;
        widthWiseSummary[item.width].totalRevenue += item.revenue;
      });
    });

    const widthWiseSummaryArray = Object.values(widthWiseSummary).map((w) => ({
      width: w.width,
      totalQuantity: Math.round(w.totalQuantity * 100) / 100,
      totalRevenue: Math.round(w.totalRevenue * 100) / 100,
      percentageOfTotal:
        summary.totalQuantity > 0
          ? Math.round((w.totalQuantity / summary.totalQuantity) * 100 * 100) /
            100
          : 0,
    }));

    res.json({
      success: true,
      data: processedResults,
      summary: {
        totalQuantity: Math.round(summary.totalQuantity * 100) / 100,
        totalRevenue: Math.round(summary.totalRevenue * 100) / 100,
        totalInvoices: summary.totalInvoices,
        averageQuantityPerMonth:
          processedResults.length > 0
            ? Math.round(
                (summary.totalQuantity / processedResults.length) * 100
              ) / 100
            : 0,
        averageRevenuePerMonth:
          processedResults.length > 0
            ? Math.round(
                (summary.totalRevenue / processedResults.length) * 100
              ) / 100
            : 0,
        monthsWithData: processedResults.length,
      },
      widthWiseSummary: widthWiseSummaryArray,
      filters: {
        productId,
        widths: uniqueWidths,
        year,
        startDate,
        endDate,
      },
    });
  } catch (error) {
    console.error("Error in getMultiWidthMonthlyAnalytics:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Export all functions
module.exports = {
  diagnoseWidthRevenueIssues,
  suggestDataFixes,
  getQuantitySoldByWidth,
  getProductSalesAnalytics,
  getAverageSaleCost,
  getMonthlySalesDashboard,
  getTopPerformingProducts,
  getCustomerPurchasePatterns,
  getWidthDistribution,
  getSalesTrends,
  getAnalyticsDashboard,
  getMultiWidthMonthlyAnalytics,
};
