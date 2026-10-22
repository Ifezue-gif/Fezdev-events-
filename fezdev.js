/*  Fezdev Events — front-end engine (vanilla ES6+, no dependencies)
    1 utilities · 2 storage · 3 time zones · 4 calendar files · 5 toast · 6 modal
    7 navigation · 8 validation · 9 lists · 10 meeting booking · 11 availability
    12 event publishing · 13 boot                                                */
'use strict';

(() => {
    /* ------------------------------------------------------------------ 1 utilities */
    const NS = 'fezdev:v1:';
    const KEYS = { meetings: NS + 'meetings', events: NS + 'events', host: NS + 'host' };
    const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MINUTE = 60000;
    const EMAIL RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
    const ROOMS = { 'Google Meet': 'https://meet.google.com/new', 'Zoom': 'https://zoom.us/meeting/schedule' };
    const DEFAULT HOST = { days: [1, 2, 3, 4, 5], startMin: 540, endMin: 1020, buffer: 0, timezone: '' };

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const pad = n => String(n).padStart(2, '0');
    const nice = tz => String(tz).replace(/ /g, ' ');
    const byStart = (a, b) => Date.parse(a.start) - Date.parse(b.start);
    const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s);
    const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'fezdev';
    const uid = () => (window.crypto && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

    /** Build a DOM node safely (text is always inserted as text, never as HTML). */
    function el(tag, props = {}, ...kids) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (value === null || value === undefined || value === false) continue;
            if (key === 'class') node.className = value;
            else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
            else node.setAttribute(key, value === true ? '' : value);
        }
        kids.flat().forEach(kid => {
            if (kid !== null && kid !== undefined && kid !== false) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
        });
        return node;
    }

    /* ------------------------------------------------------------------ 2 storage */
    const memory = {};
    const store = {
        read(key, fallback) {
            try {
                const raw = window.localStorage.getItem(key);
                if (raw !== null) return JSON.parse(raw);
            } catch { /* fall through to the in-memory copy */ }
            return key in memory ? memory[key] : fallback;
        },
        write(key, value) {
            memory[key] = value;
            try { window.localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
        },
        remove(key) {
            delete memory[key];
            try { window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
        }
    };

    const readList = key => { const value = store.read(key, []); return Array.isArray(value) ? value : []; };
    const getMeetings = () => readList(KEYS.meetings);
    const getEvents = () => readList(KEYS.events);
    const notify = () => window.dispatchEvent(new CustomEvent('fezdev:data'));
    const saveMeetings = list => { const ok = store.write(KEYS.meetings, list); notify(); return ok; };
    const saveEvents = list => { const ok = store.write(KEYS.events, list); notify(); return ok; };

    function getHost() {
        const saved = store.read(KEYS.host, null);
        const host = { ...DEFAULT HOST, ...(saved && typeof saved === 'object' ? saved : {}) };
        host.days = Array.isArray(host.days) ? host.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : DEFAULT HOST.days.slice();
        host.startMin = Number.isFinite(host.startMin) ? host.startMin : DEFAULT HOST.startMin;
        host.endMin = Number.isFinite(host.endMin) ? host.endMin : DEFAULT HOST.endMin;
        host.buffer = Number.isFinite(host.buffer) ? host.buffer : 0;
        host.timezone = isValidTz(host.timezone) ? host.timezone : BROWSER TZ;
        return host;
    }

    /* ------------------------------------------------------------------ 3 time zones */
    const isValidTz = tz => {
        if (!tz || typeof tz !== 'string') return false;
        try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
    };
    const BROWSER TZ = (() => {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
    })();
    const FALLBACK TZ = ['UTC', 'Africa/Lagos', 'Africa/Nairobi', 'Africa/Johannesburg', 'Africa/Cairo', 'America/New York',
        'America/Chicago', 'America/Denver', 'America/Los Angeles', 'America/Sao Paulo', 'Europe/London', 'Europe/Paris',
        'Europe/Berlin', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland'];

    /** Calendar and clock parts of an instant, as seen in a given time zone. */
    function tzParts(date, tz) {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: tz, hourCycle: 'h23', weekday: 'short',
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
        }).formatToParts(date);
        const p = {};
        parts.forEach(part => { p[part.type] = part.value; });
        return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second, weekday: p.weekday };
    }
    /** Milliseconds the zone is ahead of UTC at a given instant. */
    function tzOffsetMs(date, tz) {
        const p = tzParts(date, tz);
        return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(date.getTime() / 1000) * 1000;
    }
    /** Convert a wall-clock time in a zone (e.g. 09:00 in Lagos) to the real instant. */
    function zonedToUtc(y, m, d, h, mi, tz) {
        const guess = Date.UTC(y, m - 1, d, h, mi);
        let t = guess - tzOffsetMs(new Date(guess), tz);
        t = guess - tzOffsetMs(new Date(t), tz);
        return new Date(t);
    }
    function offsetLabel(tz, date = new Date()) {
        const minutes = Math.round(tzOffsetMs(date, tz) / MINUTE);
        const abs = Math.abs(minutes);
        return `UTC${minutes < 0 ? '-' : '+'}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
    }
    const ymd = p => `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    const addDays = (dateStr, n) => {
        const [y, m, d] = dateStr.split('-').map(Number);
        return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
    };
    const todayIn = tz => ymd(tzParts(new Date(), tz));

    const fmt = (date, tz, opts) => new Intl.DateTimeFormat(undefined, { timeZone: tz, ...opts }).format(date);
    const fmtTime = (date, tz) => fmt(date, tz, { hour: 'numeric', minute: '2-digit' });
    const fmtDateTime = (date, tz) => fmt(date, tz, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    const minuteLabel = min => (min >= 1440 ? '12:00 AM (end of day)'
        : fmt(new Date(Date.UTC(2000, 0, 1, Math.floor(min / 60), min % 60)), 'UTC', { hour: 'numeric', minute: '2-digit' }));

    function getTimezones(selected) {
        let list;
        try { list = Intl.supportedValuesOf('timeZone').slice(); } catch { list = FALLBACK TZ.slice(); }
        [selected, BROWSER TZ, 'UTC'].forEach(tz => { if (tz && !list.includes(tz)) list.unshift(tz); });
        return list;
    }
    function fillTimezoneSelect(select, selected) {
        const now = new Date();
        const options = getTimezones(selected).map(tz => el('option', { value: tz, selected: tz === selected },
            `${nice(tz)} (${offsetLabel(tz, now)})${tz === BROWSER TZ ? ' \u00b7 detected' : ''}`));
        select.replaceChildren(...options);
        select.value = selected;
    }

    /* ------------------------------------------------------------------ 4 calendar files */
    const icsEscape = s => String(s === null || s === undefined ? '' : s)
        .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
    const icsStamp = date => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const foldLine = line => {
        const out = [];
        let rest = line;
        while (rest.length > 73) { out.push(rest.slice(0, 73)); rest = ' ' + rest.slice(73); }
        out.push(rest);
        return out.join('\r\n');
    };

    function buildVEvent({ id, title, description, location, start, end, attendees = [], category }) {
        const lines = [
            'BEGIN:VEVENT',
            `UID:${id}@fezdev.events`,
            `DTSTAMP:${icsStamp(new Date())}`,
            `DTSTART:${icsStamp(new Date(start))}`,
            `DTEND:${icsStamp(new Date(end))}`,
            `SUMMARY:${icsEscape(title)}`,
            `DESCRIPTION:${icsEscape(description)}`,
            `LOCATION:${icsEscape(location)}`,
            'STATUS:CONFIRMED'
        ];
        if (category) lines.push(`CATEGORIES:${icsEscape(category)}`);
        attendees.forEach(email => lines.push(`ATTENDEE;CN=${email};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${email}`));
        lines.push('BEGIN:VALARM', 'TRIGGER:-PT15M', 'ACTION:DISPLAY', 'DESCRIPTION:Starting in 15 minutes', 'END:VALARM', 'END:VEVENT');
        return lines;
    }
    const meetingVEvent = m => buildVEvent({
        id: m.id, title: m.title, start: m.start, end: m.end, location: m.platform, attendees: m.emails, category: 'Meeting',
        description: `${m.notes ? m.notes + '\n\n' : ''}Platform: ${m.platform}\nScheduled with Fezdev Meetings.`
    });
    const eventVEvent = ev => buildVEvent({
        id: ev.id, title: ev.name, start: ev.start, end: ev.end, location: ev.venue, category: 'Event',
        description: `${ev.description}\n\nHosted by ${ev.host}\nTrack: ${ev.track}\nFormat: ${ev.format}\nPublished with Fezdev Events.`
    });

    function downloadCalendar(vevents, name) {
        const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FEZDEV//Events and Meetings 1.0//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
            ...vevents.flat(), 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
        const url = URL.createObjectURL(new Blob([body], { type: 'text/calendar;charset=utf-8' }));
        const link = el('a', { href: url, download: `${slugify(name)}.ics`, hidden: true });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    /* ------------------------------------------------------------------ 5 toast */
    const TOAST ICONS = { success: '\u2713', error: '!', info: 'i' };
    function toast(message, type = 'info', ms = 4800) {
        let region = $('#toast-region');
        if (!region) {
            region = el('div', { id: 'toast-region', class: 'toast-region', role: 'region', 'aria-label': 'Notifications', 'aria-live': 'polite' });
            document.body.append(region);
        }
        let timer = 0;
        const dismiss = () => {
            clearTimeout(timer);
            node.classList.add('is-leaving');
            setTimeout(() => node.remove(), 300);
        };
        const start = () => { timer = setTimeout(dismiss, ms); };
        const node = el('div', { class: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' },
            el('span', { class: 'toast-icon', 'aria-hidden': 'true' }, TOAST ICONS[type] || 'i'),
            el('p', { class: 'toast-msg' }, message),
            el('button', { type: 'button', class: 'toast-close', 'aria-label': 'Dismiss notification', onclick: dismiss }, '\u00d7'));
        node.addEventListener('mouseenter', () => clearTimeout(timer));
        node.addEventListener('mouseleave', start);
        node.addEventListener('focusin', () => clearTimeout(timer));
        node.addEventListener('focusout', start);
        region.append(node);
        while (region.children.length > 4) region.firstElementChild.remove();
        start();
    }

    /* ------------------------------------------------------------------ 6 modal */
    const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    const focusables = root => $$(FOCUSABLE, root).filter(n => !n.hidden && n.getClientRects().length > 0);

    function trapTab(e, root) {
        if (e.key !== 'Tab') return;
        const items = focusables(root);
        if (!items.length) { e.preventDefault(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }

    let modalState = null;
    const buildAction = a => {
        const cls = ['button', a.primary && 'button-primary', a.danger && 'button-danger'].filter(Boolean).join(' ');
        return a.href
            ? el('a', { class: cls, href: a.href, target: a.target, rel: a.target ? 'noopener noreferrer' : null, onclick: a.onClick }, a.label)
            : el('button', { type: 'button', class: cls, onclick: a.onClick }, a.label);
    };

    function openModal({ title, body, actions = [], onClose }) {
        closeModal(true);
        const opener = document.activeElement;
        const titleId = `modal-title-${Math.random().toString(36).slice(2, 8)}`;
        const dialog = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
            el('div', { class: 'modal-head' },
                el('h2', { id: titleId }, title),
                el('button', { type: 'button', class: 'modal-x', 'aria-label': 'Close dialog', onclick: () => closeModal() }, '\u00d7')),
            el('div', { class: 'modal-body' }, body),
            actions.length ? el('div', { class: 'modal-actions' }, actions.map(buildAction)) : null);
        const backdrop = el('div', { class: 'modal-backdrop' }, dialog);
        const onKey = e => {
            if (e.key === 'Escape') { e.preventDefault(); closeModal(); }
            else trapTab(e, dialog);
        };
        backdrop.addEventListener('mousedown', e => { if (e.target === backdrop) closeModal(); });
        document.addEventListener('keydown', onKey);
        document.body.append(backdrop);
        document.body.classList.add('modal-open');
        modalState = { backdrop, onKey, opener, onClose };
        requestAnimationFrame(() => { backdrop.classList.add('is-open'); dialog.focus(); });
    }

    function closeModal(immediate = false) {
        if (!modalState) return;
        const { backdrop, onKey, opener, onClose } = modalState;
        modalState = null;
        document.removeEventListener('keydown', onKey);
        backdrop.classList.remove('is-open');
        document.body.classList.remove('modal-open');
        if (immediate === true) backdrop.remove(); else setTimeout(() => backdrop.remove(), 260);
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
        if (typeof onClose === 'function') onClose();
    }

    const confirmDialog = ({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Keep it', danger = false }) => new Promise(resolve => {
        let settled = false;
        const finish = value => { if (!settled) { settled = true; resolve(value); } };
        openModal({
            title,
            body: el('p', {}, message),
            onClose: () => finish(false),
            actions: [
                { label: cancelLabel, onClick: () => closeModal() },
                { label: confirmLabel, primary: true, danger, onClick: () => { finish(true); closeModal(); } }
            ]
        });
    });

    /* ------------------------------------------------------------------ 7 navigation */
    function initNav() {
        const toggle = $('.menu-toggle');
        const menu = $('#site-menu');
        const header = $('.site-header');
        if (!toggle || !menu || !header) return;
        const backdrop = el('div', { class: 'menu-backdrop', 'aria-hidden': 'true' });
        document.body.append(backdrop);

        const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
        const setOpen = (open, returnFocus = false) => {
            toggle.setAttribute('aria-expanded', String(open));
            menu.classList.toggle('open', open);
            backdrop.classList.toggle('is-visible', open);
            if (open) { const first = $('a', menu); if (first) first.focus(); }
            else if (returnFocus) toggle.focus();
        };

        toggle.addEventListener('click', () => setOpen(!isOpen()));
        backdrop.addEventListener('click', () => setOpen(false));
        menu.addEventListener('click', e => { if (e.target.closest('a')) setOpen(false); });
        document.addEventListener('keydown', e => {
            if (!isOpen() || modalState) return;
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false, true); }
            else trapTab(e, header);
        });
    }

    /* ------------------------------------------------------------------ 8 validation */
    const parseEmails = raw => [...new Set(String(raw).split(/[\s,;]+/).map(s => s.trim().toLowerCase()).filter(Boolean))];
    const minChars = n => input => (input.value.trim().length < n ? `Use at least ${n} characters.` : '');

    function setFieldState(input, message) {
        const invalid = Boolean(message);
        const field = input.closest('.field');
        const err = field ? $('.field-error', field) : null;
        input.setCustomValidity(message || '');
        input.classList.toggle('is-invalid', invalid);
        input.classList.toggle('is-valid', !invalid && input.value.trim() !== '');
        input.setAttribute('aria-invalid', String(invalid));
        if (err) err.textContent = message || '';
        return !invalid;
    }

    function validateInput(input, custom) {
        input.setCustomValidity('');
        const v = input.validity;
        let message = '';
        if (v.valueMissing) message = input.dataset.requiredMsg || 'This field is required.';
        else if (v.tooShort) message = `Use at least ${input.minLength} characters.`;
        else if (v.tooLong) message = `Use at most ${input.maxLength} characters.`;
        else if (v.rangeUnderflow || v.rangeOverflow) message = 'Choose a date inside the allowed range.';
        else if (v.badInput || v.typeMismatch) message = 'Enter a valid value.';
        else if (custom) message = custom(input) || '';
        return setFieldState(input, message);
    }

    function markGroup(inputs, message) {
        const field = inputs[0].closest('.field');
        const err = field ? $('.field-error', field) : null;
        if (err) err.textContent = message;
        inputs.forEach(input => {
            input.classList.toggle('is-invalid', Boolean(message));
            input.classList.toggle('is-valid', !message && input.value !== '');
            input.setAttribute('aria-invalid', String(Boolean(message)));
        });
        return !message;
    }

    function wireValidation(rules) {
        rules.forEach(({ input, custom }) => {
            ['blur', 'change'].forEach(type => input.addEventListener(type, () => validateInput(input, custom)));
            input.addEventListener('input', () => { if (input.classList.contains('is-invalid')) validateInput(input, custom); });
        });
    }

    function clearState(root) {
        $$('.is-valid, .is-invalid', root).forEach(n => { n.classList.remove('is-valid', 'is-invalid'); n.removeAttribute('aria-invalid'); n.setCustomValidity && n.setCustomValidity(''); });
        $$('.field-error', root).forEach(n => { n.textContent = ''; });
    }

    function failForm(form, firstInvalid) {
        form.classList.remove('shake');
        void form.offsetWidth;
        form.classList.add('shake');
        form.addEventListener('animationend', () => form.classList.remove('shake'), { once: true });
        if (firstInvalid && typeof firstInvalid.focus === 'function') firstInvalid.focus();
        toast('Some fields need attention. Check the highlighted fields.', 'error');
    }
    const firstInvalidField = form => form.querySelector('input.is-invalid, select.is-invalid, textarea.is-invalid');

    /* ------------------------------------------------------------------ 9 lists */
    const emptyBlock = (tag, title, text, action) => el(tag, { class: 'empty' }, el('strong', {}, title), el('span', {}, text), action || null);
    const dateBadge = (date, tz) => el('div', { class: 'item-date', 'aria-hidden': 'true' },
        el('small', {}, fmt(date, tz, { month: 'short' })), el('b', {}, fmt(date, tz, { day: 'numeric' })));

    function meetingItem(m) {
        const start = new Date(m.start);
        const end = new Date(m.end);
        const emails = Array.isArray(m.emails) ? m.emails : [];
        const tz = isValidTz(m.timezone) ? m.timezone : BROWSER TZ;
        return el('li', { class: 'item' },
            dateBadge(start, tz),
            el('div', {},
                el('h3', {}, m.title),
                el('p', { class: 'meta' }, `${fmt(start, tz, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} \u2013 ${fmtTime(end, tz)} \u00b7 ${nice(tz)}`),
                el('p', { class: 'meta' }, `${m.platform} \u00b7 ${emails.length} participant${emails.length === 1 ? '' : 's'}`)),
            el('div', { class: 'item-actions' },
                el('button', { type: 'button', class: 'button button-small', onclick: () => downloadCalendar([meetingVEvent({ ...m, emails })], m.title) }, 'Add to calendar'),
                el('button', { type: 'button', class: 'button button-small button-danger', onclick: () => cancelMeeting(m) }, 'Cancel meeting')));
    }

    async function cancelMeeting(m) {
        const ok = await confirmDialog({
            title: 'Cancel this meeting?',
            message: `"${m.title}" will be removed and its time slot opens up again. Participants are not notified automatically.`,
            confirmLabel: 'Cancel meeting', danger: true
        });
        if (!ok) return;
        saveMeetings(getMeetings().filter(x => x.id !== m.id));
        toast('Meeting cancelled. The time slot is open again.', 'info');
    }

    function eventItem(ev) {
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        const tz = isValidTz(ev.timezone) ? ev.timezone : BROWSER TZ;
        const ended = end.getTime() < Date.now();
        return el('li', { class: 'item' },
            dateBadge(start, tz),
            el('div', {},
                el('h3', {}, ev.name),
                el('p', { class: 'meta' }, `${fmtDateTime(start, tz)} \u00b7 ${ev.category}`),
                el('p', { class: 'meta' }, `${ev.format} \u00b7 ${ev.venue}`),
                ended ? el('span', { class: 'badge badge-muted' }, 'Ended') : null),
            el('div', { class: 'item-actions' },
                el('button', { type: 'button', class: 'button button-small', onclick: () => downloadCalendar([eventVEvent(ev)], ev.name) }, 'Add to calendar'),
                el('button', { type: 'button', class: 'button button-small button-danger', onclick: () => unpublishEvent(ev) }, 'Unpublish')));
    }

    async function unpublishEvent(ev) {
        const ok = await confirmDialog({
            title: 'Unpublish this event?',
            message: `"${ev.name}" will disappear from the homepage listing. You can publish it again later.`,
            confirmLabel: 'Unpublish', danger: true
        });
        if (!ok) return;
        saveEvents(getEvents().filter(x => x.id !== ev.id));
        toast('Event unpublished and removed from the listing.', 'info');
    }

    function communityCard(ev) {
        const start = new Date(ev.start);
        const tz = isValidTz(ev.timezone) ? ev.timezone : BROWSER TZ;
        return el('article', { class: 'event-card community-card' },
            el('span', { class: 'badge badge-primary' }, ev.category),
            el('h3', {}, ev.name),
            el('p', { class: 'event-meta' }, `${fmtDateTime(start, tz)} \u00b7 ${ev.format}`),
            el('p', {}, truncate(String(ev.description || ''), 180)),
            el('p', { class: 'event-meta' }, `Hosted by ${ev.host} \u00b7 ${ev.track}`),
            el('div', { class: 'button-row' },
                el('button', { type: 'button', class: 'button button-small', onclick: () => downloadCalendar([eventVEvent(ev)], ev.name) }, 'Add to calendar')));
    }

    function renderLists() {
        const now = Date.now();
        const safe = (items, build) => items.flatMap(item => { try { return [build(item)]; } catch { return []; } });
        const action = box => (box.dataset.emptyHref
            ? el('a', { class: 'button button-small', href: box.dataset.emptyHref }, box.dataset.emptyLabel || 'Get started') : null);

        $$('[data-list="meetings"]').forEach(box => {
            const items = getMeetings().filter(m => Date.parse(m.end) > now).sort(byStart);
            const nodes = safe(items, meetingItem);
            box.replaceChildren(...(nodes.length ? nodes
                : [emptyBlock('li', 'No upcoming meetings', 'Meetings you schedule on this device appear here.', action(box))]));
        });
        $$('[data-list="my-events"]').forEach(box => {
            const items = getEvents().sort(byStart);
            const nodes = safe(items, eventItem);
            box.replaceChildren(...(nodes.length ? nodes
                : [emptyBlock('li', 'Nothing published yet', 'Events you publish with the form appear here.', action(box))]));
        });
        $$('[data-list="community-events"]').forEach(box => {
            const items = getEvents().filter(ev => Date.parse(ev.end) > now).sort(byStart);
            const nodes = safe(items, communityCard);
            box.replaceChildren(...(nodes.length ? nodes
                : [emptyBlock('div', 'No community events yet', 'Events published from this browser show up here.', action(box))]));
        });
    }

    /* ------------------------------------------------------------------ 10 meeting booking */
    const overlaps = (start, end, bufferMin, meetings) => meetings.some(m => {
        const s = Date.parse(m.start);
        const e = Date.parse(m.end);
        return start.getTime() < e + bufferMin * MINUTE && end.getTime() + bufferMin * MINUTE > s;
    });

    /** Every slot of one calendar day (as seen in `tz`) that falls inside the host's working hours. */
    function computeSlots(dateStr, tz, duration, host, meetings) {
        const [y, m, d] = dateStr.split('-').map(Number);
        const now = Date.now();
        const slots = [];
        for (let min = 0; min + duration <= 1440; min += duration) {
            const start = zonedToUtc(y, m, d, Math.floor(min / 60), min % 60, tz);
            if (slots.length && slots[slots.length - 1].start.getTime() === start.getTime()) continue;
            const end = new Date(start.getTime() + duration * MINUTE);
            const hp = tzParts(start, host.timezone);
            const hostMinute = hp.hour * 60 + hp.minute;
            if (!host.days.includes(WEEKDAYS.indexOf(hp.weekday))) continue;
            if (hostMinute < host.startMin || hostMinute + duration > host.endMin) continue;
            const booked = overlaps(start, end, host.buffer, meetings);
            const past = start.getTime() <= now;
            slots.push({ start, end, booked, past, disabled: booked || past });
        }
        return slots;
    }

    function initBooking() {
        const form = $('#hostMeetingForm');
        if (!form) return;
        const title = $('#meetingTitle');
        const tzSelect = $('#meetingTz');
        const dateInput = $('#meetingDate');
        const grid = $('#slotGrid');
        const help = $('#slotHelp');
        const slotError = $('#slot-error');
        const emails = $('#meetingEmails');
        const duration = () => Number(form.elements.duration.value) || 30;

        fillTimezoneSelect(tzSelect, BROWSER TZ);
        $('#tzHint').textContent = `Detected automatically: ${nice(BROWSER TZ)}. Switch zones to book for someone elsewhere.`;

        const setSlotError = message => { slotError.textContent = message; grid.classList.toggle('is-invalid', Boolean(message)); };
        const updateBounds = () => {
            const today = todayIn(tzSelect.value);
            dateInput.min = today;
            dateInput.max = addDays(today, 180);
            if (dateInput.value && dateInput.value < today) dateInput.value = '';
        };

        function renderSlots() {
            const checked = $('input[name="slot"]:checked', grid);
            const previous = checked ? checked.value : '';
            const tz = tzSelect.value;
            grid.replaceChildren();
            setSlotError('');
            if (!dateInput.value) {
                grid.append(el('p', { class: 'slot-empty' }, 'Pick a date to see open times.'));
                help.textContent = '';
                return;
            }
            const slots = computeSlots(dateInput.value, tz, duration(), getHost(), getMeetings());
            if (!slots.length) {
                grid.append(el('p', { class: 'slot-empty' }, 'No working hours fall on this day. Pick another date or change the host availability.'));
                help.textContent = '0 open times';
                return;
            }
            slots.forEach((slot, i) => {
                const iso = slot.start.toISOString();
                const id = `slot-${i}`;
                grid.append(el('label', { class: 'slot', for: id, style: `--i:${i}` },
                    el('input', { type: 'radio', name: 'slot', id, value: iso, disabled: slot.disabled, checked: !slot.disabled && iso === previous }),
                    el('span', {}, fmtTime(slot.start, tz), slot.disabled ? el('small', {}, slot.booked ? 'Booked' : 'Passed') : null)));
            });
            const open = slots.filter(s => !s.disabled).length;
            help.textContent = `${open} open time${open === 1 ? '' : 's'} \u00b7 ${duration()}-minute meetings \u00b7 shown in ${nice(tz)}`;
        }

        const rules = [
            { input: title, custom: minChars(3) },
            { input: dateInput },
            { input: emails, custom: input => {
                const list = parseEmails(input.value);
                if (!list.length) return 'Add at least one participant email.';
                const bad = list.filter(e => !EMAIL RE.test(e));
                if (bad.length) return `Check these addresses: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '\u2026' : ''}`;
                return list.length > 50 ? 'The limit is 50 participants per meeting.' : '';
            } }
        ];
        wireValidation(rules);

        tzSelect.addEventListener('change', () => { updateBounds(); renderSlots(); });
        dateInput.addEventListener('change', renderSlots);
        $$('input[name="duration"]', form).forEach(r => r.addEventListener('change', renderSlots));
        grid.addEventListener('change', () => setSlotError(''));
        window.addEventListener('fezdev:data', renderSlots);

        $('#nextOpen').addEventListener('click', () => {
            const tz = tzSelect.value;
            const today = todayIn(tz);
            for (let i = 0; i <= 180; i++) {
                const day = addDays(today, i);
                const slots = computeSlots(day, tz, duration(), getHost(), getMeetings());
                const free = slots.find(s => !s.disabled);
                if (free) {
                    dateInput.value = day;
                    validateInput(dateInput);
                    renderSlots();
                    toast(`Next opening: ${fmtDateTime(free.start, tz)}.`, 'info');
                    const first = $('input[name="slot"]:not(:disabled)', grid);
                    if (first) first.focus();
                    return;
                }
            }
            toast('No openings in the next 180 days. Check the host availability settings.', 'error');
        });

        form.addEventListener('submit', e => {
            e.preventDefault();
            const results = rules.map(r => validateInput(r.input, r.custom));
            const picked = $('input[name="slot"]:checked', grid);
            setSlotError(picked ? '' : 'Select an available time slot.');
            if (results.includes(false) || !picked) {
                failForm(form, firstInvalidField(form) || $('input[name="slot"]:not(:disabled)', grid));
                return;
            }
            const host = getHost();
            const meetings = getMeetings();
            const minutes = duration();
            const start = new Date(picked.value);
            const end = new Date(start.getTime() + minutes * MINUTE);
            if (start.getTime() <= Date.now() || overlaps(start, end, host.buffer, meetings)) {
                toast('That time is no longer available. Pick another slot.', 'error');
                renderSlots();
                return;
            }
            const meeting = {
                id: uid(), title: title.value.trim(), start: start.toISOString(), end: end.toISOString(), duration: minutes,
                timezone: tzSelect.value, platform: $('#meetingPlatform').value, emails: parseEmails(emails.value),
                notes: $('#meetingNotes').value.trim(), createdAt: new Date().toISOString()
            };
            const saved = saveMeetings([...meetings, meeting]);
            downloadCalendar([meetingVEvent(meeting)], meeting.title);
            showMeetingConfirmation(meeting);
            toast(saved ? 'Meeting scheduled. Calendar file downloaded.' : 'Meeting scheduled for this session only. Browser storage is unavailable.', saved ? 'success' : 'info');
            title.value = ''; emails.value = ''; $('#meetingNotes').value = '';
            clearState(form);
            renderSlots();
        });

        updateBounds();
        renderSlots();
    }

    function mailtoFor(m) {
        const when = `${fmtDateTime(new Date(m.start), m.timezone)} (${nice(m.timezone)})`;
        const body = ['Hi,', '', `You are invited to "${m.title}".`, '', `When: ${when}`, `Length: ${m.duration} minutes`, `Platform: ${m.platform}`,
            m.notes ? `\nAgenda:\n${m.notes}` : '', '', 'Add the meeting to your calendar with the attached .ics file.'].join('\n');
        return `mailto:${m.emails.join(',')}?subject=${encodeURIComponent('Invitation: ' + m.title)}&body=${encodeURIComponent(body)}`;
    }

    function showMeetingConfirmation(m) {
        const start = new Date(m.start);
        const end = new Date(m.end);
        const rows = [
            ['Meeting', m.title],
            ['When', `${fmtDateTime(start, m.timezone)} \u2013 ${fmtTime(end, m.timezone)}`],
            ['Time zone', `${nice(m.timezone)} (${offsetLabel(m.timezone, start)})`],
            ['Platform', m.platform],
            ['Participants', m.emails.join(', ')]
        ];
        openModal({
            title: 'Meeting scheduled',
            body: [
                el('p', {}, 'Your meeting is saved and a calendar file (.ics) was downloaded. Open it to add the meeting to Google Calendar, Apple Calendar or Outlook.'),
                el('dl', { class: 'summary' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)])),
                el('p', { class: 'field-hint' }, 'A browser cannot send email by itself. Use the buttons below to create the conference room and to open a ready-written invitation in your mail app.')
            ],
            actions: [
                { label: `Create ${m.platform} room \u2197`, href: ROOMS[m.platform] || ROOMS['Google Meet'], target: ' blank' },
                { label: 'Write invitation email', href: mailtoFor(m) },
                { label: 'Done', primary: true, onClick: () => closeModal() }
            ]
        });
    }

    /* ------------------------------------------------------------------ 11 availability */
    function initAvailability() {
        const form = $('#availabilityForm');
        if (!form) return;
        const startSel = $('#availStart');
        const endSel = $('#availEnd');
        const bufferSel = $('#availBuffer');
        const tzSel = $('#availTz');
        const daysError = $('#availDays-error');

        for (let m = 0; m < 1440; m += 30) startSel.append(el('option', { value: m }, minuteLabel(m)));
        for (let m = 30; m <= 1440; m += 30) endSel.append(el('option', { value: m }, minuteLabel(m)));

        const load = () => {
            const host = getHost();
            $$('input[name="days"]', form).forEach(box => { box.checked = host.days.includes(Number(box.value)); });
            startSel.value = String(host.startMin);
            endSel.value = String(host.endMin);
            bufferSel.value = String(host.buffer);
            fillTimezoneSelect(tzSel, host.timezone);
            clearState(form);
            daysError.textContent = '';
        };

        form.addEventListener('submit', e => {
            e.preventDefault();
            const days = $$('input[name="days"]:checked', form).map(box => Number(box.value));
            const startMin = Number(startSel.value);
            const endMin = Number(endSel.value);
            daysError.textContent = days.length ? '' : 'Select at least one working day.';
            const timeOk = endMin - startMin >= 15;
            setFieldState(endSel, timeOk ? '' : 'The end time must be after the start time.');
            if (!days.length || !timeOk) { toast('Availability was not saved. Fix the highlighted fields.', 'error'); return; }
            const ok = store.write(KEYS.host, { days, startMin, endMin, buffer: Number(bufferSel.value), timezone: tzSel.value });
            notify();
            toast(ok ? 'Availability saved. Open times are updated.' : 'Availability applied for this session only.', ok ? 'success' : 'info');
        });
        $('#availReset').addEventListener('click', () => {
            store.write(KEYS.host, { ...DEFAULT HOST, timezone: BROWSER TZ });
            notify();
            load();
            toast('Availability reset to Monday to Friday, 9:00 AM to 5:00 PM.', 'info');
        });
        load();
    }

    /* ------------------------------------------------------------------ 12 event publishing */
    const FORMATS = {
        'In person': { label: 'Venue and address *', placeholder: 'Landmark Centre, Victoria Island, Lagos' },
        'Online': { label: 'Streaming link *', placeholder: 'https://example.com/live' },
        'Hybrid': { label: 'Venue and streaming link *', placeholder: 'Venue address and https://example.com/live' }
    };

    function initPublish() {
        const form = $('#publishEventForm');
        if (!form) return;
        const name = $('#evName');
        const tzSel = $('#evTz');
        const sd = $('#evStartDate'); const st = $('#evStartTime');
        const ed = $('#evEndDate'); const et = $('#evEndTime');
        const venue = $('#evVenue');
        const venueLabel = $('#evVenueLabel');
        const desc = $('#evDescription');
        const count = $('#descCount');
        const host = $('#evHost');

        fillTimezoneSelect(tzSel, BROWSER TZ);
        $('#evTzHint').textContent = `Detected automatically: ${nice(BROWSER TZ)}. Start and end times use the zone you choose here.`;

        const currentFormat = () => form.elements.format.value || 'In person';
        const syncFormat = () => {
            const conf = FORMATS[currentFormat()];
            venueLabel.textContent = conf.label;
            venue.placeholder = conf.placeholder;
            if (venue.value) validateInput(venue, venueCheck);
        };
        const venueCheck = input => {
            const value = input.value.trim();
            if (value.length < 3) return 'Enter at least 3 characters.';
            if (currentFormat() === 'Online') {
                let ok = true;
                try { ok = /^https?:$/.test(new URL(value).protocol); } catch { ok = false; }
                if (!ok) return 'Enter a full link that starts with https://';
            }
            return '';
        };

        const instant = (dateEl, timeEl) => {
            if (!dateEl.value || !timeEl.value) return null;
            const [y, m, d] = dateEl.value.split('-').map(Number);
            const [h, mi] = timeEl.value.split(':').map(Number);
            return zonedToUtc(y, m, d, h, mi, tzSel.value);
        };
        const updateBounds = () => {
            const today = todayIn(tzSel.value);
            sd.min = today;
            ed.min = sd.value && sd.value > today ? sd.value : today;
        };
        function validateTimes() {
            const s = instant(sd, st);
            const e = instant(ed, et);
            let startMsg = '';
            let endMsg = '';
            if (!s) startMsg = 'Choose a start date and time.';
            else if (s.getTime() <= Date.now()) startMsg = 'The start must be in the future.';
            if (!e) endMsg = 'Choose an end date and time.';
            else if (s && e.getTime() <= s.getTime()) endMsg = 'The end must be after the start.';
            const a = markGroup([sd, st], startMsg);
            const b = markGroup([ed, et], endMsg);
            return a && b;
        }

        const rules = [
            { input: name, custom: minChars(3) },
            { input: venue, custom: venueCheck },
            { input: desc, custom: input => input.value.trim() ? minChars(20)(input) : '' }
        ];
        wireValidation(rules);
        [sd, st, ed, et].forEach(input => input.addEventListener('change', () => { updateBounds(); validateTimes(); }));
        tzSel.addEventListener('change', () => { updateBounds(); if (sd.value || ed.value) validateTimes(); });
        $$('input[name="format"]', form).forEach(r => r.addEventListener('change', syncFormat));
        desc.addEventListener('input', () => { count.textContent = `${desc.value.length}/${desc.maxLength}`; });

        form.addEventListener('submit', e => {
            e.preventDefault();
            const results = rules.map(r => validateInput(r.input, r.custom));
            const timesOk = validateTimes();
            if (results.includes(false) || !timesOk) { failForm(form, firstInvalidField(form)); return; }
            const event = {
                id: uid(), name: name.value.trim(), category: $('#evCategory').value, track: $('#evTrack').value,
                format: currentFormat(), venue: venue.value.trim(), host: host.value.trim() || 'Fezdev Events',
                description: desc.value.trim(), speakers: $('#evSpeakers').checked, timezone: tzSel.value,
                start: instant(sd, st).toISOString(), end: instant(ed, et).toISOString(), publishedAt: new Date().toISOString()
            };
            const saved = saveEvents([...getEvents(), event]);
            showPublishConfirmation(event);
            toast(saved ? 'Event published to the listing.' : 'Event published for this session only. Browser storage is unavailable.', saved ? 'success' : 'info');
            form.reset();
            clearState(form);
            count.textContent = `0/${desc.maxLength}`;
            syncFormat();
            updateBounds();
        });

        updateBounds();
        syncFormat();
    }

    function showPublishConfirmation(ev) {
        const start = new Date(ev.start);
        const end = new Date(ev.end);
        const rows = [
            ['Event', ev.name],
            ['Category', ev.category],
            ['Starts', fmtDateTime(start, ev.timezone)],
            ['Ends', fmtDateTime(end, ev.timezone)],
            ['Time zone', `${nice(ev.timezone)} (${offsetLabel(ev.timezone, start)})`],
            ['Format', `${ev.format} \u00b7 ${ev.venue}`],
            ['Host', `${ev.host} \u00b7 ${ev.track}`],
            ['Speakers directory', ev.speakers ? 'Published with the event' : 'Hidden until you publish it']
        ];
        openModal({
            title: 'Event published',
            body: [
                el('p', {}, 'Your event is live in the Fezdev listing on this device and appears under community events on the homepage.'),
                el('dl', { class: 'summary' }, rows.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))
            ],
            actions: [
                { label: 'Add to calendar', onClick: () => downloadCalendar([eventVEvent(ev)], ev.name) },
                { label: 'View on homepage', href: 'index.html#community-events' },
                { label: 'Done', primary: true, onClick: () => closeModal() }
            ]
        });
    }

    /* ------------------------------------------------------------------ 13 boot */
    function initDataReset() {
        $$('[data-action="clear-data"]').forEach(button => button.addEventListener('click', async () => {
            const ok = await confirmDialog({
                title: 'Clear saved data?',
                message: 'This removes every meeting, published event and availability setting stored in this browser. It cannot be undone.',
                confirmLabel: 'Clear data', danger: true
            });
            if (!ok) return;
            Object.values(KEYS).forEach(key => store.remove(key));
            notify();
            toast('Saved meetings, events and availability were cleared.', 'info');
        }));
    }

    function boot() {
        initNav();
        initBooking();
        initAvailability();
        initPublish();
        initDataReset();
        renderLists();
        window.addEventListener('fezdev:data', renderLists);
        window.addEventListener('storage', e => { if (e.key && e.key.startsWith(NS)) notify(); });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
