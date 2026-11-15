const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,

    ssl: process.env.DATABASE_URL?.includes("localhost")
        ? false
        : { rejectUnauthorized: false }
});

async function initializeDatabase() {
    const sql = fs.readFileSync(
        path.join(__dirname, "database.sql"),
        "utf8"
    );

    await pool.query(sql);

    console.log("Database connected successfully");
}

module.exports = {
    pool,
    initializeDatabase
};
