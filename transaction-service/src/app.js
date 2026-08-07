// ============================================
// TRANSACTION SERVICE
// ============================================
// This service processes payment transactions and emits events
// to RabbitMQ for asynchronous ledger recording.
// ============================================

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const amqp = require('amqplib');
const axios = require('axios');

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

const LEDGER_SERVICE_URL = process.env.LEDGER_SERVICE_URL || 'http://localhost:3002';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

// In-memory store (for prototype purposes)
const transactions = new Map();

// Middleware
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

// Process payment
app.post('/transaction/process', async (req, res) => {
    try {
        const { userId, amount, idempotencyKey } = req.body;
        
        console.log(`[Transaction Service] Processing payment: userId=${userId}, amount=${amount}, idempotencyKey=${idempotencyKey}`);
        
        if (!userId || !amount || !idempotencyKey) {
            return res.status(400).json({
                error: 'Missing required fields',
                fields: { userId, amount, idempotencyKey }
            });
        }
        
        // Idempotency check
        if (transactions.has(idempotencyKey)) {
            console.log(`[Transaction Service] Duplicate request detected: ${idempotencyKey}`);
            return res.status(409).json({
                error: 'Duplicate transaction',
                message: 'This transaction has already been processed',
                transaction: transactions.get(idempotencyKey)
            });
        }
        
        // Create transaction record
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
        
        // Publish event to RabbitMQ
        await publishEvent(PAYMENT_COMPLETED, {
            transactionId,
            userId,
            amount: parseFloat(amount),
            timestamp,
            idempotencyKey
        });
        
        res.status(201).json({
            status: 'success',
            transaction,
            message: 'Transaction processed successfully'
        });
        
    } catch (error) {
        console.error('[Transaction Service] Error processing transaction:', error.message);
        res.status(500).json({
            error: 'Transaction processing failed',
            message: error.message
        });
    }
});

// Get transaction
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

// RabbitMQ event publisher
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

// Start server
app.listen(PORT, () => {
    console.log(`[Transaction Service] Running on port ${PORT}`);
    console.log(`[Transaction Service] Ledger Service URL: ${LEDGER_SERVICE_URL}`);
    console.log(`[Transaction Service] RabbitMQ URL: ${RABBITMQ_URL}`);
    console.log(`[Transaction Service] Ready to process transactions`);
});

module.exports = { app, publishEvent, transactions };