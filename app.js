/**
 * ================================================================
 *  NoteFlow — Smart Notes App
 *  app.js  |  Complete Application Logic
 *
 *  Modules:
 *   1. Config & State
 *   2. Storage
 *   3. Utilities
 *   4. Toast Notifications
 *   5. Note Model
 *   6. Filter & Sort
 *   7. Card Renderer
 *   8. Tags Navigation
 *   9. Stats
 *  10. Voice (Web Speech API)
 *  11. Password Modal
 *  12. Note Editor Modal
 *  13. Reminders
 *  14. Import / Export
 *  15. App Controller (main)
 * ================================================================
 */

'use strict';

/* ================================================================
   1. CONFIG & STATE
   ================================================================ */
const CONFIG = {
  STORAGE_KEY_NOTES:  'noteflow_v2_notes',
  STORAGE_KEY_THEME:  'noteflow_v2_theme',
  AUTOSAVE_DELAY:     1500,   // ms
  REMINDER_INTERVAL:  20000,  // ms (check every 20s)
  TOAST_DURATION:     3000,   // ms
};

/** Central application state */
const State = {
  notes:           [],      // Array of note objects
  editingNoteId:   null,    // null = new note, string = editing existing
  navFilter:       'all',   // 'all' | 'pinned' | 'locked' | 'reminder'
  tagFilter:       null,    // active tag string or null
  searchQuery:     '',
  sortOrder:       'latest',
  autoSaveTimer:   null,
  reminderTimer:   null,
  firedReminders:  new Set(),
};


/* ================================================================
   2. STORAGE
   ================================================================ */
const Storage = {
  /** Load notes from localStorage */
  loadNotes() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY_NOTES);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('NoteFlow: could not load notes', e);
      return [];
    }
  },

  /** Save notes to localStorage */
  saveNotes(notes) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY_NOTES, JSON.stringify(notes));
      return true;
    } catch (e) {
      Toast.show('Storage full — could not save!', 'error');
      return false;
    }
  },

  /** Load saved theme preference */
  loadTheme() {
    return localStorage.getItem(CONFIG.STORAGE_KEY_THEME) || 'light';
  },

  /** Save theme preference */
  saveTheme(theme) {
    localStorage.setItem(CONFIG.STORAGE_KEY_THEME, theme);
  },
};


/* ================================================================
   3. UTILITIES
   ================================================================ */
const Utils = {
  /** Generate a unique ID */
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  },

  /** Format ISO date to relative/readable string */
  formatDate(iso) {
    if (!iso) return '';
    const d   = new Date(iso);
    const now = new Date();
    const ms  = now - d;
    const s   = Math.floor(ms / 1000);
    const m   = Math.floor(s / 60);
    const h   = Math.floor(m / 60);
    const day = Math.floor(h / 24);

    if (s < 10)   return 'Just now';
    if (m < 1)    return `${s}s ago`;
    if (m < 60)   return `${m}m ago`;
    if (h < 24)   return `${h}h ago`;
    if (day === 1) return 'Yesterday';
    if (day < 7)  return `${day}d ago`;

    return d.toLocaleDateString('en-US', {
      month: 'short',
      day:   'numeric',
      year:  d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  },

  /** Strip HTML tags, return plain text */
  stripHtml(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html || '';
    return tmp.textContent || tmp.innerText || '';
  },

  /** Count words in text */
  countWords(text) {
    const plain = this.stripHtml(text).trim();
    return plain ? plain.split(/\s+/).filter(Boolean).length : 0;
  },

  /** Safely escape HTML for attribute/text output */
  esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },

  /** Check if a date string is today */
  isToday(iso) {
    return new Date(iso).toDateString() === new Date().toDateString();
  },

  /** Debounce a function */
  debounce(fn, delay) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  },

  /** Shallow clone an object */
  clone(obj) {
    return { ...obj };
  },
};


/* ================================================================
   4. TOAST NOTIFICATIONS
   ================================================================ */
const Toast = {
  container: null,

  init() {
    this.container = document.getElementById('toastStack');
  },

  /**
   * Show a toast notification
   * @param {string} msg
   * @param {'success'|'error'|'info'|'warning'} type
   * @param {number} duration  ms
   */
  show(msg, type = 'info', duration = CONFIG.TOAST_DURATION) {
    const icons = {
      success: 'bi-check-circle-fill',
      error:   'bi-x-circle-fill',
      info:    'bi-info-circle-fill',
      warning: 'bi-exclamation-triangle-fill',
    };

    const el = document.createElement('div');
    el.className = `toast-item ${type}`;
    el.style.setProperty('--toast-dur', duration + 'ms');
    el.innerHTML = `
      <i class="bi ${icons[type] || icons.info} t-icon"></i>
      <span>${this._esc(msg)}</span>
      <div class="toast-progress-bar"></div>
    `;

    this.container.appendChild(el);

    // Auto-remove
    setTimeout(() => {
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 280);
    }, duration);
  },

  _esc(str) {
    return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  },
};


