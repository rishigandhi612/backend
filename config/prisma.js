// config/prisma.js
const { PrismaClient } = require('@prisma/client');

// Create a singleton instance of PrismaClient
const prisma = new PrismaClient();

module.exports = prisma;