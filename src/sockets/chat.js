const jwt = require("jsonwebtoken");
const { pool } = require("../db");

function setupChat(io) {

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token;

            if (!token) {
                return next(new Error("Authentication required"));
            }

            socket.user = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

            next();

        } catch (error) {
            next(new Error("Authentication failed"));
        }
    });

    io.on("connection", async (socket) => {

        const userId = Number(socket.user.id);
        const userCode = socket.user.user_code;

        const userRoom = `user_${userId}`;

        socket.join(userRoom);

        console.log("User connected:", userCode);

        // ONLINE STATUS

        socket.broadcast.emit("user_online", {
            user_code: userCode
        });

        // JOIN GROUP ROOMS

        try {
            const groups = await pool.query(
                `SELECT group_id
                 FROM group_members
                 WHERE user_id = $1`,
                [userId]
            );

            groups.rows.forEach((group) => {
                socket.join(`group_${group.group_id}`);
            });

        } catch (error) {
            console.error("Group room error:", error);
        }

        // OFFLINE MESSAGE DELIVERY

        try {
            const pending = await pool.query(
                `SELECT
                    id,
                    sender_id,
                    message,
                    message_type,
                    media_url,
                    created_at
                 FROM messages
                 WHERE receiver_id = $1
                 AND is_delivered = FALSE
                 AND expires_at > NOW()
                 ORDER BY created_at ASC`,
                [userId]
            );

            for (const msg of pending.rows) {

                socket.emit("receive_message", {
                    message_id: msg.id,
                    sender_id: msg.sender_id,
                    message: msg.message,
                    message_type: msg.message_type,
                    media_url: msg.media_url,
                    created_at: msg.created_at
                });

                await pool.query(
                    `UPDATE messages
                     SET is_delivered = TRUE,
                         delivered_at = NOW()
                     WHERE id = $1`,
                    [msg.id]
                );

                io.to(`user_${msg.sender_id}`).emit(
                    "message_delivered",
                    {
                        message_id: msg.id,
                        receiver_id: userId
                    }
                );
            }

        } catch (error) {
            console.error("Pending messages error:", error);
        }

        // SEND PRIVATE MESSAGE

        socket.on("send_message", async (data, callback) => {
            try {
                const {
                    receiver_code,
                    message,
                    message_type = "text",
                    media_url = null,
                    media_public_id = null,
                    media_name = null,
                    media_size = null
                } = data || {};

                if (
                    typeof receiver_code !== "string" ||
                    !["text", "image", "video"].includes(message_type) ||
                    (
                        message_type === "text" &&
                        (
                            typeof message !== "string" ||
                            !message.trim() ||
                            message.length > 5000
                        )
                    ) ||
                    (
                        message_type !== "text" &&
                        (
                            typeof media_url !== "string" ||
                            !media_url.startsWith("https://")
                        )
                    )
                ) {
                    return callback?.({
                        success: false,
                        message: "Invalid message"
                    });
                }

                const receiver = await pool.query(
                    `SELECT id, user_code
                     FROM users
                     WHERE user_code = $1
                     AND is_active = TRUE`,
                    [receiver_code.trim().toUpperCase()]
                );

                if (!receiver.rows.length) {
                    return callback?.({
                        success: false,
                        message: "Receiver not found"
                    });
                }

                const receiverId = Number(receiver.rows[0].id);

                if (receiverId === userId) {
                    return callback?.({
                        success: false,
                        message: "Cannot message yourself"
                    });
                }

                const result = await pool.query(
                    `INSERT INTO messages (
                        sender_id,
                        receiver_id,
                        message,
                        message_type,
                        media_url,
                        media_public_id,
                        media_name,
                        media_size
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                    RETURNING id, created_at`,
                    [
                        userId,
                        receiverId,
                        message_type === "text" ? message.trim() : null,
                        message_type,
                        media_url,
                        media_public_id,
                        media_name,
                        media_size
                    ]
                );

                const saved = result.rows[0];

                const payload = {
                    message_id: saved.id,
                    sender_id: userId,
                    sender_code: userCode,
                    receiver_id: receiverId,
                    message: message_type === "text" ? message.trim() : null,
                    message_type,
                    media_url,
                    media_name,
                    created_at: saved.created_at
                };

                const receiverSockets = await io
                    .in(`user_${receiverId}`)
                    .fetchSockets();

                if (receiverSockets.length > 0) {

                    io.to(`user_${receiverId}`).emit(
                        "receive_message",
                        payload
                    );

                    await pool.query(
                        `UPDATE messages
                         SET is_delivered = TRUE,
                             delivered_at = NOW()
                         WHERE id = $1`,
                        [saved.id]
                    );

                    io.to(userRoom).emit(
                        "message_delivered",
                        {
                            message_id: saved.id,
                            receiver_id: receiverId
                        }
                    );
                }

                callback?.({
                    success: true,
                    message_id: saved.id,
                    delivered: receiverSockets.length > 0,
                    created_at: saved.created_at
                });

            } catch (error) {
                console.error("Send message error:", error);

                callback?.({
                    success: false,
                    message: "Message sending failed"
                });
            }
        });

        // JOIN GROUP

        socket.on("join_group", async (data, callback) => {
            try {
                const groupId = Number(data?.group_id);

                if (!Number.isSafeInteger(groupId) || groupId < 1) {
                    return callback?.({
                        success: false,
                        message: "Invalid group"
                    });
                }

                const member = await pool.query(
                    `SELECT id
                     FROM group_members
                     WHERE group_id = $1
                     AND user_id = $2`,
                    [groupId, userId]
                );

                if (!member.rows.length) {
                    return callback?.({
                        success: false,
                        message: "Not a group member"
                    });
                }

                socket.join(`group_${groupId}`);

                callback?.({
                    success: true
                });

            } catch (error) {
                callback?.({
                    success: false,
                    message: "Unable to join group"
                });
            }
        });

        // SEND GROUP MESSAGE

        socket.on("send_group_message", async (data, callback) => {
            try {
                const groupId = Number(data?.group_id);
                const message = data?.message;

                if (
                    !Number.isSafeInteger(groupId) ||
                    groupId < 1 ||
                    typeof message !== "string" ||
                    !message.trim() ||
                    message.length > 5000
                ) {
                    return callback?.({
                        success: false,
                        message: "Invalid group message"
                    });
                }

                const member = await pool.query(
                    `SELECT id
                     FROM group_members
                     WHERE group_id = $1
                     AND user_id = $2`,
                    [groupId, userId]
                );

                if (!member.rows.length) {
                    return callback?.({
                        success: false,
                        message: "Not a group member"
                    });
                }

                const saved = await pool.query(
                    `INSERT INTO messages (
                        sender_id,
                        receiver_id,
                        group_id,
                        message,
                        message_type
                    )
                    VALUES ($1, NULL, $2, $3, 'text')
                    RETURNING id, created_at`,
                    [
                        userId,
                        groupId,
                        message.trim()
                    ]
                );

                const payload = {
                    message_id: saved.rows[0].id,
                    group_id: groupId,
                    sender_id: userId,
                    sender_code: userCode,
                    message: message.trim(),
                    message_type: "text",
                    created_at: saved.rows[0].created_at
                };

                io.to(`group_${groupId}`).emit(
                    "receive_group_message",
                    payload
                );

                callback?.({
                    success: true,
                    message_id: saved.rows[0].id
                });

            } catch (error) {
                console.error("Group message error:", error);

                callback?.({
                    success: false,
                    message: "Group message failed"
                });
            }
        });

        // TYPING STATUS

        socket.on("typing", async (data) => {
            try {
                const receiverCode = data?.receiver_code;

                if (typeof receiverCode !== "string") return;

                const result = await pool.query(
                    `SELECT id FROM users WHERE user_code = $1`,
                    [receiverCode.trim().toUpperCase()]
                );

                if (!result.rows.length) return;

                const receiverId = Number(result.rows[0].id);

                io.to(`user_${receiverId}`).emit("typing", {
                    sender_code: userCode
                });

            } catch (error) {
                console.error("Typing error:", error);
            }
        });

        socket.on("stop_typing", async (data) => {
            try {
                const receiverCode = data?.receiver_code;

                if (typeof receiverCode !== "string") return;

                const result = await pool.query(
                    `SELECT id FROM users WHERE user_code = $1`,
                    [receiverCode.trim().toUpperCase()]
                );

                if (!result.rows.length) return;

                io.to(`user_${result.rows[0].id}`).emit(
                    "stop_typing",
                    {
                        sender_code: userCode
                    }
                );

            } catch (error) {
                console.error("Stop typing error:", error);
            }
        });

        // MARK MESSAGE AS READ

        socket.on("mark_read", async (data, callback) => {
            try {
                const messageId = Number(data?.message_id);

                if (!Number.isSafeInteger(messageId) || messageId < 1) {
                    return callback?.({
                        success: false,
                        message: "Invalid message ID"
                    });
                }

                const result = await pool.query(
                    `UPDATE messages
                     SET is_read = TRUE,
                         is_delivered = TRUE,
                         delivered_at = COALESCE(delivered_at, NOW()),
                         read_at = NOW()
                     WHERE id = $1
                     AND receiver_id = $2
                     RETURNING sender_id`,
                    [
                        messageId,
                        userId
                    ]
                );

                if (!result.rows.length) {
                    return callback?.({
                        success: false,
                        message: "Message not found"
                    });
                }

                io.to(`user_${result.rows[0].sender_id}`).emit(
                    "message_read",
                    {
                        message_id: messageId,
                        reader_id: userId
                    }
                );

                callback?.({
                    success: true
                });

            } catch (error) {
                callback?.({
                    success: false,
                    message: "Unable to mark message read"
                });
            }
        });

        // DISCONNECT

        socket.on("disconnect", () => {
            console.log("User disconnected:", userCode);

            socket.broadcast.emit("user_offline", {
                user_code: userCode
            });
        });

    });
}

module.exports = setupChat;
