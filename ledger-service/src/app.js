// LEDGER SERVICE - ITERATION 2
// This service records transactions in the ledger.
// It CONSUMES events from RabbitMQ instead of receiving HTTP calls.

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const amqp = require('amqplib');
const { Pool } = require('pg');

// Shared event definitions
const {
    PAYMENT_REQUESTED,
    PAYMENT_COMPLETED,
    PAYMENT_FAILED,
    LEDGER_UPDATED
} = require('../events');

dotenv.config();

const app = express();
const PORT = process.env.LEDGER_SERVICE_PORT || 3002;

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@postgres:5432/ledgerdb';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672';

// PostgreSQL connection pool
const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
    console.log(`[Ledger Service] ${req.method} ${req.path}`);
    next();
});

// HEALTH CHECK ENDPOINT (UNCHANGED)
app.get('/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({
            status: 'ok',
            service: 'ledger-service',
            database: 'connected',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'unhealthy',
            service: 'ledger-service',
            database: 'disconnected',
            error: error.message
        });
    }
});

// USER VALIDATION ENDPOINT (UNCHANGED)
app.get('/users/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        console.log(`[Ledger Service] Checking user: ${userId}`);
        
        const result = await pool.query(
            'SELECT id, balance FROM users WHERE id = $1',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'User not found',
                message: `User ${userId} does not exist`
            });
        }
        
        res.status(200).json({
            status: 'success',
            user: result.rows[0]
        });
        
    } catch (error) {
        console.error('[Ledger Service] Error fetching user:', error.message);
        res.status(500).json({
            error: 'Failed to fetch user',
            message: error.message
        });
    }
});

// RECORD LEDGER ENTRY FUNCTION
// CHANGED: In Iteration 2, this function is called by the RabbitMQ consumer
// instead of by an HTTP endpoint.
async function recordLedgerEntry(transactionData) {
    const client = await pool.connect();
    try {
        const { transactionId, userId, amount, timestamp, idempotencyKey } = transactionData;
        
        console.log(`[Ledger Service] Recording ledger entry for transaction ${transactionId}`);
        
        await client.query('BEGIN');
        
        const transactionResult = await client.query(
            `INSERT INTO transactions (id, user_id, amount, status, idempotency_key, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [transactionId, userId, amount, 'completed', idempotencyKey, timestamp]
        );
        
        await client.query(
            `INSERT INTO ledger_entries (transaction_id, account, amount, entry_type)
             VALUES ($1, $2, $3, $4)`,
            [transactionId, 'user_account', amount, 'debit']
        );
        
        await client.query(
            `UPDATE users SET balance = balance - $1 WHERE id = $2`,
            [amount, userId]
        );
        
        await client.query('COMMIT');
        
        console.log(`[Ledger Service] Ledger entry recorded successfully for ${transactionId}`);
        
        return transactionResult.rows[0];
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('[Ledger Service] Failed to record ledger entry:', error.message);
        throw error;
    } finally {
        client.release();
    }
}

// RABBITMQ EVENT CONSUMER
// CHANGED: In Iteration 2, Ledger Service CONSUMES events from RabbitMQ
// instead of exposing an HTTP endpoint.
async function consumeEvents() {
    let connection = null;
    let channel = null;
    
    try {
        console.log('[Ledger Service] Connecting to RabbitMQ...');
        connection = await amqp.connect(RABBITMQ_URL);
        channel = await connection.createChannel();
        
        await channel.assertExchange('payment_events', 'topic', { durable: true });
        
        const queue = await channel.assertQueue('ledger_queue', { durable: true });
        
        await channel.bindQueue(queue.queue, 'payment_events', PAYMENT_COMPLETED);
        
        console.log(`[Ledger Service] Listening for events: ${PAYMENT_COMPLETED}`);
        
        await channel.consume(queue.queue, async (msg) => {
            if (msg) {
                try {
                    const content = JSON.parse(msg.content.toString());
                    console.log(`[Ledger Service] Received event: ${content.eventType}`);
                    
                    if (content.eventType === PAYMENT_COMPLETED) {
                        // RECORD LEDGER ENTRY (ASYNC)
                        // In Iteration 2, this is the ONLY way Ledger Service
                        // receives transaction data.
                        await recordLedgerEntry(content.payload);
                    }
                    
                    channel.ack(msg);
                    
                } catch (error) {
                    console.error('[Ledger Service] Error processing event:', error.message);
                    channel.nack(msg, false, true);
                }
            }
        }, { noAck: false });
        
    } catch (error) {
        console.error('[Ledger Service] RabbitMQ consumer error:', error.message);
        setTimeout(consumeEvents, 5000);
    }
}

// INITIALIZE DATABASE SCHEMA (UNCHANGED)
async function initializeDatabase() {
    try {
        console.log('[Ledger Service] Initializing database schema...');
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                balance DECIMAL(15, 2) DEFAULT 0.00,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS transactions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                user_id UUID NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                idempotency_key VARCHAR(255) UNIQUE NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        `);
        
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ledger_entries (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                transaction_id UUID NOT NULL,
                account VARCHAR(50) NOT NULL,
                amount DECIMAL(15, 2) NOT NULL,
                entry_type VARCHAR(10) CHECK (entry_type IN ('debit', 'credit')),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (transaction_id) REFERENCES transactions(id)
            )
        `);
        
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id)`);
        
        await pool.query(`
            INSERT INTO users (id, balance) 
            VALUES ('11111111-1111-1111-1111-111111111111', 10000.00) 
            ON CONFLICT (id) DO NOTHING
        `);
        
        console.log('[Ledger Service] Database schema initialized successfully');
    } catch (error) {
        console.error('[Ledger Service] Database initialization failed:', error.message);
        throw error;
    }
}

// START SERVER
async function startServer() {
    try {
        await initializeDatabase();
        await consumeEvents();
        
        app.listen(PORT, () => {
            console.log(`[Ledger Service] Running on port ${PORT}`);
            console.log(`[Ledger Service] Database connected`);
            console.log(`[Ledger Service] RabbitMQ connected`);
            console.log(`[Ledger Service] Ready to consume events (Iteration 2 - Async)`);
        });
        
    } catch (error) {
        console.error('[Ledger Service] Failed to start:', error.message);
        process.exit(1);
    }
}

startServer();

process.on('SIGTERM', async () => {
    console.log('[Ledger Service] Shutting down...');
    await pool.end();
    process.exit(0);
});

module.exports = { app, pool, recordLedgerEntry };