/* ================================================================
   5. NOTE MODEL
   ================================================================ */
const NoteModel = {
  /**
   * Create a new note object
   * @param {Partial<Note>} data
   * @returns {Note}
   */
  create(data = {}) {
    const now = new Date().toISOString();
    return {
      id:        Utils.uid(),
      title:     data.title    || 'Untitled Note',
      content:   data.content  || '',
      tags:      data.tags     || [],
      pinned:    data.pinned   || false,
      locked:    data.locked   || false,
      password:  data.password || null,
      reminder:  data.reminder || null,
      color:     data.color    || '#F59E0B',
      order:     data.order    !== undefined ? data.order : Date.now(),
      createdAt: now,
      updatedAt: now,
    };
  },

  /**
   * Return an updated copy of a note
   * @param {Note} note
   * @param {Partial<Note>} changes
   * @returns {Note}
   */
  update(note, changes) {
    return {
      ...note,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
  },
};


/* ================================================================
   6. FILTER & SORT
   ================================================================ */
const FilterSort = {
  /**
   * Apply nav filter, tag filter, search, and sort to notes array
   * @returns {Note[]}
   */
  apply(notes) {
    let list = [...notes];

    // Nav filter
    if (State.navFilter === 'pinned')   list = list.filter(n => n.pinned);
    if (State.navFilter === 'locked')   list = list.filter(n => n.locked);
    if (State.navFilter === 'reminder') list = list.filter(n => !!n.reminder);

    // Tag filter
    if (State.tagFilter) {
      list = list.filter(n => n.tags.includes(State.tagFilter));
    }

    // Search
    const q = State.searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(n =>
        n.title.toLowerCase().includes(q) ||
        Utils.stripHtml(n.content).toLowerCase().includes(q) ||
        n.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    // Sort
    list.sort((a, b) => {
      switch (State.sortOrder) {
        case 'latest':     return new Date(b.updatedAt) - new Date(a.updatedAt);
        case 'oldest':     return new Date(a.updatedAt) - new Date(b.updatedAt);
        case 'alpha':      return a.title.localeCompare(b.title);
        case 'alpha-desc': return b.title.localeCompare(a.title);
        default:           return (b.order || 0) - (a.order || 0);
      }
    });

    return list;
  },
};


/* ================================================================
   7. CARD RENDERER
   ================================================================ */
const CardRenderer = {
  /**
   * Build a note card DOM element
   * @param {Note} note
   * @returns {HTMLElement}
   */
  build(note) {
    const card = document.createElement('article');
    card.className = `note-card${note.pinned ? ' pinned' : ''}`;
    card.dataset.id = note.id;
    card.setAttribute('draggable', 'true');
    card.style.setProperty('--card-color', note.color || '#F59E0B');

    // Content preview (plain text, capped)
    const preview = Utils.stripHtml(note.content).slice(0, 260).trim();

    // Tags HTML
    const tagsHtml = note.tags.length
      ? `<div class="card-tags">
          ${note.tags.map(t => `<button class="tag-pill" data-tag="${Utils.esc(t)}">${Utils.esc(t)}</button>`).join('')}
         </div>`
      : '';

    // Badges
    const badges = [
      note.pinned   ? `<span class="badge badge-pin"><i class="bi bi-pin-fill"></i> Pinned</span>` : '',
      note.locked   ? `<span class="badge badge-lock"><i class="bi bi-lock-fill"></i> Locked</span>` : '',
      note.reminder ? `<span class="badge badge-bell"><i class="bi bi-bell-fill"></i></span>` : '',
    ].filter(Boolean).join('');

    card.innerHTML = `
      <div class="card-top">
        <h3 class="card-title">${Utils.esc(note.title)}</h3>
        <div class="card-btns">
          <button class="card-btn${note.pinned ? ' active' : ''}" data-action="pin" title="${note.pinned ? 'Unpin' : 'Pin'}">
            <i class="bi bi-pin-angle${note.pinned ? '-fill' : ''}"></i>
          </button>
          <button class="card-btn delete" data-action="delete" title="Delete note">
            <i class="bi bi-trash3"></i>
          </button>
        </div>
      </div>

      <p class="card-body">${
        note.locked
          ? '<i class="bi bi-lock"></i> <em>Note is password-protected</em>'
          : (preview || '<em style="color:var(--text-muted)">No content yet…</em>')
      }</p>

      ${tagsHtml}

      <div class="card-footer">
        <span class="card-date">
          <i class="bi bi-clock"></i>
          ${Utils.formatDate(note.updatedAt)}
        </span>
        <div class="card-badges">${badges}</div>
      </div>
    `;

    /* ── Events ── */

    // Open note on click (not on action buttons)
    card.addEventListener('click', (e) => {
      if (e.target.closest('[data-action]') || e.target.closest('.tag-pill')) return;
      App.openNote(note.id);
    });

    // Pin/Unpin
    card.querySelector('[data-action="pin"]').addEventListener('click', (e) => {
      e.stopPropagation();
      App.togglePin(note.id);
    });

    // Delete
    card.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      App.deleteNote(note.id);
    });

    // Tag filter click
    card.querySelectorAll('.tag-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        App.setTagFilter(pill.dataset.tag);
      });
    });

    /* ── Drag & Drop ── */
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', note.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => card.classList.add('is-dragging'));
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      card.classList.add('drag-over');
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== note.id) {
        App.reorderNote(fromId, note.id);
      }
    });

    return card;
  },
};


