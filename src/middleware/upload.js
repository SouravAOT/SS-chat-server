const multer = require("multer");

const maxSize =
    Number(process.env.MAX_UPLOAD_SIZE_MB || 50) *
    1024 *
    1024;

const allowedTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime"
];

const upload = multer({
    storage: multer.memoryStorage(),

    limits: {
        fileSize: maxSize,
        files: 1
    },

    fileFilter: (req, file, callback) => {
        if (!allowedTypes.includes(file.mimetype)) {
            return callback(
                new Error("Unsupported file type")
            );
        }

        callback(null, true);
    }
});

function handleUploadError(error, req, res, next) {
    if (!error) {
        return next();
    }

    if (error instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: error.code === "LIMIT_FILE_SIZE"
                ? "File size exceeds upload limit"
                : "Upload error"
        });
    }

    return res.status(400).json({
        success: false,
        message: error.message || "Invalid upload"
    });
}

module.exports = {
    upload,
    handleUploadError
};
