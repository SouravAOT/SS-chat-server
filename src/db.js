const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is missing");
}

const isLocalDatabase =
    process.env.DATABASE_URL.includes("localhost") ||
    process.env.DATABASE_URL.includes("127.0.0.1");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: isLocalDatabase
        ? false
        : {
            rejectUnauthorized: false
        },

    max: 10,

    idleTimeoutMillis: 30000,

    connectionTimeoutMillis: 10000
});

pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL error:", error);
});

async function initializeDatabase() {
    const sqlPath = path.join(
        __dirname,
        "database.sql"
    );

    const sql = fs.readFileSync(
        sqlPath,
        "utf8"
    );

    await pool.query(sql);

    console.log("PostgreSQL database initialized");
}

async function checkDatabase() {
    const result = await pool.query(
        "SELECT NOW() AS current_time"
    );

    return result.rows[0];
}

module.exports = {
    pool,
    initializeDatabase,
    checkDatabase
};
