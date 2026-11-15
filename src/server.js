require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { Server } = require("socket.io");

const {
    pool,
    initializeDatabase
} = require("./db");

const authRoutes = require("./routes/auth");
const setupChat = require("./sockets/chat");

const app = express();

const server = http.createServer(app);


// SECURITY

app.use(helmet());

app.use(cors({
    origin: process.env.CLIENT_URL || "*"
}));

app.use(express.json({
    limit: "10kb"
}));

app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200
}));


// SOCKET.IO

const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || "*",
        methods: ["GET", "POST"]
    },

    transports: ["websocket", "polling"]
});


// ROUTES

app.get("/", (req, res) => {
    res.json({
        success: true,
        name: "SS Chat Server",
        status: "Online"
    });
});

app.use("/api/auth", authRoutes);


// CHAT SYSTEM

setupChat(io);


// AUTOMATIC MESSAGE CLEANUP

async function deleteExpiredMessages() {
    try {
        const result = await pool.query(
            `DELETE FROM messages
             WHERE expires_at <= NOW()`
        );

        if (result.rowCount > 0) {
            console.log(
                "Expired messages deleted:",
                result.rowCount
            );
        }

    } catch (error) {
        console.error("Message cleanup error:", error);
    }
}


// START SERVER

async function startServer() {

    try {

        if (!process.env.DATABASE_URL) {
            throw new Error("DATABASE_URL is missing");
        }

        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing");
        }

        await initializeDatabase();

        // Cleanup every 5 minutes

        await deleteExpiredMessages();

        setInterval(
            deleteExpiredMessages,
            5 * 60 * 1000
        );

        const PORT = process.env.PORT || 3000;

        server.listen(PORT, "0.0.0.0", () => {
            console.log(
                `SS Chat Server running on port ${PORT}`
            );
        });

    } catch (error) {

        console.error("Server startup failed:", error);

        process.exit(1);
    }
}

startServer();
