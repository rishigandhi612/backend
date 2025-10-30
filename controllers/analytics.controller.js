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

    if (startDate || endDate) {
      matchStage.createdAt = {};
      if (startDate) matchStage.createdAt.$gte = new Date(startDate);
      if (endDate) matchStage.createdAt.$lte = new Date(endDate);
    }

    if (customerId) {
      matchStage.customer = mongoose.Types.ObjectId(customerId);
    }

    const pipeline = [{ $match: matchStage }, { $unwind: "$products" }];

    if (productId) {
      pipeline.push({
        $match: { "products.product": mongoose.Types.ObjectId(productId) },
      });
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

    // Define grouping
    let groupId = {};
    if (groupBy === "product") {
      groupId = {
        productId: "$products.product",
        productName: "$products.name",
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
        uniqueCustomers: { $addToSet: "$customer" },
        widthsSold: { $addToSet: "$products.width" },
      },
    });

    // Calculate profit margin
    pipeline.push({
      $project: {
        _id: 1,
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
        uniqueCustomerCount: { $size: "$uniqueCustomers" },
        widthsSold: 1,
      },
    });

    // Sort
    const sortStage = {};
    if (sortBy === "quantity") {
      sortStage.totalQuantitySold = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "revenue") {
      sortStage.totalRevenue = sortOrder === "desc" ? -1 : 1;
    } else if (sortBy === "profit") {
      sortStage.grossProfit = sortOrder === "desc" ? -1 : 1;
    }
    pipeline.push({ $sort: sortStage });

    if (limit && !isNaN(limit)) {
      pipeline.push({ $limit: parseInt(limit) });
    }

    const results = await CustomerProduct.aggregate(pipeline);

    // Calculate overall summary
    const overallSummary = results.reduce(
      (acc, curr) => {
        acc.totalQuantity += curr.totalQuantitySold;
        acc.totalRevenue += curr.totalRevenue;
        acc.totalProfit += curr.grossProfit || 0;
        acc.totalInvoices += curr.invoiceCount;
        return acc;
      },
      { totalQuantity: 0, totalRevenue: 0, totalProfit: 0, totalInvoices: 0 }
    );

    res.json({
      success: true,
      data: results,
      summary: {
        totalQuantitySold: overallSummary.totalQuantity,
        totalRevenue: parseInt(
          Math.round(overallSummary.totalRevenue * 100) / 100
        ),
        totalProfit: parseInt(
          Math.round(overallSummary.totalProfit * 100) / 100
        ),
        totalInvoices: overallSummary.totalInvoices,
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
 * Get comprehensive monthly sales dashboard
 */
const getMonthlySalesDashboard = async (req, res) => {
  try {
    const { year = new Date().getFullYear(), compareWithLastYear = "false" } =
      req.query;

    const startDate = new Date(`${year}-01-01`);
    const endDate = new Date(`${year}-12-31`);

    // Current year data
    const currentYearPipeline = [
      {
        $match: {
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      { $unwind: "$products" },
      {
        $group: {
          _id: {
            month: { $month: "$createdAt" },
            width: "$products.width",
          },
          quantitySold: { $sum: "$products.quantity" },
          revenue: { $sum: "$products.total_price" },
          invoiceCount: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: "$_id.month",
          totalQuantity: { $sum: "$quantitySold" },
          totalRevenue: { $sum: "$revenue" },
          totalInvoices: { $sum: "$invoiceCount" },
          widthBreakdown: {
            $push: {
              width: "$_id.width",
              quantity: "$quantitySold",
              revenue: "$revenue",
            },
          },
        },
      },
      { $sort: { _id: 1 } },
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
          totalQuantity: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          totalInvoices: 1,
          averageInvoiceValue: {
            $round: [{ $divide: ["$totalRevenue", "$totalInvoices"] }, 2],
          },
          widthBreakdown: 1,
        },
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
            createdAt: { $gte: lastYearStart, $lte: lastYearEnd },
          },
        },
        { $unwind: "$products" },
        {
          $group: {
            _id: { $month: "$createdAt" },
            totalQuantity: { $sum: "$products.quantity" },
            totalRevenue: { $sum: "$products.total_price" },
          },
        },
        { $sort: { _id: 1 } },
      ];

      lastYearData = await CustomerProduct.aggregate(lastYearPipeline);

      // Calculate comparison
      comparison = currentYearData.map((current) => {
        const lastYear = lastYearData.find(
          (ly) => ly._id === current.month
        ) || {
          totalQuantity: 0,
          totalRevenue: 0,
        };

        const quantityChange = current.totalQuantity - lastYear.totalQuantity;
        const revenueChange = current.totalRevenue - lastYear.totalRevenue;

        return {
          month: current.month,
          monthName: current.monthName,
          quantityGrowth:
            lastYear.totalQuantity > 0
              ? Math.round(
                  (quantityChange / lastYear.totalQuantity) * 100 * 100
                ) / 100
              : null,
          revenueGrowth:
            lastYear.totalRevenue > 0
              ? Math.round(
                  (revenueChange / lastYear.totalRevenue) * 100 * 100
                ) / 100
              : null,
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

    res.json({
      success: true,
      year: parseInt(year),
      monthlyData: currentYearData,
      yearSummary: {
        ...yearSummary,
        totalRevenue: Math.round(yearSummary.totalRevenue * 100) / 100,
        averageMonthlyRevenue:
          Math.round((yearSummary.totalRevenue / 12) * 100) / 100,
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

// Export all functions
module.exports = {
  getQuantitySoldByWidth,
  getProductSalesAnalytics,
  getAverageSaleCost,
  getMonthlySalesDashboard,
  getTopPerformingProducts,
  getCustomerPurchasePatterns,
  getWidthDistribution,
  getSalesTrends,
  getAnalyticsDashboard,
};
