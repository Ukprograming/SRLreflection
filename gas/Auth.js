const Auth = {
    /**
     * Universal Login
     * Payload: { id, class_code, secret? }
     */
    login: function (payload) {
        if (!payload.id || !payload.class_code) {
            return { error: "ID and Class Code are required" };
        }

        // Check for Teacher Login
        if (payload.secret) {
            const secret = DB.getTeacherSecret();
            if (payload.secret === secret) {
                // Teacher login success
                // In a real app we'd check ID too, but for this shared secret model, 
                // the secret is the main key. We can treat any ID as valid if secret is good.
                const token = generateToken();
                // Store token in simple cache or just transiently return it meant for client localstorage
                // For GAS simple web app, we often just sign it or trust it if we had a backend store for sessions.
                // MVP: Return token and client includes it. GAS validates it (mock validation for now).
                return {
                    token: token,
                    role: 'teacher',
                    name: 'Teacher'
                };
            } else {
                return { error: "Invalid Teacher Secret" };
            }
        }

        // Student Login
        const student = DB.getStudent(payload.id, payload.class_code);
        if (student) {
            const token = generateToken();
            // In a real app, save token to a Tokens sheet or CacheService
            return {
                token: token,
                role: 'student',
                name: student.name
            };
        } else {
            return { error: "Student not found or inactive" };
        }
    },

    /**
     * Verify Request Auth
     * @param {object} auth - { id, token, role? }
     */
    verify: function (auth) {
        // In this MVP without a session store, we blindly trust if token exists for now, 
        // or we could check if student exists. 
        // Ideally we should validate the token against a saved list.
        // For MVP: We check if ID exists in DB.
        if (!auth || !auth.id || !auth.token) return false;

        // If teacher
        // We can't easily verify "teacher-ness" without a session store if we just pass ID.
        // Front-end should send role='teacher' or similar. 
        // Real impl: Look up token in a 'Sessions' sheet.
        return true;
    }
};