/* ================================================================
   8. TAGS NAVIGATION
   ================================================================ */
const TagsNav = {
  container: null,

  init() {
    this.container = document.getElementById('tagsList');
  },

  render() {
    // Collect all unique tags
    const allTags = [...new Set(State.notes.flatMap(n => n.tags))].sort();

    if (!allTags.length) {
      this.container.innerHTML = '<p class="no-tags-msg">No tags yet</p>';
      return;
    }

    this.container.innerHTML = allTags.map(tag => `
      <button class="tag-nav-btn${State.tagFilter === tag ? ' active' : ''}" data-tag="${Utils.esc(tag)}">
        <span class="tag-dot"></span>
        <span>${Utils.esc(tag)}</span>
      </button>
    `).join('');

    this.container.querySelectorAll('.tag-nav-btn').forEach(btn => {
      btn.addEventListener('click', () => App.setTagFilter(btn.dataset.tag));
    });
  },
};


/* ================================================================
   9. STATS
   ================================================================ */
const Stats = {
  update() {
    const notes   = State.notes;
    const total   = notes.length;
    const pinned  = notes.filter(n => n.pinned).length;
    const locked  = notes.filter(n => n.locked).length;
    const remind  = notes.filter(n => !!n.reminder).length;
    const today   = notes.filter(n => Utils.isToday(n.createdAt)).length;
    const rawWds  = notes.reduce((s, n) => s + Utils.countWords(n.content), 0);
    const words   = rawWds > 9999
      ? (rawWds / 1000).toFixed(1) + 'k'
      : rawWds;

    // Sidebar stats
    document.getElementById('statTotal').textContent  = total;
    document.getElementById('statPinned').textContent = pinned;
    document.getElementById('statToday').textContent  = today;
    document.getElementById('statWords').textContent  = words;

    // Nav badges
    document.getElementById('navAllCount').textContent      = total;
    document.getElementById('navPinnedCount').textContent   = pinned;
    document.getElementById('navLockedCount').textContent   = locked;
    document.getElementById('navReminderCount').textContent = remind;
  },
};


/* ================================================================
   10. VOICE (Web Speech API)
   ================================================================ */
