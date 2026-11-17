const express = require("express");

const { pool } = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

// PRIVATE CHAT HISTORY

router.get("/private/:code", async (req, res) => {
    try {
        const receiverCode = req.params.code
            .trim()
            .toUpperCase();

        const receiver = await pool.query(
            `SELECT id
             FROM users
             WHERE user_code = $1
             AND is_active = TRUE`,
            [receiverCode]
        );

        if (!receiver.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        const receiverId = Number(receiver.rows[0].id);

        const limit = Math.min(
            Math.max(Number(req.query.limit) || 50, 1),
            100
        );

        const result = await pool.query(
            `SELECT
                m.id AS message_id,
                m.sender_id,
                sender.user_code AS sender_code,
                m.receiver_id,
                receiver.user_code AS receiver_code,
                m.message,
                m.message_type,
                m.media_url,
                m.media_name,
                m.media_size,
                m.is_delivered,
                m.delivered_at,
                m.is_read,
                m.read_at,
                m.created_at
             FROM messages m
             JOIN users sender
                ON sender.id = m.sender_id
             JOIN users receiver
                ON receiver.id = m.receiver_id
             WHERE (
                (m.sender_id = $1 AND m.receiver_id = $2)
                OR
                (m.sender_id = $2 AND m.receiver_id = $1)
             )
             AND m.expires_at > NOW()
             ORDER BY m.created_at DESC
             LIMIT $3`,
            [
                req.user.id,
                receiverId,
                limit
            ]
        );

        res.json({
            success: true,
            messages: result.rows.reverse()
        });

    } catch (error) {
        console.error("Private history error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load chat history"
        });
    }
});

// GROUP CHAT HISTORY

router.get("/group/:id", async (req, res) => {
    try {
        const groupId = Number(req.params.id);

        if (!Number.isSafeInteger(groupId) || groupId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid group ID"
            });
        }

        const membership = await pool.query(
            `SELECT id
             FROM group_members
             WHERE group_id = $1
             AND user_id = $2`,
            [
                groupId,
                req.user.id
            ]
        );

        if (!membership.rows.length) {
            return res.status(403).json({
                success: false,
                message: "You are not a group member"
            });
        }

        const limit = Math.min(
            Math.max(Number(req.query.limit) || 50, 1),
            100
        );

        const result = await pool.query(
            `SELECT
                m.id AS message_id,
                m.group_id,
                m.sender_id,
                u.user_code AS sender_code,
                u.username AS sender_name,
                m.message,
                m.message_type,
                m.media_url,
                m.media_name,
                m.created_at
             FROM messages m
             JOIN users u ON u.id = m.sender_id
             WHERE m.group_id = $1
             AND m.expires_at > NOW()
             ORDER BY m.created_at DESC
             LIMIT $2`,
            [
                groupId,
                limit
            ]
        );

        res.json({
            success: true,
            messages: result.rows.reverse()
        });

    } catch (error) {
        console.error("Group history error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load group history"
        });
    }
});

module.exports = router;
