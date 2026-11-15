const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const { pool } = require("../db");

const router = express.Router();


// REGISTER

router.post("/register", async (req, res) => {
    try {
        const { username, email, password } = req.body;

        if (!username || !email || !password) {
            return res.status(400).json({
                success: false,
                message: "All fields are required"
            });
        }

        if (username.length > 50 || password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "Invalid username or password"
            });
        }

        const hashedPassword = await bcrypt.hash(
            password,
            12
        );

        const result = await pool.query(
            `INSERT INTO users (username, email, password)
             VALUES ($1, $2, $3)
             RETURNING id, user_code, username, email`,
            [
                username.trim(),
                email.trim().toLowerCase(),
                hashedPassword
            ]
        );

        const user = result.rows[0];

        const token = jwt.sign(
            { id: user.id, user_code: user.user_code },
            process.env.JWT_SECRET,
            { expiresIn: "30d" }
        );

        res.status(201).json({
            success: true,
            user,
            token
        });

    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({
                success: false,
                message: "Email already registered"
            });
        }

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Registration failed"
        });
    }
});


// LOGIN

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password required"
            });
        }

        const result = await pool.query(
            `SELECT * FROM users WHERE email = $1`,
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

        const token = jwt.sign(
            { id: user.id, user_code: user.user_code },
            process.env.JWT_SECRET,
            { expiresIn: "30d" }
        );

        res.json({
            success: true,

            user: {
                user_code: user.user_code,
                username: user.username,
                email: user.email
            },

            token
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Login failed"
        });
    }
});


// FIND USER

router.get("/user/:code", async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();

        const result = await pool.query(
            `SELECT user_code, username
             FROM users
             WHERE user_code = $1`,
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
        res.status(500).json({
            success: false,
            message: "Server error"
        });
    }
});

module.exports = router;