const Voice = {
  recognition:  null,
  isRecording:  false,
  supported:    false,

  init() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      // Disable button gracefully
      const btn = document.getElementById('btnVoice');
      btn.title   = 'Voice input not supported in this browser';
      btn.style.opacity = '0.4';
      btn.style.cursor  = 'not-allowed';
      return;
    }

    this.supported      = true;
    this.recognition    = new SpeechRecognition();
    this.recognition.continuous      = true;
    this.recognition.interimResults  = true;
    this.recognition.lang            = 'en-US';

    // Append final transcripts to the content area
    this.recognition.onresult = (event) => {
      const area = document.getElementById('noteContent');
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          area.innerHTML += event.results[i][0].transcript + ' ';
          NoteEditorModal.updateCounters();
        }
      }
    };

    this.recognition.onerror = (e) => {
      Toast.show(`Voice error: ${e.error}`, 'error');
      this.stop();
    };

    this.recognition.onend = () => {
      if (this.isRecording) this.stop();
    };

    // Button events
    document.getElementById('btnVoice').addEventListener('click', () => this.toggle());
    document.getElementById('btnStopVoice').addEventListener('click', () => this.stop());
  },

  toggle() {
    this.isRecording ? this.stop() : this.start();
  },

  start() {
    if (!this.supported) {
      Toast.show('Voice input not supported in this browser', 'warning');
      return;
    }
    try {
      this.recognition.start();
      this.isRecording = true;
      document.getElementById('voiceBar').style.display  = 'flex';
      document.getElementById('btnVoice').classList.add('active');
      Toast.show('Listening… speak now', 'info', 2000);
    } catch (e) {
      Toast.show('Could not start voice input', 'error');
    }
  },

  stop() {
    if (!this.supported) return;
    try { this.recognition.stop(); } catch {}
    this.isRecording = false;
    document.getElementById('voiceBar').style.display   = 'none';
    document.getElementById('btnVoice').classList.remove('active');
  },
};


/* ================================================================
   11. PASSWORD MODAL
   ================================================================ */
const PasswordModal = {
  _callback: null,

  init() {
    document.getElementById('pwBtnOk').addEventListener('click', () => {
      const pw = document.getElementById('pwInput').value.trim();
      if (!pw) { Toast.show('Please enter a password', 'warning'); return; }
      this._close();
      if (this._callback) this._callback(pw);
    });

    document.getElementById('pwBtnCancel').addEventListener('click', () => {
      this._close();
    });

    document.getElementById('pwInput').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('pwBtnOk').click();
    });
  },

  /**
   * Open the password modal
   * @param {'lock'|'unlock'} mode
   * @param {Function} callback  receives the entered password string
   */
  open(mode, callback) {
    this._callback = callback;
    const isLock   = mode === 'lock';
    document.getElementById('pwTitle').textContent = isLock ? 'Lock Note' : 'Unlock Note';
    document.getElementById('pwDesc').textContent  = isLock
      ? 'Set a password to protect this note.'
      : 'Enter the password to view this note.';
    document.getElementById('pwInput').value = '';
    document.getElementById('pwOverlay').style.display = 'block';
    document.getElementById('pwModal').style.display   = 'block';
    setTimeout(() => document.getElementById('pwInput').focus(), 60);
  },

  _close() {
    document.getElementById('pwOverlay').style.display = 'none';
    document.getElementById('pwModal').style.display   = 'none';
  },
};


/* ================================================================
   12. NOTE EDITOR MODAL
   ================================================================ */
