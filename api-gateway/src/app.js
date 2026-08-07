// API GATEWAY SERVICE
// This service acts as the single entry point for all client requests.
// It routes incoming requests to the appropriate backend services.

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const PORT = process.env.API_GATEWAY_PORT || 3000;

const TRANSACTION_SERVICE_URL = process.env.TRANSACTION_SERVICE_URL || 'http://localhost:3001';
const LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:3002';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`[API Gateway] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'api-gateway',
        timestamp: new Date().toISOString()
    });
});

// Process payment
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

// Get transaction status
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

// Start server
app.listen(PORT, () => {
    console.log(`[API Gateway] Running on port ${PORT}`);
    console.log(`[API Gateway] Transaction Service URL: ${TRANSACTION_SERVICE_URL}`);
    console.log(`[API Gateway] Ledger Service URL: ${LEDGER_SERVICE_URL}`);
});

module.exports = app;