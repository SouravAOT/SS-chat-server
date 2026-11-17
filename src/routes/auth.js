const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../db");
const authenticate = require("../middleware/auth");

const router = express.Router();

function createToken(user) {
    return jwt.sign(
        {
            id: user.id,
            user_code: user.user_code
        },
        process.env.JWT_SECRET,
        {
            expiresIn: process.env.JWT_EXPIRES_IN || "30d"
        }
    );
}

// REGISTER

router.post("/register", async (req, res) => {
    try {
        let { username, email, password } = req.body || {};

        if (
            typeof username !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        username = username.trim();
        email = email.trim().toLowerCase();

        if (
            username.length < 2 ||
            username.length > 50 ||
            password.length < 8 ||
            email.length > 255
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid username, email or password"
            });
        }

        const hashedPassword = await bcrypt.hash(
            password,
            12
        );

        const result = await pool.query(
            `INSERT INTO users
                (username, email, password)
             VALUES ($1, $2, $3)
             RETURNING
                id,
                user_code,
                username,
                email,
                avatar_url,
                created_at`,
            [
                username,
                email,
                hashedPassword
            ]
        );

        const user = result.rows[0];

        res.status(201).json({
            success: true,
            user,
            token: createToken(user)
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });
        }

        console.error("Registration error:", error);

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
});

// LOGIN

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                success: false,
                message: "Email and password required"
            });
        }

        const result = await pool.query(
            `SELECT *
             FROM users
             WHERE email = $1
             AND is_active = TRUE`,
            [email.trim().toLowerCase()]
        );

        if (!result.rows.length) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = result.rows[0];

        const valid = await bcrypt.compare(
            password,
            user.password
        );

        if (!valid) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        res.json({
            success: true,

            user: {
                id: user.id,
                user_code: user.user_code,
                username: user.username,
                email: user.email,
                avatar_url: user.avatar_url,
                bio: user.bio
            },

            token: createToken(user)
        });

    } catch (error) {
        console.error("Login error:", error);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});

// FIND USER

router.get("/user/:code", async (req, res) => {
    try {
        const code = req.params.code
            .trim()
            .toUpperCase();

        const result = await pool.query(
            `SELECT
                user_code,
                username,
                avatar_url,
                bio
             FROM users
             WHERE user_code = $1
             AND is_active = TRUE`,
            [code]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Find user error:", error);

        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

// CURRENT USER PROFILE

router.get("/me", authenticate, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                id,
                user_code,
                username,
                email,
                avatar_url,
                bio,
                created_at
             FROM users
             WHERE id = $1`,
            [req.user.id]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "User not found"
            });
        }

        res.json({
            success: true,
            user: result.rows[0]
        });

    } catch (error) {
        console.error("Profile error:", error);

        res.status(500).json({
            success: false,
            message: "Unable to load profile"
        });
    }
});

module.exports = router;