const NoteEditorModal = {
  isOpen:   false,
  noteId:   null,  // null = new note

  init() {
    // Close buttons
    document.getElementById('btnModalClose').addEventListener('click',  () => this.close());
    document.getElementById('btnCancelNote').addEventListener('click',  () => this.close());
    document.getElementById('noteModalOverlay').addEventListener('click', () => this.close());

    // Save button
    document.getElementById('btnSaveNote').addEventListener('click', () => App.saveNote());

    // Delete button (inside modal)
    document.getElementById('btnModalDelete').addEventListener('click', () => {
      if (this.noteId) {
        App.deleteNote(this.noteId, true); // silent confirm
        this.close();
      }
    });

    // Pin toggle in modal header
    document.getElementById('btnModalPin').addEventListener('click', () => {
      this._togglePinButton();
    });

    // Lock toggle
    document.getElementById('btnModalLock').addEventListener('click', () => {
      this._handleLockClick();
    });

    // Formatting toolbar
    document.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.execCommand(btn.dataset.cmd, false, null);
        document.getElementById('noteContent').focus();
      });
    });

    // Clear formatting
    document.getElementById('btnClearFormat').addEventListener('click', () => {
      document.execCommand('removeFormat', false, null);
      document.getElementById('noteContent').focus();
    });

    // Auto-save + counter on content change
    const content = document.getElementById('noteContent');
    content.addEventListener('input', () => {
      this.updateCounters();
      App.scheduleAutoSave();
    });

    // Auto-save on title change
    document.getElementById('noteTitle').addEventListener('input', () => {
      App.scheduleAutoSave();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.isOpen) return;
      if (e.key === 'Escape') { this.close(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        App.saveNote();
      }
    });
  },

  /**
   * Open the modal to create or edit a note
   * @param {string|null} noteId
   */
  open(noteId = null) {
    const note = noteId ? State.notes.find(n => n.id === noteId) : null;

    // If locked, require password first
    if (note && note.locked) {
      PasswordModal.open('unlock', (pw) => {
        if (pw === note.password) {
          this._populate(note);
          this._show();
        } else {
          Toast.show('Incorrect password', 'error');
        }
      });
      return;
    }

    this._populate(note);
    this._show();
  },

  /** Fill modal fields with note data (or blanks for new note) */
  _populate(note) {
    this.noteId = note ? note.id : null;

    document.getElementById('modalHeading').textContent =
      note ? 'Edit Note' : 'New Note';

    document.getElementById('noteTitle').value   = note ? note.title  : '';
    document.getElementById('noteContent').innerHTML = note ? note.content : '';
    document.getElementById('noteTags').value    = note ? note.tags.join(', ') : '';
    document.getElementById('noteReminder').value = (note && note.reminder) ? note.reminder : '';
    document.getElementById('noteColor').value   = (note && note.color) ? note.color : '#F59E0B';

    // Show/hide delete button
    document.getElementById('btnModalDelete').style.display = note ? 'flex' : 'none';

    // Pin / Lock state
    const isPinned = note ? note.pinned : false;
    const isLocked = note ? note.locked : false;
    document.getElementById('btnModalPin').classList.toggle('active', isPinned);
    document.getElementById('btnModalPin').title = isPinned ? 'Unpin note' : 'Pin note';
    document.getElementById('btnModalPin').querySelector('i').className =
      `bi bi-pin-angle${isPinned ? '-fill' : ''}`;

    document.getElementById('btnModalLock').classList.toggle('active', isLocked);
    document.getElementById('btnModalLock').querySelector('i').className =
      `bi bi-lock${isLocked ? '-fill' : ''}`;

    // Reset auto-save dot
    const dot = document.getElementById('autosaveDot');
    dot.className = 'autosave-dot';
    document.getElementById('autosaveText').textContent = 'Auto-save on';

    this.updateCounters();
  },

  /** Show the modal with animation */
  _show() {
    this.isOpen = true;
    document.getElementById('noteModalOverlay').classList.add('open');
    document.getElementById('noteModal').classList.add('open');
    setTimeout(() => document.getElementById('noteTitle').focus(), 80);
  },

  /** Close the modal */
  close() {
    clearTimeout(State.autoSaveTimer);
    Voice.stop();
    document.getElementById('noteModalOverlay').classList.remove('open');
    document.getElementById('noteModal').classList.remove('open');
    this.isOpen = false;
    this.noteId = null;
  },

  /** Toggle pin button state inside modal */
  _togglePinButton() {
    const btn    = document.getElementById('btnModalPin');
    const active = btn.classList.toggle('active');
    btn.title = active ? 'Unpin note' : 'Pin note';
    btn.querySelector('i').className = `bi bi-pin-angle${active ? '-fill' : ''}`;
  },

  /** Handle lock/unlock click inside modal */
  _handleLockClick() {
    const btn      = document.getElementById('btnModalLock');
    const isLocked = btn.classList.contains('active');

    if (isLocked) {
      // Try to unlock (needs password)
      if (this.noteId) {
        const note = State.notes.find(n => n.id === this.noteId);
        if (!note) return;
        PasswordModal.open('unlock', (pw) => {
          if (pw === note.password) {
            btn.classList.remove('active');
            btn.querySelector('i').className = 'bi bi-lock';
            App.updateNoteFields(this.noteId, { locked: false, password: null });
            Toast.show('Note unlocked', 'info');
          } else {
            Toast.show('Incorrect password', 'error');
          }
        });
      }
    } else {
      // Lock with new password
      PasswordModal.open('lock', (pw) => {
        btn.classList.add('active');
        btn.querySelector('i').className = 'bi bi-lock-fill';
        if (this.noteId) {
          App.updateNoteFields(this.noteId, { locked: true, password: pw });
          Toast.show('Note locked!', 'success');
        }
      });
    }
  },

  /** Read form fields and return data object */
  getFormData() {
    const rawTags = document.getElementById('noteTags').value;
    const tags = rawTags
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    return {
      title:    document.getElementById('noteTitle').value.trim() || 'Untitled Note',
      content:  document.getElementById('noteContent').innerHTML,
      tags,
      reminder: document.getElementById('noteReminder').value || null,
      color:    document.getElementById('noteColor').value || '#F59E0B',
      pinned:   document.getElementById('btnModalPin').classList.contains('active'),
      locked:   document.getElementById('btnModalLock').classList.contains('active'),
    };
  },

  /** Update word + char counters */
  updateCounters() {
    const html   = document.getElementById('noteContent').innerHTML;
    const words  = Utils.countWords(html);
    const chars  = Utils.stripHtml(html).length;
    document.getElementById('wordCount').textContent = words;
    document.getElementById('charCount').textContent = chars;
  },
};


