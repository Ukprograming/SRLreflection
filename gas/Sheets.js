/**
 * Sheets.js - Database Abstraction Layer
 * Handles all interactions with the Google Spreadsheet.
 */

const SHEET_NAMES = {
    META: 'Meta',
    STUDENTS: 'Students',
    REFLECTIONS: 'Reflections',
    FEEDBACK: 'Feedback',
    CODES: 'Codes'
};

/**
 * Helper to get a sheet by name.
 */
function getSheet(name) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        // Auto-create if missing (mostly for setup)
        sheet = ss.insertSheet(name);
    }
    return sheet;
}

/**
 * Generic function to get all rows as objects.
 * Assumes the first row is headers.
 */
function getRows(sheetName) {
    const sheet = getSheet(sheetName);
    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return [];

    const headers = data[0];
    const rows = data.slice(1);

    return rows.map(row => {
        let obj = {};
        headers.forEach((h, i) => {
            obj[h] = row[i];
        });
        return obj;
    });
}

/**
 * Generic function to add a row.
 * @param {string} sheetName 
 * @param {object} dataObj - Keys must match headers
 */
function addRow(sheetName, dataObj) {
    const sheet = getSheet(sheetName);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

    const row = headers.map(h => {
        // Convert dates to string or keep as object depending on need
        // Here we assume simple values or JSON strings
        return dataObj.hasOwnProperty(h) ? dataObj[h] : '';
    });

    sheet.appendRow(row);
}

/**
 * Initialize the spreadsheet structure.
 * Can be run manually by the user to set up the sheet.
 */
function setupSpreadsheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Meta
    const metaSheet = getSheet(SHEET_NAMES.META);
    if (metaSheet.getLastColumn() === 0) {
        metaSheet.appendRow(['key', 'value']);
        metaSheet.appendRow(['teacher_secret', 'teacher123']); // Default secret
        metaSheet.appendRow(['default_questions', JSON.stringify([
            { id: 'q1', type: 'scale', label: '今日の集中度は？', min: 1, max: 5 },
            { id: 'q2', type: 'text', label: 'わかったことは？' }
        ])]);
    }

    // 2. Students
    const studentSheet = getSheet(SHEET_NAMES.STUDENTS);
    if (studentSheet.getLastColumn() === 0) {
        studentSheet.appendRow(['student_id', 'name', 'class_code', 'active']);
        // Sample Data
        studentSheet.appendRow(['S1001', '山田 太郎', 'CLASS_A', true]);
        studentSheet.appendRow(['S1002', '佐藤 花子', 'CLASS_A', true]);
    }

    // 3. Reflections
    const reflectionSheet = getSheet(SHEET_NAMES.REFLECTIONS);
    if (reflectionSheet.getLastColumn() === 0) {
        reflectionSheet.appendRow(['reflection_id', 'student_id', 'class_date', 'submission_time', 'content_json', 'feedback_read']);
    }

    // 4. Feedback
    const feedbackSheet = getSheet(SHEET_NAMES.FEEDBACK);
    if (feedbackSheet.getLastColumn() === 0) {
        feedbackSheet.appendRow(['feedback_id', 'reflection_id', 'teacher_comment', 'highlights_json', 'updated_at']);
    }

    // 5. Codes
    const codeSheet = getSheet(SHEET_NAMES.CODES);
    if (codeSheet.getLastColumn() === 0) {
        codeSheet.appendRow(['code_id', 'category', 'label', 'color']);
        codeSheet.appendRow(['PLAN_01', 'Planning', '目標設定', '#FFCDD2']);
        codeSheet.appendRow(['MON_01', 'Monitoring', '理解度確認', '#C8E6C9']);
    }
}

const DB = {
    getStudent: (id, classCode) => {
        const students = getRows(SHEET_NAMES.STUDENTS);
        return students.find(s => s.student_id == id && s.class_code == classCode && s.active);
    },

    getTeacherSecret: () => {
        const meta = getRows(SHEET_NAMES.META);
        const row = meta.find(m => m.key === 'teacher_secret');
        return row ? row.value : null;
    },

    getAllStudents: () => {
        return getRows(SHEET_NAMES.STUDENTS);
    },

    submitReflection: (data) => {
        // data: { reflection_id, student_id, class_date, content_json, ... }
        data.submission_time = new Date();
        data.feedback_read = false; // default
        // Force class_date to be string to avoid auto-conversion if possible, 
        // but 'YYYY-MM-DD' usually stays string unless user edits.
        // If we want to be safe: data.class_date = "'" + data.class_date; 
        // But read-side fix is better.
        addRow(SHEET_NAMES.REFLECTIONS, data);
    },

    getReflectionsByStudent: (studentId) => {
        const all = getRows(SHEET_NAMES.REFLECTIONS);
        const filtered = all.filter(r => r.student_id === studentId);
        // Normalize dates for frontend
        return filtered.map(r => {
            if (r.class_date instanceof Date) {
                r.class_date = Utilities.formatDate(r.class_date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            }
            return r;
        }).reverse();
    },

    getReflectionsByDate: (dateStr) => {
        const all = getRows(SHEET_NAMES.REFLECTIONS);
        // Fix: Handle Date objects from Sheets
        return all.filter(r => {
            let d = r.class_date;
            if (d instanceof Date) {
                // Convert to YYYY-MM-DD in local time (or UTC? Sheets usually local)
                // Using Utilities.formatDate is best in GAS
                d = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            }
            return d === dateStr;
        });
    },

    getFeedback: (reflectionId) => {
        const all = getRows(SHEET_NAMES.FEEDBACK);
        return all.find(f => f.reflection_id === reflectionId);
    },

    saveFeedback: (data) => {
        // upsert logic is tricky with appendRow.
        // For MVP, we might just append and read the latest one, 
        // OR we iterate to update.
        const sheet = getSheet(SHEET_NAMES.FEEDBACK);
        const rows = sheet.getDataRange().getValues();
        // Headers row 0
        let rowIndex = -1;
        // Find existing
        for (let i = 1; i < rows.length; i++) {
            if (rows[i][1] === data.reflection_id) { // reflection_id is index 1
                rowIndex = i + 1; // 1-based
                break;
            }
        }

        const timestamp = new Date();
        const headers = rows[0];

        if (rowIndex > 0) {
            // Update
            // We need to map data to columns order
            const rowData = headers.map(h => {
                if (h === 'updated_at') return timestamp;
                return data.hasOwnProperty(h) ? data[h] : rows[rowIndex - 1][headers.indexOf(h)];
            });
            sheet.getRange(rowIndex, 1, 1, headers.length).setValues([rowData]);
        } else {
            // Insert
            data.updated_at = timestamp;
            addRow(SHEET_NAMES.FEEDBACK, data);
        }
    },

    getCodes: () => {
        return getRows(SHEET_NAMES.CODES);
    },

    getQuestions: () => {
        // Check for next_questions override in Meta
        // Otherwise return default
        const meta = getRows(SHEET_NAMES.META);
        const override = meta.find(m => m.key === 'next_questions');
        if (override && override.value) {
            return JSON.parse(override.value);
        }
        const def = meta.find(m => m.key === 'default_questions');
        return def ? JSON.parse(def.value) : [];
    }
};
