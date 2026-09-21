// TRANSACTION SERVICE - ITERATION 2
// This service processes payment transactions and EMITS events
// to RabbitMQ for asynchronous ledger recording.

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const amqp = require('amqplib');

// CHANGED: axios REMOVED in Iteration 2
// In Iteration 1, we used axios to call Ledger Service via HTTP.
// In Iteration 2, we ONLY use RabbitMQ for communication.

// Shared event definitions
const {
    PAYMENT_REQUESTED,
    PAYMENT_COMPLETED,
    PAYMENT_FAILED,
    LEDGER_UPDATED
} = require('../events');

dotenv.config();

const app = express();
const PORT = process.env.TRANSACTION_SERVICE_PORT || 3001;

// CHANGED: LEDGER_SERVICE_URL is NO LONGER USED
// In Iteration 2, we do NOT call Ledger Service directly.
// Instead, we publish events to RabbitMQ.
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

// In-memory store (for prototype purposes)
const transactions = new Map();

// MIDDLEWARE
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`[Transaction Service] ${req.method} ${req.path}`);
    next();
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'transaction-service',
        timestamp: new Date().toISOString(),
        transactions: transactions.size
    });
});

// PROCESS PAYMENT ENDPOINT
// CHANGED: In Iteration 2, this endpoint publishes events to RabbitMQ
// instead of calling Ledger Service via HTTP.
app.post('/transaction/process', async (req, res) => {
    try {
        const { userId, amount, idempotencyKey } = req.body;
        
        console.log(`[Transaction Service] Processing payment: userId=${userId}, amount=${amount}, idempotencyKey=${idempotencyKey}`);
        
        // Validate required fields
        if (!userId || !amount || !idempotencyKey) {
            return res.status(400).json({
                error: 'Missing required fields',
                fields: { userId, amount, idempotencyKey }
            });
        }
        
        // IDEMPOTENCY CHECK 
        if (transactions.has(idempotencyKey)) {
            console.log(`[Transaction Service] Duplicate request detected: ${idempotencyKey}`);
            return res.status(409).json({
                error: 'Duplicate transaction',
                message: 'This transaction has already been processed',
                transaction: transactions.get(idempotencyKey)
            });
        }
        
        // CREATE TRANSACTION RECORD (UNCHANGED)
        const transactionId = uuidv4();
        const status = 'completed';
        const timestamp = new Date().toISOString();
        
        const transaction = {
            transactionId,
            userId,
            amount: parseFloat(amount),
            status,
            timestamp,
            idempotencyKey
        };
        
        transactions.set(idempotencyKey, transaction);
        
        console.log(`[Transaction Service] Transaction created: ${transactionId}`);
        
        // PUBLISH EVENT TO RABBITMQ (NON-BLOCKING)
        console.log(`[Transaction Service] Publishing payment.completed event for ${transactionId}`);
        await publishEvent(PAYMENT_COMPLETED, {
            transactionId,
            userId,
            amount: parseFloat(amount),
            timestamp,
            idempotencyKey
        });
        
        // IMMEDIATE RESPONSE (NON-BLOCKING)
        res.status(201).json({
            status: 'success',
            transaction,
            message: 'Transaction processed successfully (async)'
        });
        
    } catch (error) {
        console.error('[Transaction Service] Error processing transaction:', error.message);
        res.status(500).json({
            error: 'Transaction processing failed',
            message: error.message
        });
    }
});

// GET TRANSACTION ENDPOINT (UNCHANGED)
app.get('/transaction/:id', (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[Transaction Service] Fetching transaction: ${id}`);
        
        let foundTransaction = null;
        for (const [key, value] of transactions) {
            if (value.transactionId === id || key === id) {
                foundTransaction = value;
                break;
            }
        }
        
        if (!foundTransaction) {
            return res.status(404).json({
                error: 'Transaction not found',
                message: `No transaction found with id: ${id}`
            });
        }
        
        res.status(200).json({
            status: 'success',
            transaction: foundTransaction
        });
        
    } catch (error) {
        console.error('[Transaction Service] Error fetching transaction:', error.message);
        res.status(500).json({
            error: 'Failed to fetch transaction',
            message: error.message
        });
    }
});

// RABBITMQ EVENT PUBLISHER (UNCHANGED)
async function publishEvent(eventType, payload) {
    let connection = null;
    let channel = null;
    
    try {
        console.log(`[Transaction Service] Publishing event: ${eventType}`);
        
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        
        await channel.assertExchange('payment_events', 'topic', { durable: true });
        
        const message = {
            eventType,
            payload,
            timestamp: new Date().toISOString(),
            correlationId: uuidv4()
        };
        
        channel.publish(
            'payment_events',
            eventType,
            Buffer.from(JSON.stringify(message)),
            { persistent: true }
        );
        
        console.log(`[Transaction Service] Event published successfully: ${eventType}`);
        
        await channel.close();
        await connection.close();
        
    } catch (error) {
        console.error(`[Transaction Service] Failed to publish event ${eventType}:`, error.message);
        if (channel) await channel.close();
        if (connection) await connection.close();
        throw error;
    }
}

// START SERVER (UNCHANGED)
app.listen(PORT, () => {
    console.log(`[Transaction Service] Running on port ${PORT}`);
    console.log(`[Transaction Service] RabbitMQ URL: ${RABBITMQ_URL}`);
    console.log(`[Transaction Service] Ready to process transactions (Iteration 2 - Async)`);
});

module.exports = { app, publishEvent, transactions };