/* ================================================================
   13. REMINDERS
   ================================================================ */
const Reminders = {
  init() {
    // Close reminder popup
    document.getElementById('reminderPopupClose').addEventListener('click', () => {
      document.getElementById('reminderPopup').style.display = 'none';
    });

    // Start polling
    this._check();
    State.reminderTimer = setInterval(() => this._check(), CONFIG.REMINDER_INTERVAL);
  },

  _check() {
    const now = new Date();
    State.notes.forEach(note => {
      if (!note.reminder) return;
      if (State.firedReminders.has(note.id)) return;
      const due = new Date(note.reminder);
      if (due <= now) {
        this._fire(note);
        State.firedReminders.add(note.id);
        // Clear the reminder after firing
        App.updateNoteFields(note.id, { reminder: null });
      }
    });
  },

  _fire(note) {
    const popup = document.getElementById('reminderPopup');
    document.getElementById('reminderPopupTitle').textContent = `Reminder: ${note.title}`;
    document.getElementById('reminderPopupNote').textContent  = 'Your scheduled note reminder is due!';
    popup.style.display = 'flex';
    Toast.show(`⏰ Reminder: ${note.title}`, 'warning', 6000);

    // Auto-hide popup after 10s
    setTimeout(() => { popup.style.display = 'none'; }, 10000);
  },
};


/* ================================================================
   14. IMPORT / EXPORT
   ================================================================ */
