// Teacher App Logic

const TeacherApp = {
    auth: null,
    currentDate: null,
    students: [],
    currentStudentIndex: 0,
    codes: [],
    currentReflection: null,
    currentHighlights: [],

    init: async () => {
        const savedAuth = localStorage.getItem('srl_teacher_auth');
        if (savedAuth) {
            TeacherApp.auth = JSON.parse(savedAuth);
            TeacherApp.showDashboard();
        } else {
            TeacherApp.showLogin();
        }

        document.getElementById('login-form').addEventListener('submit', TeacherApp.handleLogin);
        document.getElementById('logout-btn').addEventListener('click', TeacherApp.handleLogout);
        document.getElementById('date-select').addEventListener('change', (e) => TeacherApp.loadStudentList(e.target.value));
        document.getElementById('refresh-btn').addEventListener('click', () => TeacherApp.loadStudentList(TeacherApp.currentDate));

        document.getElementById('prev-student').addEventListener('click', () => TeacherApp.navigateStudent(-1));
        document.getElementById('next-student').addEventListener('click', () => TeacherApp.navigateStudent(1));

        document.getElementById('apply-code-btn').addEventListener('click', TeacherApp.applyCode);
        document.getElementById('save-feedback-btn').addEventListener('click', TeacherApp.saveFeedback);
        document.getElementById('set-next-questions-btn').addEventListener('click', TeacherApp.handleSetQuestions);

        // Listen for text selection
        document.addEventListener('selectionchange', TeacherApp.handleSelection);
    },

    handleSetQuestions: async () => {
        // Simple prompt for MVP. In real app, a modal with form builder.
        const input = prompt("次回授業用の設問JSONを入力してください (空欄でキャンセル, 'reset'でデフォルトに戻す):");
        if (input === null) return;

        let questions = null;
        if (input.toLowerCase() === 'reset') {
            questions = null;
        } else {
            try {
                questions = JSON.parse(input);
                if (!Array.isArray(questions)) throw new Error("配列形式である必要があります");
            } catch (e) {
                alert("JSON形式が正しくありません。\n例: [{\"id\":\"q1\",\"type\":\"text\",\"label\":\"質問\"}]");
                return;
            }
        }

        try {
            await apiRequest('teacher/setNextQuestions', { questions }, TeacherApp.auth);
            showToast('次回設問を保存しました');
        } catch (err) {
            showToast('保存失敗', 'error');
        }
    },

    showLogin: () => {
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
    },

    showDashboard: async () => {
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('hidden');

        // Load Codes
        const codeRes = await apiRequest('teacher/getCodes', {}, TeacherApp.auth);
        TeacherApp.codes = codeRes.codes;
        const codeSelect = document.getElementById('code-select');
        codeSelect.innerHTML = TeacherApp.codes.map(c => `<option value="${c.code_id}">${c.label}</option>`).join('');

        // Load Dates and Initial List
        await TeacherApp.loadDashboardData();
    },

    handleLogin: async (e) => {
        e.preventDefault();
        const id = document.getElementById('teacher-id').value.trim();
        const classCode = document.getElementById('class-code').value.trim();
        const secret = document.getElementById('teacher-secret').value.trim();

        try {
            const res = await apiRequest('login', { id, class_code: classCode, secret });
            TeacherApp.auth = { token: res.token, role: 'teacher', id: id }; // ID needed?
            localStorage.setItem('srl_teacher_auth', JSON.stringify(TeacherApp.auth));
            TeacherApp.showDashboard();
        } catch (err) {
            showToast(err.message, 'error');
        }
    },

    handleLogout: () => {
        localStorage.removeItem('srl_teacher_auth');
        location.reload();
    },

    loadDashboardData: async () => {
        try {
            const res = await apiRequest('teacher/getDashboard', {}, TeacherApp.auth);
            const dateSelect = document.getElementById('date-select');

            // Populate dates
            // Keep current selection if exists
            const current = dateSelect.value || (res.dates.length > 0 ? res.dates[0] : '');

            dateSelect.innerHTML = '<option value="">日付を選択...</option>' +
                res.dates.map(d => `<option value="${d}">${formatDate(d)}</option>`).join('');

            if (current) {
                dateSelect.value = current;
                TeacherApp.loadStudentList(current);
            }
        } catch (err) {
            showToast('ダッシュボードの読み込み失敗', 'error');
        }
    },

    loadStudentList: async (date) => {
        if (!date) return;
        TeacherApp.currentDate = date;

        try {
            const res = await apiRequest('teacher/getDashboard', { date }, TeacherApp.auth);
            // Filter only submitted for navigation? Or all?
            // Let's show all but highlight submitted
            TeacherApp.students = res.students; // List of { student_id, name, submitted, reflection_id }

            const listEl = document.getElementById('student-list');
            listEl.innerHTML = TeacherApp.students.map((s, idx) => `
                <div class="student-item ${s.submitted ? 'submitted' : ''} ${idx === TeacherApp.currentStudentIndex ? 'active' : ''}" 
                     onclick="TeacherApp.openStudent(${idx})">
                    <span>${s.name}</span>
                    <span>${s.submitted ? '✅' : '-'}</span>
                </div>
            `).join('');

        } catch (err) {
            console.error(err);
        }
    },

    openStudent: async (index) => {
        TeacherApp.currentStudentIndex = index;
        const student = TeacherApp.students[index];
        document.getElementById('student-name').textContent = student.name;

        // Update list UI active state
        document.querySelectorAll('.student-item').forEach((el, i) => {
            if (i === index) el.classList.add('active');
            else el.classList.remove('active');
        });

        document.getElementById('student-card').classList.remove('hidden');

        if (student.submitted && student.reflection_id) {
            await TeacherApp.loadStudentCard(student.student_id);
        } else {
            // Clear view
            document.getElementById('reflection-content').innerHTML = '<p>提出なし</p>';
            document.getElementById('feedback-text').value = '';
            TeacherApp.currentReflection = null;
            TeacherApp.currentHighlights = [];
        }
    },

    navigateStudent: (dir) => {
        let newIndex = TeacherApp.currentStudentIndex + dir;
        if (newIndex >= 0 && newIndex < TeacherApp.students.length) {
            TeacherApp.openStudent(newIndex);
        }
    },

    loadStudentCard: async (studentId) => {
        try {
            const res = await apiRequest('teacher/getStudentCard', { student_id: studentId }, TeacherApp.auth);

            // Find the reflection for the *current date*
            // The API returns history. We need to filter.
            const todayReflection = res.history.find(r => r.class_date === TeacherApp.currentDate);

            if (todayReflection) {
                TeacherApp.currentReflection = todayReflection;
                TeacherApp.renderReflectionContent(todayReflection);

                // Set existing feedback
                if (todayReflection.feedback) {
                    document.getElementById('feedback-text').value = todayReflection.feedback.teacher_comment || '';
                    if (todayReflection.feedback.highlights_json) {
                        TeacherApp.currentHighlights = JSON.parse(todayReflection.feedback.highlights_json);
                        TeacherApp.renderHighlights(); // Re-apply highlights
                    } else {
                        TeacherApp.currentHighlights = [];
                    }
                } else {
                    document.getElementById('feedback-text').value = '';
                    TeacherApp.currentHighlights = [];
                }

                // Render Chart
                TeacherApp.renderChart(res.history); // Use full history for chart

            } else {
                document.getElementById('reflection-content').textContent = "エラー: データが見つかりません";
            }
        } catch (err) {
            console.error(err);
            showToast('カルテ読み込みエラー', 'error');
        }
    },

    renderReflectionContent: (reflection) => {
        const container = document.getElementById('reflection-content');
        const content = JSON.parse(reflection.content_json);

        // Convert JSON content to HTML string
        let html = '';
        Object.entries(content).forEach(([k, v]) => {
            html += `<div class="q-block"><strong>${k}:</strong> <span class="text-body">${v}</span></div>`;
        });

        container.innerHTML = html;
    },

    handleSelection: () => {
        // Just checking selection exists?
    },

    applyCode: () => {
        if (!TeacherApp.currentReflection) return;

        const selection = window.getSelection();
        if (!selection.rangeCount) return;

        const range = selection.getRangeAt(0);
        const text = selection.toString();

        if (!text) return;

        // Check if selection is within reflection-content
        const container = document.getElementById('reflection-content');
        if (!container.contains(range.commonAncestorContainer)) {
            showToast('リフレクション本文を選択してください', 'error');
            return;
        }

        const codeId = document.getElementById('code-select').value;
        const code = TeacherApp.codes.find(c => c.code_id === codeId);

        // Create highlight object
        // NOTE: Exact positioning in rendered JSON HTML is hard.
        // Simplified approach: Wrap the range in a <mark> locally and store the text/context.
        // For distinct storage we need indices relative to the clean text, OR we just store the text and assume uniqueness?
        // Better: We store the "text" and "code". When reloading, we search and highlight. (MVP)

        const highlight = {
            text: text,
            code_id: codeId,
            code_label: code.label,
            color: code.color,
            id: Date.now()
        };

        TeacherApp.currentHighlights.push(highlight);

        // Visual feedback
        const mark = document.createElement('mark');
        mark.style.backgroundColor = code.color;
        mark.title = code.label;
        mark.textContent = text;

        range.deleteContents();
        range.insertNode(mark);

        selection.removeAllRanges();
    },

    renderHighlights: () => {
        // Simple text search replacement for MVP restoration
        // Limitation: If same text appears twice, might highlight wrong one or all. 
        // Acceptable for MVP.
        const container = document.getElementById('reflection-content');
        let html = container.innerHTML;

        TeacherApp.currentHighlights.forEach(h => {
            // Create a regex to replace the FIRST occurrence that isn't already marked?
            // Or just replace all? Text search is risky on HTML.
            // Ideally we should have preserved the wrapping.
            // For this MVP, let's just show a list of coded segments below if restoration is too buggy?
            // OR: We try to replace the text content.

            // Simplest: Just Highlight matching text.
            html = html.replace(h.text, `<mark style="background-color:${h.color}" title="${h.code_label}">${h.text}</mark>`);
        });

        container.innerHTML = html;
    },

    saveFeedback: async () => {
        if (!TeacherApp.currentReflection) return;

        const comment = document.getElementById('feedback-text').value;

        try {
            await apiRequest('teacher/saveFeedback', {
                reflection_id: TeacherApp.currentReflection.reflection_id,
                comment: comment,
                highlights: TeacherApp.currentHighlights
            }, TeacherApp.auth);
            showToast('フィードバックを保存しました');
        } catch (err) {
            showToast('保存失敗', 'error');
        }
    },

    renderChart: (history) => {
        const ctx = document.getElementById('student-code-chart').getContext('2d');

        const codeCounts = {};
        history.forEach(r => {
            if (r.feedback && r.feedback.highlights_json) {
                try {
                    const hl = JSON.parse(r.feedback.highlights_json);
                    hl.forEach(h => {
                        codeCounts[h.code_label] = (codeCounts[h.code_label] || 0) + 1;
                    });
                } catch (e) { }
            }
        });

        if (window.teacherChart) window.teacherChart.destroy();
        window.teacherChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(codeCounts),
                datasets: [{
                    label: '獲得方略',
                    data: Object.values(codeCounts),
                    backgroundColor: 'orange'
                }]
            }
        });
    }
};

TeacherApp.init();

