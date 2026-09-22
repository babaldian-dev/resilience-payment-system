// API GATEWAY SERVICE
// This service acts as the single entry point for all client requests.
// It routes incoming requests to the appropriate backend services.

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3000;

const TRANSACTION_SERVICE_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3001';
const LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:3002';

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root endpoint — redirect to Swagger UI
app.get('/', (req, res) => {
    res.redirect('/api-docs');
});

// SWAGGER API DOCUMENTATION
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');

const swaggerOptions = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Payment System API',
            version: '1.0.0',
            description: 'API documentation for the payment system prototype.',
        },
        servers: [
            {
                url: 'https://api-gateway-production-c95d.up.railway.app', // Your Railway URL
                description: 'Production server'
            }
        ]
    },
    apis: ['./src/app.js']
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// REQUEST LOGGING MIDDLEWARE
app.use((req, res, next) => {
    console.log(`[API Gateway] ${req.method} ${req.path}`);
    next();
});

// HEALTH CHECK ENDPOINT
/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns the current status of the API Gateway service
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: "ok"
 *                 service:
 *                   type: string
 *                   example: "api-gateway"
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                   example: "2026-09-21T12:00:00.000Z"
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'api-gateway',
        timestamp: new Date().toISOString()
    });
});

// PAYMENT PROCESSING ENDPOINT
/**
 * @swagger
 * /api/payment:
 *   post:
 *     summary: Process a payment
 *     description: Forwards a payment request to the Transaction Service for processing.
 *     tags: [Payment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - userId
 *               - amount
 *               - idempotencyKey
 *             properties:
 *               userId:
 *                 type: string
 *                 example: "11111111-1111-1111-1111-111111111111"
 *               amount:
 *                 type: number
 *                 example: 500.00
 *               idempotencyKey:
 *                 type: string
 *                 example: "demo-001"
 *     responses:
 *       201:
 *         description: Payment processed successfully
 *       400:
 *         description: Missing required fields
 *       409:
 *         description: Duplicate transaction
 *       500:
 *         description: Internal server error
 */
app.post('/api/payment', async (req, res) => {
    try {
        console.log('[API Gateway] Forwarding payment request to Transaction Service');
        const response = await axios.post(
            `${TRANSACTION_SERVICE_URL}/transaction/process`,
            req.body
        );
        console.log('[API Gateway] Payment processed successfully');
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('[API Gateway] Error forwarding payment:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({
                error: 'Transaction Service unavailable',
                message: error.message
            });
        }
    }
});

// TRANSACTION STATUS ENDPOINT
/**
 * @swagger
 * /api/status/{id}:
 *   get:
 *     summary: Get transaction status
 *     description: Retrieves the status of a transaction using either the transaction ID or the idempotency key.
 *     tags: [Status]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The transaction ID or idempotency key
 *         example: "demo-001"
 *     responses:
 *       200:
 *         description: Transaction found
 *       404:
 *         description: Transaction not found
 *       500:
 *         description: Internal server error
 */
app.get('/api/status/:id', async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[API Gateway] Fetching status for transaction ${id}`);
        const response = await axios.get(
            `${TRANSACTION_SERVICE_URL}/transaction/${id}`
        );
        res.status(response.status).json(response.data);
    } catch (error) {
        console.error('[API Gateway] Error fetching transaction status:', error.message);
        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({
                error: 'Transaction Service unavailable',
                message: error.message
            });
        }
    }
});

// START THE SERVER
app.listen(PORT, () => {
    console.log(`[API Gateway] Running on port ${PORT}`);
    console.log(`[API Gateway] Transaction Service URL: ${TRANSACTION_SERVICE_URL}`);
    console.log(`[API Gateway] Ledger Service URL: ${LEDGER_SERVICE_URL}`);
    console.log(`[API Gateway] Swagger UI available at http://localhost:${PORT}/api-docs`);
});

module.exports = app;
