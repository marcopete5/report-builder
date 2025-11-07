/* v3 — Feedback Widget (feedback.js) — keeps v2 button behavior; adds searchable names
   Usage on any page (update data-*):
   <script src="https://vschool-reports.netlify.app/feedback.js"
           data-api="https://vschool-reports.netlify.app"
           data-lesson-id="L-JSON-001"
           data-lesson-title="Intro to JSON"
           data-course-id="COURSE-ABC"></script>
*/
(function () {
    const tag = document.currentScript;
    if (!tag) return console.error('[Feedback] Cannot find currentScript');

    const API_BASE = tag.getAttribute('data-api') || '';
    const LESSON_ID = tag.getAttribute('data-lesson-id') || '';
    const TITLE =
        tag.getAttribute('data-lesson-title') || document.title || 'Lesson';
    const COURSE_ID = tag.getAttribute('data-course-id') || null;

    if (!API_BASE || !LESSON_ID) {
        console.error('[Feedback] Missing data-api or data-lesson-id.');
        return;
    }

    // UTMs (optional)
    const qs = new URLSearchParams(location.search);
    const utm = {
        source: qs.get('utm_source'),
        medium: qs.get('utm_medium'),
        campaign: qs.get('utm_campaign'),
        term: qs.get('utm_term'),
        content: qs.get('utm_content')
    };

    // Styles
    const css = `
    .fb-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:2147483647}
    .fb-modal{background:#fff;color:#111;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);max-width:600px;width:92%;padding:20px}
    .fb-header{display:flex;justify-content:space-between;align-items:center}
    .fb-h{margin:0 0 8px;font-size:18px;font-weight:600; color: #cfcfcf}
    .fb-p{margin:0 0 16px;color:#444;font-size:14px}
    .fb-row{display:flex;flex-direction:column;gap:12px;margin-top:10px}
    .fb-input,.fb-textarea,.fb-select{border:1px solid #e5e7eb;border-radius:8px;padding:10px;font-size:14px;background:#fff;width:100%}
    .fb-textarea{min-height:110px;resize:vertical}
    .fb-btn{border:0;border-radius:8px;height:42px;padding:0 14px;font-size:14px;font-weight:600;cursor:pointer;background:#111;color:#fff}
    .fb-btn[disabled]{opacity:.6;cursor:not-allowed}
    .fb-err{color:#b00020;font-size:13px;margin-top:8px;display:none}
    .fb-ok{color:#0a7a2f;font-size:13px;margin-top:8px;display:none}
    .fb-close{background:none;border:0;font-size:18px;cursor:pointer;color:#666}
    .fb-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px}
    .fb-small{font-size:12px;color:#666}
    .fb-anon{font-size:12px;color:#2563eb;cursor:pointer;text-decoration:underline;background:none;border:0;padding:0}

    /* Searchable list for names */
    .fb-label{font-size:13px;font-weight:600;color:#374151}
    .fb-list{border:1px solid #e5e7eb;border-radius:8px;max-height:40vh;overflow:auto;background:#fff}
    .fb-option{padding:10px 12px;cursor:pointer}
    .fb-option[aria-selected="true"], .fb-option:hover{background:#f3f4f6}
    .fb-option.selected{outline:2px solid #2563eb;background:#e0f2fe}

    /* Floating launcher button — EXACT behavior copied from v2 */
    .fb-launcher{position:fixed;right:20px;bottom:20px;border:0;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer;background:#111;color:#fff;box-shadow:0 6px 18px rgba(0,0,0,.2);z-index:2147483647}

    @media (prefers-color-scheme: dark){
      .fb-modal{background:#0b0b0b;color:#e5e5e5}
      .fb-input,.fb-textarea,.fb-select{background:#0f0f0f;color:#e5e5e5;border-color:#2a2a2a}
      .fb-list{background:#0f0f0f;border-color:#2a2a2a}
      .fb-option[aria-selected="true"], .fb-option:hover{background:#111827}
      .fb-option.selected{outline:2px solid #3b82f6;background:#1e3a8a}
      .fb-btn,.fb-launcher{background:#e5e5e5;color:#0b0b0b}
      .fb-p{color:#cfcfcf}
      .fb-small{color:#9aa0a6}
      .fb-anon{color:#93c5fd}
    }`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Build popup
    const root = document.createElement('div');
    root.className = 'fb-backdrop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.style.display = 'none';
    root.innerHTML = `
    <div class="fb-modal">
      <div class="fb-header">
        <h3 class="fb-h">Give Feedback</h3>
        <button class="fb-close" aria-label="Close">×</button>
      </div>
      <p class="fb-p">We value your input on <b>${escapeHtml(TITLE)}</b>.</p>

      <div class="fb-row" role="group" aria-label="Feedback form">
        <div>
          <label class="fb-label" for="fb-search">Your name</label>
          <input id="fb-search" class="fb-input" type="text" placeholder="Search name…" autocomplete="off" />
          <div class="fb-list" role="listbox" id="fb-listbox" aria-label="Students"></div>
        </div>

        <select class="fb-select" id="fb-type">
          <option value="">Select feedback type…</option>
          <option>Error (typo, incorrect info, broken link)</option>
          <option>Positive (something you liked)</option>
          <option>Lacking/Unclear (confusing, missing context)</option>
          <option>Other</option>
        </select>

        <textarea class="fb-textarea" id="fb-details" placeholder="Please go in depth with your feedback…"></textarea>

        <button class="fb-btn" id="fb-submit" disabled>Submit Feedback</button>
      </div>

      <div class="fb-err" id="fb-err"></div>
      <div class="fb-ok" id="fb-ok"></div>
      <div class="fb-foot">
        <span class="fb-small">Course: ${escapeHtml(
            COURSE_ID || 'N/A'
        )} · Lesson: ${escapeHtml(LESSON_ID)}</span>
        <button class="fb-anon" id="fb-anon" type="button">Submit Anonymously</button>
      </div>
    </div>
  `;
    document.body.appendChild(root);

    // Open button — EXACT same placement/behavior as your v2
    const openBtn = document.createElement('button');
    openBtn.textContent = 'Give Feedback';
    openBtn.className = 'fb-launcher';
    document.body.appendChild(openBtn);

    const $ = (q) => root.querySelector(q);
    const search = $('#fb-search');
    const listEl = $('#fb-listbox');
    const typeSel = $('#fb-type');
    const details = $('#fb-details');
    const btn = $('#fb-submit');
    const okEl = $('#fb-ok');
    const errEl = $('#fb-err');
    const closeBtn = root.querySelector('.fb-close');
    const anonBtn = $('#fb-anon');

    openBtn.addEventListener('click', () => (root.style.display = 'flex'));
    closeBtn.addEventListener('click', () => (root.style.display = 'none'));
    anonBtn.addEventListener('click', () => {
        window.open(
            'https://docs.google.com/forms/u/2/d/1QPZFGhLLuBQYdlN7JhyIbGVkzakS5_dd0J_1TMA0258/edit',
            '_blank'
        );
    });

    // Searchable names (Airtable-backed)
    let fullList = []; // [{id,name}]
    let filtered = [];
    let activeIdx = -1;
    let selected = null; // {id,name}

    function renderList(items) {
        listEl.style.display = 'block';
        listEl.innerHTML = items
            .map(
                (s, i) =>
                    `<div class="fb-option" role="option" data-id="${
                        s.id
                    }" data-name="${escapeHtml(s.name)}" aria-selected="${
                        i === activeIdx
                    }">
         ${escapeHtml(s.name)}
       </div>`
            )
            .join('');
    }

    function setActive(idx) {
        if (!filtered.length) {
            activeIdx = -1;
            return;
        }
        if (idx < 0) idx = 0;
        if (idx >= filtered.length) idx = filtered.length - 1;
        activeIdx = idx;
        [...listEl.children].forEach((el, i) =>
            el.setAttribute('aria-selected', String(i === activeIdx))
        );
        const el = listEl.children[activeIdx];
        if (el) {
            const elTop = el.offsetTop,
                elBottom = elTop + el.offsetHeight;
            const viewTop = listEl.scrollTop,
                viewBottom = viewTop + listEl.clientHeight;
            if (elTop < viewTop) listEl.scrollTop = elTop;
            else if (elBottom > viewBottom)
                listEl.scrollTop = elBottom - listEl.clientHeight;
        }
    }

    function clearPersistentSelection() {
        [...listEl.children].forEach((el) => el.classList.remove('selected'));
    }

    function chooseByIndex(idx) {
        if (idx < 0 || idx >= filtered.length) return;
        selected = filtered[idx];
        clearPersistentSelection();
        const el = listEl.children[idx];
        if (el) el.classList.add('selected');
        syncSubmitState();
    }

    function chooseByElement(el) {
        const id = el.getAttribute('data-id');
        const name = el.getAttribute('data-name');
        if (!id || !name) return;
        selected = { id, name };
        clearPersistentSelection();
        el.classList.add('selected');
        activeIdx = [...listEl.children].indexOf(el);
        setActive(activeIdx);
        syncSubmitState();
    }

    function syncSubmitState() {
        const haveName =
            !!selected ||
            (listEl.style.display === 'none' &&
                !!(search.value && search.value.trim()));
        const haveType = !!typeSel.value;
        const haveText = !!(details.value && details.value.trim().length > 0);
        btn.disabled = !(haveName && haveType && haveText);
    }

    // Load students + wire interactions
    fetch(`${API_BASE}/api/students`)
        .then((r) => {
            if (!r.ok) throw new Error('students ' + r.status);
            return r.json();
        })
        .then((data) => {
            fullList = (data && data.students) || [];
            filtered = fullList.slice();
            renderList(filtered);
            setActive(filtered.length ? 0 : -1);

            // filter typing
            search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                filtered = q
                    ? fullList.filter((s) => s.name.toLowerCase().includes(q))
                    : fullList.slice();
                activeIdx = filtered.length ? 0 : -1;
                selected = null;
                syncSubmitState();
                renderList(filtered);
                setActive(activeIdx);
            });

            // keyboard nav
            search.addEventListener('keydown', (e) => {
                if (!filtered.length) return;
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive(activeIdx + 1);
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive(activeIdx - 1);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (activeIdx >= 0) chooseByIndex(activeIdx);
                }
            });

            // mouse
            listEl.addEventListener('mousemove', (e) => {
                const el = e.target.closest('.fb-option');
                if (!el) return;
                const idx = [...listEl.children].indexOf(el);
                if (idx !== -1 && idx !== activeIdx) setActive(idx);
            });
            listEl.addEventListener('click', (e) => {
                const el = e.target.closest('.fb-option');
                if (!el) return;
                chooseByElement(el);
            });
        })
        .catch((err) => {
            console.error('[Feedback] students load failed:', err);
            // fallback: free text name via search input
            listEl.style.display = 'none';
            search.placeholder = 'Type your full name…';
            search.addEventListener('input', syncSubmitState);
        });

    // Enable submit when form fields change
    [typeSel, details].forEach((el) =>
        el.addEventListener('input', syncSubmitState)
    );

    // Submit
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        errEl.style.display = 'none';
        okEl.style.display = 'none';

        let studentId = null,
            studentName = null;
        if (listEl.style.display === 'none') {
            studentName = (search.value && search.value.trim()) || null;
            studentId = null;
            if (!studentName) {
                btn.disabled = false;
                return;
            }
        } else {
            if (!selected) {
                btn.disabled = false;
                return;
            }
            studentName = selected.name;
            studentId = selected.id;
        }

        const payload = {
            studentId,
            studentName,
            courseId: COURSE_ID,
            lessonId: LESSON_ID,
            lessonTitle: TITLE,
            type: typeSel.value,
            text: (details.value || '').trim(),
            pageUrl: location.href,
            utm
        };

        try {
            const r = await fetch(`${API_BASE}/api/feedback`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) throw new Error('post ' + r.status);
            okEl.textContent = 'Feedback submitted — thank you!';
            okEl.style.display = 'block';
            setTimeout(() => (root.style.display = 'none'), 1000);
        } catch (e) {
            console.error('[Feedback] submit failed:', e);
            errEl.textContent = 'Could not submit right now.';
            errEl.style.display = 'block';
            btn.disabled = false;
        }
    });

    // Launcher shows/hides modal (same as v2)
    // (Already wired above via openBtn/closeBtn)
    // Open on creation to ensure DOM is ready for focus if needed:
    // (Not auto-opening; user must click the button.)

    // Utility
    function escapeHtml(s) {
        return String(s)
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }
})();
