const jwt = require("jsonwebtoken");

const { pool } = require("../db");

function setupChat(io) {

    // SOCKET AUTHENTICATION

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth.token;

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET
            );

            socket.user = decoded;

            next();

        } catch (error) {
            next(new Error("Authentication failed"));
        }
    });


    io.on("connection", async (socket) => {

        const userId = socket.user.id;

        console.log("User connected:", socket.user.user_code);

        socket.join(`user_${userId}`);


        // DELIVER PENDING MESSAGES

        try {
            const pending = await pool.query(
                `SELECT id, sender_id, message, created_at
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
                    created_at: msg.created_at
                });

                await pool.query(
                    `UPDATE messages
                     SET is_delivered = TRUE
                     WHERE id = $1`,
                    [msg.id]
                );
            }

        } catch (error) {
            console.error("Pending message error:", error);
        }


        // SEND MESSAGE

        socket.on("send_message", async (data, callback) => {

            try {
                const { receiver_code, message } = data || {};

                if (
                    typeof receiver_code !== "string" ||
                    typeof message !== "string" ||
                    !message.trim() ||
                    message.length > 5000
                ) {
                    return callback?.({
                        success: false,
                        message: "Invalid message"
                    });
                }

                const receiver = await pool.query(
                    `SELECT id, user_code
                     FROM users
                     WHERE user_code = $1`,
                    [receiver_code.toUpperCase()]
                );

                if (!receiver.rows.length) {
                    return callback?.({
                        success: false,
                        message: "Receiver not found"
                    });
                }

                const receiverId = receiver.rows[0].id;

                if (Number(receiverId) === Number(userId)) {
                    return callback?.({
                        success: false,
                        message: "Cannot message yourself"
                    });
                }


                // SAVE TEMPORARILY

                const result = await pool.query(
                    `INSERT INTO messages
                     (sender_id, receiver_id, message)
                     VALUES ($1, $2, $3)
                     RETURNING id, created_at`,
                    [
                        userId,
                        receiverId,
                        message.trim()
                    ]
                );

                const savedMessage = result.rows[0];


                // DELIVER TO RECEIVER

                const receiverSockets = await io
                    .in(`user_${receiverId}`)
                    .fetchSockets();

                if (receiverSockets.length > 0) {

                    io.to(`user_${receiverId}`).emit(
                        "receive_message",
                        {
                            message_id: savedMessage.id,
                            sender_id: userId,
                            sender_code: socket.user.user_code,
                            message: message.trim(),
                            created_at: savedMessage.created_at
                        }
                    );

                    await pool.query(
                        `UPDATE messages
                         SET is_delivered = TRUE
                         WHERE id = $1`,
                        [savedMessage.id]
                    );
                }


                callback?.({
                    success: true,
                    message_id: savedMessage.id,
                    delivered: receiverSockets.length > 0
                });

            } catch (error) {

                console.error("Send message error:", error);

                callback?.({
                    success: false,
                    message: "Message sending failed"
                });
            }
        });


        // DISCONNECT

        socket.on("disconnect", () => {
            console.log(
                "User disconnected:",
                socket.user.user_code
            );
        });

    });
}

module.exports = setupChat;
