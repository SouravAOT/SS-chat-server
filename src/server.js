require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const { Server } = require("socket.io");

const {
    pool,
    initializeDatabase,
    checkDatabase
} = require("./db");

const {
    checkCloudinaryConfig
} = require("./config/cloudinary");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const mediaRoutes = require("./routes/media");
const groupRoutes = require("./routes/groups");
const callRoutes = require("./routes/calls");

const setupChat = require("./sockets/chat");
const setupCalls = require("./sockets/calls");

const app = express();
const server = http.createServer(app);

const allowedOrigins = (
    process.env.CLIENT_URL || "*"
).split(",").map(origin => origin.trim());

const corsOptions = {
    origin: (origin, callback) => {
        if (
            !origin ||
            allowedOrigins.includes("*") ||
            allowedOrigins.includes(origin)
        ) {
            return callback(null, true);
        }

        callback(new Error("Origin not allowed"));
    },

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],

    allowedHeaders: [
        "Content-Type",
        "Authorization"
    ]
};

// SECURITY

app.use(helmet());

app.use(cors(corsOptions));

app.use(express.json({
    limit: "1mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "1mb"
}));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false
});

app.use("/api", apiLimiter);

// SOCKET.IO

const io = new Server(server, {
    cors: {
        origin: corsOptions.origin,
        methods: ["GET", "POST"]
    },

    transports: [
        "websocket",
        "polling"
    ],

    maxHttpBufferSize: 1e6
});

// HEALTH CHECK

app.get("/", async (req, res) => {
    try {
        const database = await checkDatabase();

        res.json({
            success: true,
            name: "SS Chat Server",
            version: "2.0.0",
            status: "Online",
            database: "Connected",
            timestamp: database.current_time
        });

    } catch (error) {
        res.status(503).json({
            success: false,
            name: "SS Chat Server",
            status: "Database unavailable"
        });
    }
});

// API ROUTES

app.use("/api/auth", authRoutes);

app.use("/api/users", userRoutes);

app.use("/api/media", mediaRoutes);

app.use("/api/groups", groupRoutes);

app.use("/api/calls", callRoutes);

// SOCKET SYSTEMS

setupChat(io);

setupCalls(io);

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
        console.error(
            "Message cleanup error:",
            error
        );
    }
}

// CLEANUP INTERVAL

let cleanupInterval;

// ERROR HANDLER

app.use((error, req, res, next) => {
    console.error("Server error:", error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        success: false,
        message: "Internal server error"
    });
});

// START SERVER

async function startServer() {
    try {
        if (!process.env.JWT_SECRET) {
            throw new Error("JWT_SECRET is missing");
        }

        if (process.env.JWT_SECRET.length < 32) {
            throw new Error(
                "JWT_SECRET must contain at least 32 characters"
            );
        }

        checkCloudinaryConfig();

        await initializeDatabase();

        await checkDatabase();

        await deleteExpiredMessages();

        cleanupInterval = setInterval(
            deleteExpiredMessages,
            5 * 60 * 1000
        );

        const PORT = Number(process.env.PORT || 3000);

        server.listen(PORT, "0.0.0.0", () => {
            console.log(
                `SS Chat Server running on port ${PORT}`
            );

            console.log("Database: Connected");
            console.log("Cloudinary: Configured");
            console.log("Socket.IO: Ready");
        });

    } catch (error) {
        console.error(
            "Server startup failed:",
            error
        );

        process.exit(1);
    }
}

// GRACEFUL SHUTDOWN

async function shutdown() {
    console.log("Shutting down SS Chat Server...");

    if (cleanupInterval) {
        clearInterval(cleanupInterval);
    }

    server.close(async () => {
        await pool.end();
        process.exit(0);
    });

    setTimeout(() => {
        process.exit(1);
    }, 10000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startServer();
