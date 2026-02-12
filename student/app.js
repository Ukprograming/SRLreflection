// Student App Logic

const App = {
    auth: null,

    init: async () => {
        // Check for saved auth
        const savedAuth = localStorage.getItem('srl_auth');
        if (savedAuth) {
            App.auth = JSON.parse(savedAuth);
            // Verify token/session validity if needed, for now assume valid
            App.showDashboard();
        } else {
            App.showLogin();
        }

        // Event Listeners
        document.getElementById('login-form').addEventListener('submit', App.handleLogin);
        document.getElementById('logout-btn').addEventListener('click', App.handleLogout);
        document.getElementById('reflection-form').addEventListener('submit', App.handleReflectionSubmit);
        document.getElementById('show-history-btn').addEventListener('click', App.toggleHistory);
        document.querySelector('.close').addEventListener('click', () => {
            document.getElementById('feedback-modal').classList.add('hidden');
        });
    },

    showLogin: () => {
        document.getElementById('login-view').classList.remove('hidden');
        document.getElementById('dashboard-view').classList.add('hidden');
    },

    showDashboard: async () => {
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('hidden');
        document.getElementById('user-display').textContent = `${App.auth.name} (${App.auth.id})`;

        // Load Questions
        await App.loadQuestions();

        // Check for unread feedback
        await App.checkFeedback();
    },

    handleLogin: async (e) => {
        e.preventDefault();
        const id = document.getElementById('student-id').value.trim();
        const classCode = document.getElementById('class-code').value.trim();
        const remember = document.getElementById('remember-me').checked;

        if (!id || !classCode) return;

        try {
            const res = await apiRequest('login', { id, class_code: classCode });
            App.auth = { id, class_code: classCode, token: res.token, name: res.name };

            if (remember) {
                localStorage.setItem('srl_auth', JSON.stringify(App.auth));
            }

            App.showDashboard();
        } catch (err) {
            showToast(err.message, 'error');
        }
    },

    handleLogout: () => {
        localStorage.removeItem('srl_auth');
        App.auth = null;
        location.reload();
    },

    loadQuestions: async () => {
        try {
            const res = await apiRequest('student/getQuestions', {}, App.auth);
            App.renderForm(res.questions);
            // Set today's date
            // const dateInput = document.createElement('input'); 
            // We need a date input at the top
        } catch (err) {
            console.error(err);
            showToast('設問の読み込みに失敗しました', 'error');
        }
    },

    renderForm: (questions) => {
        const form = document.getElementById('reflection-form');
        form.innerHTML = '';

        // Date Input (Always first)
        const dateGroup = document.createElement('div');
        dateGroup.className = 'form-group';
        const today = new Date().toISOString().split('T')[0];
        dateGroup.innerHTML = `
            <label>授業日</label>
            <input type="date" name="date" value="${today}" required>
        `;
        form.appendChild(dateGroup);

        // Questions
        questions.forEach(q => {
            const group = document.createElement('div');
            group.className = 'form-group';
            const label = document.createElement('label');
            label.textContent = q.label;
            group.appendChild(label);

            let input;
            if (q.type === 'text') {
                input = document.createElement('textarea');
                input.name = q.id;
            } else if (q.type === 'scale') {
                input = document.createElement('div');
                input.className = 'scale-group';
                for (let i = q.min; i <= q.max; i++) {
                    const label = document.createElement('label');
                    label.innerHTML = `<input type="radio" name="${q.id}" value="${i}" ${i === q.max ? 'checked' : ''}> ${i}`;
                    input.appendChild(label);
                }
            } else if (q.type === 'radio') {
                input = document.createElement('div');
                q.options.forEach(opt => {
                    const label = document.createElement('label');
                    label.innerHTML = `<input type="radio" name="${q.id}" value="${opt}"> ${opt}`;
                    input.appendChild(label);
                });
            }

            if (input) group.appendChild(input);
            form.appendChild(group);
        });

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = '送信';
        form.appendChild(submitBtn);
    },

    handleReflectionSubmit: async (e) => {
        e.preventDefault();
        const form = e.target;
        const formData = new FormData(form);
        const data = {};
        let date = '';

        for (let [key, value] of formData.entries()) {
            if (key === 'date') {
                date = value;
            } else {
                data[key] = value;
            }
        }

        try {
            await apiRequest('student/submitReflection', { date, content: data }, App.auth);
            showToast('提出しました！');
            form.reset();
            // Refresh history if open
            if (!document.getElementById('history-view').classList.contains('hidden')) {
                App.loadHistory();
            }
        } catch (err) {
            showToast('提出に失敗しました', 'error');
        }
    },

    checkFeedback: async () => {
        try {
            const res = await apiRequest('student/getUnreadFeedback', {}, App.auth);
            if (res.unread && res.unread.length > 0) {
                const modal = document.getElementById('feedback-modal');
                const content = document.getElementById('feedback-content');
                content.innerHTML = res.unread.map(item => `
                    <div class="feedback-item">
                        <h4>${formatDate(item.date)}の振り返りへのコメント</h4>
                        <div class="comment">${item.comment}</div>
                    </div>
                `).join('<hr>');

                modal.classList.remove('hidden');

                // Mark as read
                const ids = res.unread.map(u => u.reflection_id);
                await apiRequest('student/markFeedbackRead', { reflection_ids: ids }, App.auth);
            }
        } catch (err) {
            console.error(err);
        }
    },

    toggleHistory: () => {
        const view = document.getElementById('history-view');
        if (view.classList.contains('hidden')) {
            view.classList.remove('hidden');
            App.loadHistory();
        } else {
            view.classList.add('hidden');
        }
    },

    loadHistory: async () => {
        try {
            const res = await apiRequest('student/getHistory', {}, App.auth);
            App.renderHistory(res.history);
            App.renderChart(res.history);
        } catch (err) {
            showToast('履歴の読み込みに失敗しました', 'error');
        }
    },

    renderHistory: (history) => {
        const list = document.getElementById('history-list');
        list.innerHTML = history.map(h => `
            <div class="card history-item">
                <h4>${formatDate(h.date)}</h4>
                <div class="content-preview">
                    ${Object.entries(JSON.parse(h.content)).map(([k, v]) => `<p><strong>${k}:</strong> ${v}</p>`).join('')}
                </div>
                ${h.has_feedback ? '<span class="badge">コメントあり</span>' : ''}
                <div class="codes">
                   ${h.codes.map(c => `<span class="tag">${c}</span>`).join(' ')}
                </div>
            </div>
        `).join('');
    },

    renderChart: (history) => {
        const ctx = document.getElementById('codes-chart').getContext('2d');

        // Aggregate codes
        const codeCounts = {};
        history.forEach(h => {
            h.codes.forEach(c => {
                codeCounts[c] = (codeCounts[c] || 0) + 1;
            });
        });

        if (window.myChart) window.myChart.destroy();

        window.myChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: Object.keys(codeCounts),
                datasets: [{
                    label: '獲得した方略コード',
                    data: Object.values(codeCounts),
                    backgroundColor: 'rgba(75, 192, 192, 0.6)'
                }]
            },
            options: {
                responsive: true,
                scales: {
                    y: { beginAtZero: true, stepSize: 1 }
                }
            }
        });
    }
};

App.init();

