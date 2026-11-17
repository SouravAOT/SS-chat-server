const cloudinary = require("cloudinary").v2;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

function checkCloudinaryConfig() {
    const required = [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET"
    ];

    const missing = required.filter(
        (key) => !process.env[key]
    );

    if (missing.length > 0) {
        throw new Error(
            `Missing Cloudinary variables: ${missing.join(", ")}`
        );
    }
}

function uploadBuffer(buffer, options = {}) {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                resource_type: options.resourceType || "auto",
                folder: options.folder || "ss-chat",
                ...options
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }

                resolve(result);
            }
        );

        stream.end(buffer);
    });
}

module.exports = {
    cloudinary,
    checkCloudinaryConfig,
    uploadBuffer
};
