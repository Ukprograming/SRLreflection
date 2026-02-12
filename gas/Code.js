// GAS Backend Code

function doGet(e) {
    return ContentService.createTextOutput("SRL Reflection API is running.");
}

function doPost(e) {
    let output = {};

    try {
        const data = JSON.parse(e.postData.contents);
        const action = data.action;
        const payload = data.payload || {};
        const auth = data.auth || {};

        // Allow login without auth
        if (action === 'login') {
            output = Auth.login(payload);
        }
        else {
            // Validate Auth for other requests
            if (!Auth.verify(auth)) {
                throw new Error("Unauthorized");
            }

            switch (action) {
                // Student Actions
                case 'student/getQuestions':
                    output = StudentAPI.getQuestions();
                    break;
                case 'student/submitReflection':
                    output = StudentAPI.submitReflection(auth, payload);
                    break;
                case 'student/getHistory':
                    output = StudentAPI.getHistory(auth);
                    break;
                case 'student/getUnreadFeedback':
                    output = StudentAPI.getUnreadFeedback(auth);
                    break;
                case 'student/markFeedbackRead':
                    output = StudentAPI.markFeedbackRead(auth, payload);
                    break;

                // Teacher Actions
                case 'teacher/getDashboard':
                    output = TeacherAPI.getDashboard(payload);
                    break;
                case 'teacher/getStudentCard':
                    output = TeacherAPI.getStudentCard(payload);
                    break;
                case 'teacher/saveFeedback':
                    output = TeacherAPI.saveFeedback(payload);
                    break;
                case 'teacher/getCodes':
                    output = TeacherAPI.getCodes();
                    break;
                case 'teacher/setNextQuestions':
                    output = TeacherAPI.setNextQuestions(payload);
                    break;

                default:
                    throw new Error("Unknown Action: " + action);
            }
        }
    } catch (err) {
        console.error(err);
        output = { error: err.toString() };
    }

    return ContentService.createTextOutput(JSON.stringify(output))
        .setMimeType(ContentService.MimeType.JSON);
}

const StudentAPI = {
    getQuestions: () => {
        return { questions: DB.getQuestions() };
    },

    submitReflection: (auth, payload) => {
        // payload: { date, content }
        if (!payload.date || !payload.content) throw new Error("Missing data");

        // Check if already submitted for this date? 
        // MVP: Allow multiple or overwrite? Let's just append.

        const id = Utilities.getUuid();
        DB.submitReflection({
            reflection_id: id,
            student_id: auth.id,
            class_date: payload.date,
            content_json: JSON.stringify(payload.content)
        });

        return { success: true, id: id };
    },

    getHistory: (auth) => {
        const reflections = DB.getReflectionsByStudent(auth.id);
        // Enrich with feedback status and codes summary
        // This could be heavy if many rows, but MVP ok.
        const history = reflections.map(r => {
            const fb = DB.getFeedback(r.reflection_id);

            let codes = [];
            if (fb && fb.highlights_json) {
                try {
                    const highlights = JSON.parse(fb.highlights_json);
                    codes = highlights.map(h => h.code_id);
                } catch (e) { }
            }

            return {
                reflection_id: r.reflection_id,
                date: r.class_date,
                content: r.content_json, // raw json string
                has_feedback: !!fb,
                feedback_read: r.feedback_read,
                codes: codes
            };
        });
        return { history: history };
    },

    getUnreadFeedback: (auth) => {
        // Find reflections where feedback exists and !feedback_read
        const reflections = DB.getReflectionsByStudent(auth.id);
        const unread = [];

        reflections.forEach(r => {
            if (r.feedback_read === false || r.feedback_read === 'false') {
                const fb = DB.getFeedback(r.reflection_id);
                if (fb) {
                    unread.push({
                        reflection_id: r.reflection_id,
                        date: r.class_date,
                        comment: fb.teacher_comment
                    });
                }
            }
        });
        return { unread: unread };
    },

    markFeedbackRead: (auth, payload) => {
        // payload: { reflection_ids: [] }
        // This requires updating the Reflections sheet.
        // DB abstraction needed for update.
        // Implementing a simple "markRead" in DB
        const sheet = getSheet(SHEET_NAMES.REFLECTIONS);
        const data = sheet.getDataRange().getValues();
        const ids = payload.reflection_ids || [];

        // index 0: reflection_id, index 5: feedback_read
        for (let i = 1; i < data.length; i++) {
            if (ids.includes(data[i][0])) {
                sheet.getRange(i + 1, 6).setValue(true);
            }
        }
        return { success: true };
    }
};

const TeacherAPI = {
    getDashboard: (payload) => {
        const date = payload.date;
        const students = DB.getAllStudents();

        // If date provided, check submission status
        let submissions = [];
        if (date) {
            submissions = DB.getReflectionsByDate(date);
        }

        const list = students.map(s => {
            const sub = submissions.find(r => r.student_id === s.student_id);
            return {
                student_id: s.student_id,
                name: s.name,
                submitted: !!sub,
                reflection_id: sub ? sub.reflection_id : null
            };
        });

        // distinct dates
        const allReflections = getRows(SHEET_NAMES.REFLECTIONS);
        const dates = [...new Set(allReflections.map(r => {
            let d = r.class_date;
            if (d instanceof Date) {
                d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            }
            return d;
        }))].sort().reverse();

        return { students: list, dates: dates };
    },

    getStudentCard: (payload) => {
        const studentId = payload.student_id;
        if (!studentId) throw new Error("Student ID required");

        // Get Student Info
        // Get all reflections
        const reflections = DB.getReflectionsByStudent(studentId);

        // For each reflection, get feedback/codes
        const history = reflections.map(r => {
            const fb = DB.getFeedback(r.reflection_id);
            return {
                ...r,
                feedback: fb
            };
        });

        // Get student details
        // const student = ... (if needed)

        return { history: history };
    },

    saveFeedback: (payload) => {
        // payload: { reflection_id, comment, highlights }
        // Save to Feedback sheet
        DB.saveFeedback({
            reflection_id: payload.reflection_id,
            teacher_comment: payload.comment || '',
            highlights_json: JSON.stringify(payload.highlights || [])
        });
        return { success: true };
    },

    getCodes: () => {
        return { codes: DB.getCodes() };
    },

    setNextQuestions: (payload) => {
        const questions = payload.questions; // array or null
        const sheet = getSheet(SHEET_NAMES.META);
        const data = sheet.getDataRange().getValues();
        let found = false;
        for (let i = 1; i < data.length; i++) {
            if (data[i][0] === 'next_questions') {
                sheet.getRange(i + 1, 2).setValue(JSON.stringify(questions));
                found = true;
                break;
            }
        }
        if (!found) {
            sheet.appendRow(['next_questions', JSON.stringify(questions)]);
        }
        return { success: true };
    }
};
