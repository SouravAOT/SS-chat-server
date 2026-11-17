const express = require("express");

const { pool } = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

// CALL HISTORY

router.get("/history", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                c.id,
                c.call_type,
                c.status,
                c.started_at,
                c.answered_at,
                c.ended_at,
                caller.user_code AS caller_code,
                caller.username AS caller_name,
                receiver.user_code AS receiver_code,
                receiver.username AS receiver_name
             FROM calls c
             JOIN users caller ON caller.id = c.caller_id
             JOIN users receiver ON receiver.id = c.receiver_id
             WHERE c.caller_id = $1
                OR c.receiver_id = $1
             ORDER BY c.started_at DESC
             LIMIT 100`,
            [req.user.id]
        );

        res.json({
            success: true,
            calls: result.rows
        });

    } catch (error) {
        console.error("Call history error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load call history"
        });
    }
});

module.exports = router;
