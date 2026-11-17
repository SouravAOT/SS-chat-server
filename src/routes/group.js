const express = require("express");
const { pool } = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

router.use(authenticate);

// CREATE GROUP

router.post("/", async (req, res) => {
    const client = await pool.connect();

    try {
        const { name, description, member_codes } = req.body || {};

        if (
            typeof name !== "string" ||
            name.trim().length < 2 ||
            name.trim().length > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid group name"
            });
        }

        if (
            !Array.isArray(member_codes) ||
            member_codes.length > 100
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid group members"
            });
        }

        await client.query("BEGIN");

        const groupResult = await client.query(
            `INSERT INTO chat_groups
                (name, description, created_by)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [
                name.trim(),
                typeof description === "string"
                    ? description.slice(0, 500)
                    : null,
                req.user.id
            ]
        );

        const group = groupResult.rows[0];

        const codes = [
            ...new Set([
                req.user.user_code,
                ...member_codes
                    .filter(code => typeof code === "string")
                    .map(code => code.trim().toUpperCase())
            ])
        ];

        for (const code of codes) {
            const userResult = await client.query(
                `SELECT id FROM users
                 WHERE user_code = $1
                 AND is_active = TRUE`,
                [code]
            );

            if (userResult.rows.length) {
                const userId = userResult.rows[0].id;

                await client.query(
                    `INSERT INTO group_members
                        (group_id, user_id, role)
                     VALUES ($1, $2, $3)
                     ON CONFLICT (group_id, user_id)
                     DO NOTHING`,
                    [
                        group.id,
                        userId,
                        Number(userId) === Number(req.user.id)
                            ? "admin"
                            : "member"
                    ]
                );
            }
        }

        await client.query("COMMIT");

        res.status(201).json({
            success: true,
            group
        });

    } catch (error) {
        await client.query("ROLLBACK");

        console.error("Create group error:", error);

        res.status(500).json({
            success: false,
            message: "Group creation failed"
        });

    } finally {
        client.release();
    }
});

// LIST MY GROUPS

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                g.id,
                g.name,
                g.description,
                g.avatar_url,
                g.created_by,
                g.created_at,
                gm.role
             FROM chat_groups g
             JOIN group_members gm
                ON gm.group_id = g.id
             WHERE gm.user_id = $1
             ORDER BY g.created_at DESC`,
            [req.user.id]
        );

        res.json({
            success: true,
            groups: result.rows
        });

    } catch (error) {
        console.error("List groups error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load groups"
        });
    }
});

// GROUP MEMBERS

router.get("/:id/members", async (req, res) => {
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
             WHERE group_id = $1 AND user_id = $2`,
            [groupId, req.user.id]
        );

        if (!membership.rows.length) {
            return res.status(403).json({
                success: false,
                message: "You are not a group member"
            });
        }

        const result = await pool.query(
            `SELECT
                u.user_code,
                u.username,
                u.avatar_url,
                gm.role,
                gm.joined_at
             FROM group_members gm
             JOIN users u ON u.id = gm.user_id
             WHERE gm.group_id = $1
             ORDER BY gm.joined_at`,
            [groupId]
        );

        res.json({
            success: true,
            members: result.rows
        });

    } catch (error) {
        console.error("Group members error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load members"
        });
    }
});

// ADD MEMBER

router.post("/:id/members", async (req, res) => {
    try {
        const groupId = Number(req.params.id);
        const { user_code } = req.body || {};

        if (
            !Number.isSafeInteger(groupId) ||
            groupId < 1 ||
            typeof user_code !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid request"
            });
        }

        const admin = await pool.query(
            `SELECT role
             FROM group_members
             WHERE group_id = $1
             AND user_id = $2`,
            [groupId, req.user.id]
        );

        if (
            !admin.rows.length ||
            admin.rows[0].role !== "admin"
        ) {
            return res.status(403).json({
                success: false,
                message: "Only group admins can add members"
            });
        }

        const user = await pool.query(
            `SELECT id FROM users
             WHERE user_code = $1
             AND is_active = TRUE`,
            [user_code.trim().toUpperCase()]
        );

        if (!user.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        await pool.query(
            `INSERT INTO group_members
                (group_id, user_id)
             VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [groupId, user.rows[0].id]
        );

        res.json({
            success: true,
            message: "Member added"
        });

    } catch (error) {
        console.error("Add member error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to add member"
        });
    }
});

// LEAVE GROUP

router.delete("/:id/leave", async (req, res) => {
    try {
        const groupId = Number(req.params.id);

        if (!Number.isSafeInteger(groupId) || groupId < 1) {
            return res.status(400).json({
                success: false,
                message: "Invalid group ID"
            });
        }

        const result = await pool.query(
            `DELETE FROM group_members
             WHERE group_id = $1
             AND user_id = $2
             RETURNING id`,
            [groupId, req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Group membership not found"
            });
        }

        res.json({
            success: true,
            message: "You left the group"
        });

    } catch (error) {
        console.error("Leave group error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to leave group"
        });
    }
});

module.exports = router;
