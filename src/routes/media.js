const express = require("express");

const authenticate = require("../middleware/auth");

const {
    upload,
    handleUploadError
} = require("../middleware/upload");

const {
    cloudinary,
    uploadBuffer
} = require("../config/cloudinary");

const { pool } = require("../db");

const router = express.Router();

router.use(authenticate);

// UPLOAD CHAT MEDIA

router.post(
    "/upload",
    upload.single("file"),
    handleUploadError,
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({
                    success: false,
                    message: "File is required"
                });
            }

            const isVideo =
                req.file.mimetype.startsWith("video/");

            const result = await uploadBuffer(
                req.file.buffer,
                {
                    resource_type: isVideo ? "video" : "image",
                    folder: "ss-chat/messages"
                }
            );

            res.status(201).json({
                success: true,
                media: {
                    url: result.secure_url,
                    public_id: result.public_id,
                    resource_type: result.resource_type,
                    format: result.format,
                    size: result.bytes,
                    original_name: req.file.originalname
                }
            });

        } catch (error) {
            console.error("Media upload error:", error);

            res.status(500).json({
                success: false,
                message: "Media upload failed"
            });
        }
    }
);

// UPLOAD PROFILE IMAGE

router.post(
    "/profile",
    upload.single("file"),
    handleUploadError,
    async (req, res) => {
        try {
            if (
                !req.file ||
                !req.file.mimetype.startsWith("image/")
            ) {
                return res.status(400).json({
                    success: false,
                    message: "A profile image is required"
                });
            }

            const oldProfile = await pool.query(
                `SELECT avatar_url
                 FROM users
                 WHERE id = $1`,
                [req.user.id]
            );

            const result = await uploadBuffer(
                req.file.buffer,
                {
                    resource_type: "image",
                    folder: "ss-chat/profiles",
                    transformation: [
                        {
                            width: 512,
                            height: 512,
                            crop: "limit"
                        }
                    ]
                }
            );

            await pool.query(
                `UPDATE users
                 SET avatar_url = $1,
                     updated_at = NOW()
                 WHERE id = $2`,
                [
                    result.secure_url,
                    req.user.id
                ]
            );

            res.json({
                success: true,
                avatar_url: result.secure_url,
                public_id: result.public_id
            });

        } catch (error) {
            console.error("Profile upload error:", error);

            res.status(500).json({
                success: false,
                message: "Profile image upload failed"
            });
        }
    }
);

// DELETE CLOUDINARY MEDIA

router.delete("/delete", async (req, res) => {
    try {
        const { public_id, resource_type } = req.body || {};

        if (
            typeof public_id !== "string" ||
            !public_id.startsWith("ss-chat/")
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid media identifier"
            });
        }

        const mediaType = resource_type === "video"
            ? "video"
            : "image";

        const result = await pool.query(
            `SELECT id
             FROM messages
             WHERE media_public_id = $1
             AND sender_id = $2`,
            [
                public_id,
                req.user.id
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({
                success: false,
                message: "Media not found or not owned by you"
            });
        }

        await cloudinary.uploader.destroy(
            public_id,
            {
                resource_type: mediaType
            }
        );

        res.json({
            success: true,
            message: "Media deleted"
        });

    } catch (error) {
        console.error("Media deletion error:", error);

        res.status(500).json({
            success: false,
            message: "Media deletion failed"
        });
    }
});

module.exports = router;
