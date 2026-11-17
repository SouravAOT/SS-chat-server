const jwt = require("jsonwebtoken");
const { pool } = require("../db");

function setupCalls(io) {

    io.on("connection", (socket) => {

        const userId = Number(socket.user.id);
        const userCode = socket.user.user_code;

        function sendError(callback, message) {
            callback?.({
                success: false,
                message
            });
        }

        // START CALL

        socket.on("call_start", async (data, callback) => {
            try {
                const receiverCode = data?.receiver_code;
                const callType = data?.call_type;

                if (
                    typeof receiverCode !== "string" ||
                    !["voice", "video"].includes(callType)
                ) {
                    return sendError(callback, "Invalid call request");
                }

                const receiver = await pool.query(
                    `SELECT id, user_code, username
                     FROM users
                     WHERE user_code = $1
                     AND is_active = TRUE`,
                    [receiverCode.trim().toUpperCase()]
                );

                if (!receiver.rows.length) {
                    return sendError(callback, "User not found");
                }

                const receiverId = Number(receiver.rows[0].id);

                if (receiverId === userId) {
                    return sendError(callback, "Cannot call yourself");
                }

                const active = await pool.query(
                    `SELECT id
                     FROM calls
                     WHERE status = 'ringing'
                     AND (
                        caller_id = $1
                        OR receiver_id = $1
                        OR caller_id = $2
                        OR receiver_id = $2
                     )`,
                    [userId, receiverId]
                );

                if (active.rows.length) {
                    return sendError(callback, "User is busy");
                }

                const result = await pool.query(
                    `INSERT INTO calls
                        (caller_id, receiver_id, call_type, status)
                     VALUES ($1, $2, $3, 'ringing')
                     RETURNING id, started_at`,
                    [
                        userId,
                        receiverId,
                        callType
                    ]
                );

                const call = result.rows[0];

                io.to(`user_${receiverId}`).emit(
                    "call_incoming",
                    {
                        call_id: call.id,
                        caller_id: userId,
                        caller_code: userCode,
                        caller_name: socket.user.username || userCode,
                        call_type: callType,
                        started_at: call.started_at
                    }
                );

                callback?.({
                    success: true,
                    call_id: call.id,
                    status: "ringing"
                });

            } catch (error) {
                console.error("Call start error:", error);
                sendError(callback, "Unable to start call");
            }
        });

        // ACCEPT CALL

        socket.on("call_accept", async (data, callback) => {
            try {
                const callId = Number(data?.call_id);

                if (!Number.isSafeInteger(callId) || callId < 1) {
                    return sendError(callback, "Invalid call");
                }

                const result = await pool.query(
                    `UPDATE calls
                     SET status = 'accepted',
                         answered_at = NOW()
                     WHERE id = $1
                     AND receiver_id = $2
                     AND status = 'ringing'
                     RETURNING caller_id, receiver_id`,
                    [
                        callId,
                        userId
                    ]
                );

                if (!result.rows.length) {
                    return sendError(callback, "Call unavailable");
                }

                const call = result.rows[0];

                socket.join(`call_${callId}`);

                io.to(`user_${call.caller_id}`).emit(
                    "call_accepted",
                    {
                        call_id: callId,
                        receiver_id: userId
                    }
                );

                callback?.({
                    success: true,
                    call_id: callId
                });

            } catch (error) {
                console.error("Call accept error:", error);
                sendError(callback, "Unable to accept call");
            }
        });

        // REJECT CALL

        socket.on("call_reject", async (data, callback) => {
            try {
                const callId = Number(data?.call_id);

                const result = await pool.query(
                    `UPDATE calls
                     SET status = 'rejected',
                         ended_at = NOW()
                     WHERE id = $1
                     AND receiver_id = $2
                     AND status = 'ringing'
                     RETURNING caller_id`,
                    [
                        callId,
                        userId
                    ]
                );

                if (!result.rows.length) {
                    return sendError(callback, "Call unavailable");
                }

                io.to(`user_${result.rows[0].caller_id}`).emit(
                    "call_rejected",
                    {
                        call_id: callId
                    }
                );

                callback?.({
                    success: true
                });

            } catch (error) {
                console.error("Call reject error:", error);
                sendError(callback, "Unable to reject call");
            }
        });

        // END CALL

        socket.on("call_end", async (data, callback) => {
            try {
                const callId = Number(data?.call_id);

                const result = await pool.query(
                    `UPDATE calls
                     SET status = 'ended',
                         ended_at = NOW()
                     WHERE id = $1
                     AND (caller_id = $2 OR receiver_id = $2)
                     AND status IN ('ringing', 'accepted')
                     RETURNING caller_id, receiver_id`,
                    [
                        callId,
                        userId
                    ]
                );

                if (!result.rows.length) {
                    return sendError(callback, "Call unavailable");
                }

                const call = result.rows[0];

                io.to(`user_${call.caller_id}`).emit(
                    "call_ended",
                    {
                        call_id: callId
                    }
                );

                io.to(`user_${call.receiver_id}`).emit(
                    "call_ended",
                    {
                        call_id: callId
                    }
                );

                callback?.({
                    success: true
                });

            } catch (error) {
                console.error("Call end error:", error);
                sendError(callback, "Unable to end call");
            }
        });

        // WEBRTC SIGNALING

        async function relaySignal(eventName, data, callback) {
            try {
                const callId = Number(data?.call_id);

                if (!Number.isSafeInteger(callId) || callId < 1) {
                    return sendError(callback, "Invalid call");
                }

                const result = await pool.query(
                    `SELECT caller_id, receiver_id
                     FROM calls
                     WHERE id = $1
                     AND status = 'accepted'
                     AND (caller_id = $2 OR receiver_id = $2)`,
                    [
                        callId,
                        userId
                    ]
                );

                if (!result.rows.length) {
                    return sendError(callback, "Call not active");
                }

                const call = result.rows[0];

                const otherId =
                    Number(call.caller_id) === userId
                        ? Number(call.receiver_id)
                        : Number(call.caller_id);

                io.to(`user_${otherId}`).emit(
                    eventName,
                    {
                        call_id: callId,
                        sender_id: userId,
                        payload: data.payload
                    }
                );

                callback?.({
                    success: true
                });

            } catch (error) {
                console.error("Call signalling error:", error);
                sendError(callback, "Signalling failed");
            }
        }

        socket.on("webrtc_offer", (data, callback) => {
            relaySignal("webrtc_offer", data, callback);
        });

        socket.on("webrtc_answer", (data, callback) => {
            relaySignal("webrtc_answer", data, callback);
        });

        socket.on("webrtc_ice_candidate", (data, callback) => {
            relaySignal("webrtc_ice_candidate", data, callback);
        });

    });
}

module.exports = setupCalls;
