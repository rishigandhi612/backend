// analytics.routes.js
// Route configuration for analytics endpoints

const express = require("express");
const router = express.Router();

const {
  getQuantitySoldByWidth,
  getProductSalesAnalytics,
  getAverageSaleCost,
  getMonthlySalesDashboard,
  getTopPerformingProducts,
  getCustomerPurchasePatterns,
  getWidthDistribution,
  getSalesTrends,
  getAnalyticsDashboard,
  diagnoseWidthRevenueIssues,
  suggestDataFixes,
  getMultiWidthMonthlyAnalytics,
} = require("../controllers/analytics.controller");

/**
 * @route   GET /api/analytics/quantity-by-width
 * @desc    Get quantity sold grouped by width with filters
 * @access  Private (add authentication middleware if needed)
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - productId (optional): MongoDB ObjectId
 *   - customerId (optional): MongoDB ObjectId
 *   - groupBy (optional): month, quarter, year, week (default: month)
 *   - widthRange (optional): "100-200" or specific width number
 *   - sortBy (optional): quantity, width, revenue (default: quantity)
 *   - sortOrder (optional): asc, desc (default: desc)
 *   - limit (optional): number of results
 */
router.get("/quantity-by-width", getQuantitySoldByWidth);
router.get("/diagnose-width-revenue", diagnoseWidthRevenueIssues);
router.get("/suggest-data-fixes", suggestDataFixes);
/**
 * @route   GET /api/analytics/product-sales
 * @desc    Get comprehensive product sales analytics
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - productId (optional): MongoDB ObjectId
 *   - customerId (optional): MongoDB ObjectId
 *   - groupBy (optional): product, month, customer (default: product)
 *   - minQuantity (optional): minimum quantity filter
 *   - maxQuantity (optional): maximum quantity filter
 *   - sortBy (optional): quantity, revenue, profit (default: quantity)
 *   - sortOrder (optional): asc, desc (default: desc)
 *   - limit (optional): number of results
 */
router.get("/product-sales", getProductSalesAnalytics);

/**
 * @route   GET /api/analytics/average-sale-cost
 * @desc    Get average sale cost of products with price trends
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - productId (optional): MongoDB ObjectId
 *   - includeTimeTrend (optional): true/false (default: false)
 *   - groupBy (optional): month, quarter (default: month) - for time trend
 */
router.get("/average-sale-cost", getAverageSaleCost);

/**
 * @route   GET /api/analytics/monthly-dashboard
 * @desc    Get monthly sales dashboard with breakdowns
 * @access  Private
 * @params
 *   - year (optional): Year to analyze (default: current year)
 *   - compareWithLastYear (optional): true/false (default: false)
 */
router.get("/monthly-dashboard", getMonthlySalesDashboard);

/**
 * @route   GET /api/analytics/top-products
 * @desc    Get top performing products
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - limit (optional): number of results (default: 10)
 *   - metric (optional): revenue, quantity, profit (default: revenue)
 */
router.get("/top-products", getTopPerformingProducts);

/**
 * @route   GET /api/analytics/customer-patterns
 * @desc    Get customer purchase patterns and behavior
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - customerId (optional): MongoDB ObjectId
 *   - minPurchaseValue (optional): minimum purchase value filter
 *   - limit (optional): number of results (default: 20)
 */
router.get("/customer-patterns", getCustomerPurchasePatterns);

/**
 * @route   GET /api/analytics/width-distribution
 * @desc    Get width distribution analytics
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 *   - productId (optional): MongoDB ObjectId
 */
router.get("/width-distribution", getWidthDistribution);

/**
 * @route   GET /api/analytics/sales-trends
 * @desc    Get sales trends and forecasting data
 * @access  Private
 * @params
 *   - months (optional): number of months to analyze (default: 12)
 *   - productId (optional): MongoDB ObjectId
 *   - groupBy (optional): month, week (default: month)
 */
router.get("/sales-trends", getSalesTrends);

/**
 * @route   GET /api/analytics/dashboard
 * @desc    Get comprehensive analytics dashboard
 * @access  Private
 * @params
 *   - startDate (optional): ISO date string
 *   - endDate (optional): ISO date string
 */
router.get("/dashboard", getAnalyticsDashboard);
router.post("/multi-width-monthly", getMultiWidthMonthlyAnalytics);

module.exports = router;
