const jwt = require("jsonwebtoken");

function authenticate(req, res, next) {
    const header = req.headers.authorization;

    if (
        !header ||
        !header.startsWith("Bearer ")
    ) {
        return res.status(401).json({
            success: false,
            message: "Authentication required"
        });
    }

    const token = header.substring(7).trim();

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Token missing"
        });
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        if (!decoded.id) {
            return res.status(401).json({
                success: false,
                message: "Invalid authentication token"
            });
        }

        req.user = decoded;

        next();

    } catch (error) {
        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
}

module.exports = authenticate;
