/**
 * Generate a UUID-like string.
 */
function uuid() {
    return Utilities.getUuid();
}

/**
 * Generate a simple random token.
 */
function generateToken() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Format error response.
 */
function errorResponse(msg) {
    return { error: msg };
}

/**
 * Format success response.
 */
function successResponse(data) {
    return { status: 'success', data: data };
}
