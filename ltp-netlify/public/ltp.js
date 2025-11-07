/* v3 — Lesson Tracker Popup (ltp.js)
   Usage on any page (update data-*):
   <script src="https://vschool-reports.netlify.app/ltp.js"
           data-api="https://vschool-reports.netlify.app"
           data-lesson-id="L-JSON-001"
           data-lesson-title="Intro to JSON"
           data-course-id="COURSE-ABC"
           data-max-list-height="40vh"></script>
*/
(function () {
    const tag = document.currentScript;
    if (!tag) return console.error('[LTP] Cannot find currentScript');

    const API_BASE = tag.getAttribute('data-api') || '';
    const LESSON_ID = tag.getAttribute('data-lesson-id') || '';
    const TITLE =
        tag.getAttribute('data-lesson-title') || document.title || 'Lesson';
    const COURSE_ID = tag.getAttribute('data-course-id') || null;

    if (!API_BASE || !LESSON_ID) {
        console.error('[LTP] Missing data-api or data-lesson-id.');
        return;
    }

    // Only show once per session per lesson
    const flag = `ltp_shown_${LESSON_ID}`;
    if (sessionStorage.getItem(flag)) return;

    // Collect UTMs if present
    const qs = new URLSearchParams(location.search);
    const utm = {
        source: qs.get('utm_source'),
        medium: qs.get('utm_medium'),
        campaign: qs.get('utm_campaign'),
        term: qs.get('utm_term'),
        content: qs.get('utm_content')
    };

    // Inject styles
    const css = `
    .ltp-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:2147483647}
    .ltp-modal{background:#fff;color:#111;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.15);max-width:520px;width:92%;padding:20px}
    .ltp-header{display:flex;justify-content:space-between;align-items:center}
    .ltp-h{margin:0 0 8px;color:#e5e7eb;font-size:18px;font-weight:600}
    .ltp-p{margin:0 0 16px;color:#444;font-size:14px}
    .ltp-row{display:flex;flex-direction:column;gap:8px;margin-top:10px}
    .ltp-input{border:1px solid #e5e7eb;border-radius:8px;height:42px;padding:0 12px;font-size:14px;background:#fff;width:95%}
    .ltp-list{border:1px solid #e5e7eb;border-radius:8px;max-height:40vh;overflow:auto;background:#fff}
    .ltp-option{padding:10px 12px;cursor:pointer}
    .ltp-option[aria-selected="true"], .ltp-option:hover{background:#f3f4f6}
    .ltp-option.selected{outline:2px solid #2563eb;background:#e0f2fe}
    .ltp-btn{border:0;border-radius:8px;height:42px;padding:0 14px;font-size:14px;font-weight:600;cursor:pointer;background:#111;color:#fff}
    .ltp-btn[disabled]{opacity:.6;cursor:not-allowed}
    .ltp-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;gap:8px;flex-wrap:wrap}
    .ltp-small{font-size:12px;color:#666}
    .ltp-err{color:#b00020;font-size:13px;margin-top:8px;display:none}
    .ltp-ok{color:#0a7a2f;font-size:13px;margin-top:8px;display:none}
    .ltp-visually-hidden{position:absolute!important;height:1px;width:1px;overflow:hidden;clip:rect(1px,1px,1px,1px);white-space:nowrap}
    /* NEW: "Here by Mistake?" link */
    .ltp-mistake{font-size:12px;color:#2563eb;cursor:pointer;text-decoration:underline;background:none;border:0;padding:0}
    @media (prefers-color-scheme: dark){
      .ltp-modal{background:#0b0b0b;color:#e5e5e5}
      .ltp-input{background:#0f0f0f;color:#e5e5e5;border-color:#2a2a2a}
      .ltp-list{background:#0f0f0f;border-color:#2a2a2a}
      .ltp-option[aria-selected="true"], .ltp-option:hover{background:#111827}
      .ltp-option.selected{outline:2px solid #3b82f6;background:#1e3a8a}
      .ltp-btn{background:#e5e5e5;color:#0b0b0b}
      .ltp-p{color:#cfcfcf}
      .ltp-small{color:#9aa0a6}
      .ltp-mistake{color:#93c5fd}
    }`;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    // Build popup (no close button; Esc disabled → confirm is the only exit)
    const root = document.createElement('div');
    root.className = 'ltp-backdrop';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
    <div class="ltp-modal">
      <div class="ltp-header">
        <h3 class="ltp-h">Identify yourself</h3>
      </div>
      <p class="ltp-p">Select your name to record entry for <b>${TITLE}</b>.</p>

      <div class="ltp-row" role="group" aria-label="Student selector">
        <label class="ltp-visually-hidden" for="ltp-search">Search name</label>
        <input id="ltp-search" class="ltp-input ltp-search" type="text" placeholder="Search name…" autocomplete="off" />
        <div class="ltp-list" role="listbox" id="ltp-listbox" aria-label="Students"></div>
        <button class="ltp-btn" disabled>Confirm</button>
      </div>

      <div class="ltp-err" id="ltp-err"></div>
      <div class="ltp-ok" id="ltp-ok"></div>
      <div class="ltp-foot">
        <span class="ltp-small">This helps us track your progress through the course</span>
        <span class="ltp-small">${location.hostname}</span>
        <!-- NEW: Here by Mistake control -->
        <button class="ltp-mistake" id="ltp-mistake" type="button">Here by Mistake? Click to exit</button>
      </div>
    </div>
  `;
    document.body.appendChild(root);
    sessionStorage.setItem(flag, '1');

    const $ = (q) => root.querySelector(q);
    const search = $('.ltp-search');
    const listEl = $('#ltp-listbox');
    const btn = $('.ltp-btn');
    const okEl = $('#ltp-ok');
    const errEl = $('#ltp-err');
    const mistakeBtn = $('#ltp-mistake'); // NEW

    // Optional per-page list height override
    const maxH = tag.getAttribute('data-max-list-height');
    if (maxH) listEl.style.maxHeight = maxH;

    const close = () => {
        root.remove();
        style.remove();
    };

    // NEW: "Here by Mistake?" — close now, and remove session flag so it can reappear on refresh
    mistakeBtn.addEventListener('click', () => {
        try {
            sessionStorage.removeItem(flag);
        } catch {}
        close();
    });

    let fullList = []; // [{id,name}]
    let filtered = []; // current view
    let activeIdx = -1; // highlighted index in filtered
    let selected = null; // { id, name }

    function renderList(items) {
        listEl.innerHTML = items
            .map(
                (s, i) =>
                    `<div class="ltp-option" role="option" data-id="${
                        s.id
                    }" data-name="${s.name}" aria-selected="${i === activeIdx}">
         ${s.name}
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
        // Update aria-selected and scroll into view
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
        btn.disabled = !selected;
        clearPersistentSelection();
        const el = listEl.children[idx];
        if (el) el.classList.add('selected');
    }

    function chooseByElement(el) {
        const id = el.getAttribute('data-id');
        const name = el.getAttribute('data-name');
        if (!id || !name) return;
        selected = { id, name };
        btn.disabled = false;
        clearPersistentSelection();
        el.classList.add('selected');
        // sync active index to the clicked element
        activeIdx = [...listEl.children].indexOf(el);
        setActive(activeIdx);
    }

    // Load students and initialize combobox behavior
    fetch(`${API_BASE}/api/students`)
        .then((r) => {
            if (!r.ok) throw new Error('students ' + r.status);
            return r.json();
        })
        .then((data) => {
            fullList = (data && data.students) || [];
            if (!fullList.length) throw new Error('Empty list');
            filtered = fullList.slice();
            renderList(filtered);
            setActive(0);

            // Input typing → live filter
            search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                filtered = q
                    ? fullList.filter((s) => s.name.toLowerCase().includes(q))
                    : fullList.slice();
                activeIdx = filtered.length ? 0 : -1;
                selected = null;
                btn.disabled = true;
                renderList(filtered);
                setActive(activeIdx);
            });

            // Keyboard navigation on the search field
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
                    if (activeIdx >= 0) {
                        chooseByIndex(activeIdx);
                    }
                }
            });

            // Mouse interactions on the list
            listEl.addEventListener('mousemove', (e) => {
                const el = e.target.closest('.ltp-option');
                if (!el) return;
                const idx = [...listEl.children].indexOf(el);
                if (idx !== -1 && idx !== activeIdx) setActive(idx);
            });
            listEl.addEventListener('click', (e) => {
                const el = e.target.closest('.ltp-option');
                if (!el) return;
                chooseByElement(el);
            });
        })
        .catch((err) => {
            console.error('[LTP] students load failed:', err);
            // Fallback: free-text only
            listEl.style.display = 'none';
            const input = document.createElement('input');
            input.className = 'ltp-input';
            input.placeholder = 'Type your full name';
            input.id = 'ltp-fallback';
            listEl.parentNode.insertBefore(input, listEl);
            search.style.display = 'none';
            input.addEventListener('input', () => {
                btn.disabled = !(input.value && input.value.trim());
            });
        });

    // Confirm click → POST (the ONLY way to exit)
    btn.addEventListener('click', async () => {
        btn.disabled = true;
        errEl.style.display = 'none';
        okEl.style.display = 'none';

        let studentName = null,
            studentId = null;

        const manual = document.getElementById('ltp-fallback');
        if (manual && manual.style.display !== 'none') {
            studentName = (manual.value && manual.value.trim()) || null;
            if (!studentName) {
                btn.disabled = false;
                errEl.textContent = 'Please type your name.';
                errEl.style.display = 'block';
                return;
            }
        } else {
            if (!selected) {
                btn.disabled = false;
                errEl.textContent = 'Please select your name.';
                errEl.style.display = 'block';
                return;
            }
            studentName = selected.name;
            studentId = selected.id;
        }

        const payload = {
            studentName,
            studentId,
            courseId: COURSE_ID,
            lessonId: LESSON_ID,
            lessonTitle: TITLE,
            pageUrl: location.href,
            utm,
            extra: { referrer: document.referrer || null }
        };

        try {
            const r = await fetch(`${API_BASE}/api/lesson-entry`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!r.ok) throw new Error('post ' + r.status);
            okEl.textContent = 'Recorded — thanks!';
            okEl.style.display = 'block';
            setTimeout(close, 700);
        } catch (e) {
            console.error('[LTP] submit failed:', e);
            errEl.textContent = 'Could not record right now. You can continue.';
            errEl.style.display = 'block';
            btn.disabled = false;
        }
    });
})();