const ImportExport = {
  init() {
    document.getElementById('btnExport').addEventListener('click', () => this.exportJSON());
    document.getElementById('btnImport').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });
    document.getElementById('importFile').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.importJSON(file);
      e.target.value = ''; // reset so same file can be re-selected
    });
  },

  /** Download all notes as a JSON file */
  exportJSON() {
    const payload = {
      app:        'NoteFlow',
      version:    '2.0',
      exportedAt: new Date().toISOString(),
      count:      State.notes.length,
      notes:      State.notes,
    };

    const blob = new Blob(
      [JSON.stringify(payload, null, 2)],
      { type: 'application/json' }
    );
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href  = url;
    link.download = `noteflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    Toast.show(`${State.notes.length} notes exported successfully!`, 'success');
  },

  /** Import notes from a JSON file (merge, skipping duplicates by id) */
  importJSON(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data     = JSON.parse(e.target.result);
        const incoming = Array.isArray(data) ? data : (data.notes || []);

        if (!Array.isArray(incoming) || !incoming.length) {
          Toast.show('No valid notes found in file', 'warning');
          return;
        }

        const existingIds = new Set(State.notes.map(n => n.id));
        const fresh = incoming.filter(n => n && n.id && !existingIds.has(n.id));

        State.notes.unshift(...fresh);
        Storage.saveNotes(State.notes);
        App.render();
        Toast.show(`${fresh.length} notes imported!`, 'success');
      } catch (err) {
        console.error(err);
        Toast.show('Invalid file — could not import', 'error');
      }
    };
    reader.readAsText(file);
  },
};


/* ================================================================
   15. APP CONTROLLER
   ================================================================ */
const App = {

  /* ── Bootstrap ── */
  init() {
    // Load saved data
    State.notes = Storage.loadNotes();

    // Apply saved theme
    const theme = Storage.loadTheme();
    document.documentElement.setAttribute('data-theme', theme);
    this._updateThemeIcon(theme);

    // Init all modules
    Toast.init();
    TagsNav.init();
    NoteEditorModal.init();
    PasswordModal.init();
    Voice.init();
    Reminders.init();
    ImportExport.init();

    // Bind UI events
    this._bindEvents();

    // Initial render
    this.render();
  },

  /* ── Bind Global Events ── */
  _bindEvents() {
    // Hamburger (mobile)
    document.getElementById('sidebarToggle').addEventListener('click', () => this._openSidebar());
    document.getElementById('sidebarClose').addEventListener('click',  () => this._closeSidebar());
    document.getElementById('sidebarOverlay').addEventListener('click', () => this._closeSidebar());

    // New Note buttons
    document.getElementById('btnNewNote').addEventListener('click',     () => this.openNote(null));
    document.getElementById('btnEmptyCreate').addEventListener('click', () => this.openNote(null));

    // Search
    const searchEl = document.getElementById('searchInput');
    const clearBtn = document.getElementById('searchClear');

    searchEl.addEventListener('input', Utils.debounce(() => {
      State.searchQuery = searchEl.value;
      clearBtn.style.display = State.searchQuery ? 'flex' : 'none';
      this.render();
    }, 220));

    clearBtn.addEventListener('click', () => {
      searchEl.value      = '';
      State.searchQuery   = '';
      clearBtn.style.display = 'none';
      this.render();
      searchEl.focus();
    });

    // Sort
    document.getElementById('sortSelect').addEventListener('change', (e) => {
      State.sortOrder = e.target.value;
      this.render();
    });

    // Theme toggle
    document.getElementById('themeToggle').addEventListener('click', () => this._toggleTheme());

    // Sidebar nav items
    document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        State.navFilter = item.dataset.filter;
        State.tagFilter = null; // clear tag filter when switching nav
        TagsNav.render();
        this.render();
      });
    });
  },

  /* ── Sidebar ── */
  _openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebarOverlay').classList.add('visible');
  },
  _closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('visible');
  },

  /* ── Theme ── */
  _toggleTheme() {
    const cur  = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    Storage.saveTheme(next);
    this._updateThemeIcon(next);
    Toast.show(`Switched to ${next} mode`, 'info', 1800);
  },
  _updateThemeIcon(theme) {
    document.getElementById('themeIcon').className =
      theme === 'dark' ? 'bi bi-sun-fill' : 'bi bi-moon-fill';
  },

  /* ── Open / Edit Note ── */
  openNote(noteId) {
    NoteEditorModal.open(noteId);
  },

  /* ── Save Note ── */
  saveNote() {
    const data = NoteEditorModal.getFormData();
    const isNew = !NoteEditorModal.noteId;

    if (isNew) {
      const note = NoteModel.create(data);
      State.notes.unshift(note);
      Toast.show('Note created!', 'success');
    } else {
      const idx = State.notes.findIndex(n => n.id === NoteEditorModal.noteId);
      if (idx >= 0) {
        // Preserve password from existing note if still locked
        const existingPw = State.notes[idx].password;
        const keepPw = data.locked ? (existingPw || null) : null;
        State.notes[idx] = NoteModel.update(State.notes[idx], { ...data, password: keepPw });
        Toast.show('Note saved!', 'success');
      }
    }

    Storage.saveNotes(State.notes);
    NoteEditorModal.close();
    this.render();
  },

  /* ── Auto-save (draft) while editing ── */
  scheduleAutoSave() {
    clearTimeout(State.autoSaveTimer);

    const dot  = document.getElementById('autosaveDot');
    const text = document.getElementById('autosaveText');
    dot.className = 'autosave-dot saving';
    text.textContent = 'Saving…';

    State.autoSaveTimer = setTimeout(() => {
      // Only auto-save if editing an existing note
      if (NoteEditorModal.noteId) {
        const idx = State.notes.findIndex(n => n.id === NoteEditorModal.noteId);
        if (idx >= 0) {
          const data = NoteEditorModal.getFormData();
          State.notes[idx] = NoteModel.update(State.notes[idx], data);
          Storage.saveNotes(State.notes);
          this.render(); // refresh grid silently
        }
      }
      dot.className = 'autosave-dot saved';
      text.textContent = 'Saved ✓';

      setTimeout(() => {
        dot.className = 'autosave-dot';
        text.textContent = 'Auto-save on';
      }, 2500);
    }, CONFIG.AUTOSAVE_DELAY);
  },

  /* ── Delete Note ── */
  deleteNote(noteId, skipConfirm = false) {
    const note = State.notes.find(n => n.id === noteId);
    if (!note) return;

    if (!skipConfirm && !confirm(`Delete "${note.title}"?\n\nThis cannot be undone.`)) return;

    State.notes = State.notes.filter(n => n.id !== noteId);
    Storage.saveNotes(State.notes);
    this.render();
    Toast.show('Note deleted', 'error');
  },

  /* ── Toggle Pin ── */
  togglePin(noteId) {
    const idx = State.notes.findIndex(n => n.id === noteId);
    if (idx < 0) return;

    State.notes[idx] = NoteModel.update(State.notes[idx], {
      pinned: !State.notes[idx].pinned,
    });

    const isPinned = State.notes[idx].pinned;
    Storage.saveNotes(State.notes);
    this.render();
    Toast.show(isPinned ? 'Note pinned! 📌' : 'Note unpinned', 'info');
  },

  /* ── Update specific fields of a note (used internally) ── */
  updateNoteFields(noteId, fields) {
    const idx = State.notes.findIndex(n => n.id === noteId);
    if (idx < 0) return;
    State.notes[idx] = NoteModel.update(State.notes[idx], fields);
    Storage.saveNotes(State.notes);
    this.render();
  },

  /* ── Tag filter ── */
  setTagFilter(tag) {
    if (State.tagFilter === tag) {
      // Clicking active tag clears filter
      State.tagFilter = null;
    } else {
      State.tagFilter  = tag;
      State.navFilter  = 'all';
      // Reflect 'All Notes' in nav
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
      document.querySelector('.nav-item[data-filter="all"]').classList.add('active');
    }
    TagsNav.render();
    this.render();
  },

  /* ── Drag-and-drop reorder ── */
  reorderNote(fromId, toId) {
    const fromIdx = State.notes.findIndex(n => n.id === fromId);
    const toIdx   = State.notes.findIndex(n => n.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;

    const [moved] = State.notes.splice(fromIdx, 1);
    State.notes.splice(toIdx, 0, moved);

    // Update order field
    State.notes.forEach((n, i) => { n.order = State.notes.length - i; });

    Storage.saveNotes(State.notes);
    this.render();
  },

  /* ── MAIN RENDER ── */
  render() {
    const filtered  = FilterSort.apply(State.notes);
    const pinned    = filtered.filter(n => n.pinned);
    const unpinned  = filtered.filter(n => !n.pinned);

    const pinnedSection = document.getElementById('pinnedSection');
    const pinnedGrid    = document.getElementById('pinnedGrid');
    const notesGrid     = document.getElementById('notesGrid');
    const emptyState    = document.getElementById('emptyState');
    const resultCount   = document.getElementById('resultCount');
    const sectionTitle  = document.getElementById('sectionTitle');
    const emptyDesc     = document.getElementById('emptyDesc');

    /* ── Pinned section (hide when 'pinned' nav is active to avoid duplication) ── */
    const showPinnedSection = pinned.length > 0 && State.navFilter !== 'pinned';
    pinnedSection.style.display = showPinnedSection ? 'block' : 'none';

    if (showPinnedSection) {
      pinnedGrid.innerHTML = '';
      pinned.forEach(n => pinnedGrid.appendChild(CardRenderer.build(n)));
    }

    /* ── Main notes (unpinned, unless in 'pinned' filter mode) ── */
    const mainNotes = State.navFilter === 'pinned' ? pinned : unpinned;

    notesGrid.innerHTML = '';
    mainNotes.forEach(n => notesGrid.appendChild(CardRenderer.build(n)));

    /* ── Section title ── */
    const titleMap = {
      all:      'All Notes',
      pinned:   'Pinned Notes',
      locked:   'Locked Notes',
      reminder: 'Notes with Reminders',
    };
    sectionTitle.textContent = State.tagFilter
      ? `#${State.tagFilter}`
      : (titleMap[State.navFilter] || 'Notes');

    /* ── Result count ── */
    const displayCount = mainNotes.length + (showPinnedSection ? pinned.length : 0);
    if (filtered.length > 0) {
      resultCount.textContent  = `${filtered.length} note${filtered.length !== 1 ? 's' : ''}`;
      resultCount.style.display = 'inline';
    } else {
      resultCount.style.display = 'none';
    }

    /* ── Empty state ── */
    const hasAny = filtered.length > 0;
    emptyState.style.display = hasAny ? 'none' : 'block';
    notesGrid.style.display  = hasAny ? 'grid' : 'none';

    if (!hasAny) {
      if (State.searchQuery) {
        emptyDesc.textContent = `No notes match "${State.searchQuery}". Try a different search.`;
      } else if (State.tagFilter) {
        emptyDesc.textContent = `No notes tagged "${State.tagFilter}" found.`;
      } else if (State.navFilter !== 'all') {
        emptyDesc.textContent = `No ${titleMap[State.navFilter] || 'notes'} yet.`;
      } else {
        emptyDesc.textContent = 'Start capturing your ideas, thoughts and tasks.';
      }
    }

    /* ── Sidebar ── */
    TagsNav.render();
    Stats.update();
  },
};


/* ================================================================
   BOOT
   ================================================================ */
document.addEventListener('DOMContentLoaded', () => App.init());