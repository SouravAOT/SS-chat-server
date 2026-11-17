const express = require("express");

const { pool } = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

// UPDATE PROFILE

router.put("/profile", async (req, res) => {
    try {
        const { username, bio } = req.body || {};

        if (
            username !== undefined &&
            (
                typeof username !== "string" ||
                username.trim().length < 2 ||
                username.trim().length > 50
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid username"
            });
        }

        if (
            bio !== undefined &&
            (
                typeof bio !== "string" ||
                bio.length > 500
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid bio"
            });
        }

        const result = await pool.query(
            `UPDATE users
             SET
                username = COALESCE($1, username),
                bio = COALESCE($2, bio),
                updated_at = NOW()
             WHERE id = $3
             RETURNING
                id,
                user_code,
                username,
                email,
                avatar_url,
                bio`,
            [
                username === undefined ? null : username.trim(),
                bio === undefined ? null : bio,
                req.user.id
            ]
        );

        res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Profile update error:", error);

        res.status(500).json({
            success: false,
            message: "Profile update failed"
        });
    }
});

// SEARCH USERS

router.get("/search", async (req, res) => {
    try {
        const query = String(req.query.q || "")
            .trim()
            .replace(/[%_]/g, "");

        if (query.length < 2) {
            return res.status(400).json({
                success: false,
                message: "Enter at least 2 characters"
            });
        }

        const result = await pool.query(
            `SELECT
                id,
                user_code,
                username,
                avatar_url
             FROM users
             WHERE id <> $1
             AND is_active = TRUE
             AND (
                user_code ILIKE $2
                OR username ILIKE $2
             )
             ORDER BY username
             LIMIT 30`,
            [
                req.user.id,
                `%${query}%`
            ]
        );

        res.json({
            success: true,
            users: result.rows
        });

    } catch (error) {
        console.error("User search error:", error);

        res.status(500).json({
            success: false,
            message: "User search failed"
        });
    }
});

module.exports = router;
