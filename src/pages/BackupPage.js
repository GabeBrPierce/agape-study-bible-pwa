import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { exportUserData, importUserData } from '../db/db';
import { getBundledTranslations } from '../api/bibleApi';

const ITEMS = [
  { id: 'export', label: 'Export backup',  desc: 'Save a backup file to your phone' },
  { id: 'import', label: 'Import backup',  desc: 'Restore from a backup file' },
];

const RESTORED_SETTINGS = ['darkMode', 'fontSize', 'internetUsage', 'savedLocation'];

function describeCounts(counts) {
  const parts = [
    [counts.bookmarks,       'bookmark'],
    [counts.highlights,      'highlight'],
    [counts.favorites,       'favorite'],
    [counts.readingProgress, 'reading plan'],
  ].map(([n, word]) => `${n || 0} ${word}${n === 1 ? '' : 's'}`);
  return parts.join(', ');
}

function readLastExport() {
  try { return localStorage.getItem('lastBackupAt'); } catch (_) { return null; }
}

export default function BackupPage() {
  const { pop, registerKeyHandlers, registerSoftkeys, updateSettings } = useApp();
  const [focusIndex, setFocusIndex] = useState(0);
  const [status, setStatus] = useState(null);   // { kind: 'ok' | 'error', text }
  const [lastExport, setLastExport] = useState(readLastExport);
  const fileRef = useRef(null);

  const directStorage =
    typeof navigator.b2g?.getDeviceStorage === 'function' ||
    typeof navigator.getDeviceStorage === 'function';

  const doExport = useCallback(async () => {
    try {
      const data = await exportUserData();
      const date = data.exportedAt.slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `agape-study-bible-backup-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);

      try { localStorage.setItem('lastBackupAt', data.exportedAt); } catch (_) {}
      setLastExport(data.exportedAt);
      const counts = {};
      for (const [name, rows] of Object.entries(data.stores)) counts[name] = rows.length;
      setStatus({ kind: 'ok', text: `Exported ${describeCounts(counts)}.` });
    } catch (err) {
      setStatus({ kind: 'error', text: `Export failed: ${err.message}` });
    }
  }, []);

  const onFileChosen = useCallback(async (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';           // allow choosing the same file again
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      const { counts, settings } = await importUserData(payload);

      if (settings) {
        const patch = {};
        for (const k of RESTORED_SETTINGS) if (settings[k] !== undefined) patch[k] = settings[k];
        const bundled = await getBundledTranslations();
        if (settings.translationId && bundled.some(t => t.id === settings.translationId)) {
          patch.translationId = settings.translationId;
        }
        await updateSettings(patch);
      }
      setStatus({ kind: 'ok', text: `Imported ${describeCounts(counts)}.` });
    } catch (err) {
      const msg = err instanceof SyntaxError ? 'File is not valid JSON' : err.message;
      setStatus({ kind: 'error', text: `Import failed: ${msg}` });
    }
  }, [updateSettings]);

  const activate = useCallback((item) => {
    if (item.id === 'export') doExport();
    else if (fileRef.current) fileRef.current.click();
  }, [doExport]);

  useEffect(() => {
    registerKeyHandlers({
      ArrowUp:   () => setFocusIndex(prev => Math.max(0, prev - 1)),
      ArrowDown: () => setFocusIndex(prev => Math.min(ITEMS.length - 1, prev + 1)),
      Enter:     () => activate(ITEMS[focusIndex]),
      Backspace: pop,
    });
    registerSoftkeys({ left: { label: 'Back', action: pop }, center: 'Select', right: '' });
  }, [focusIndex, activate, pop, registerKeyHandlers, registerSoftkeys]);

  return (
    <div className="page">
      <div className="page-header">
        <span className="header-title">Backup &amp; Restore</span>
      </div>
      <div className="page-content">
        {ITEMS.map((item, idx) => (
          <div
            key={item.id}
            className={`list-item${focusIndex === idx ? ' focused' : ''}`}
            onClick={() => { setFocusIndex(idx); activate(item); }}
          >
            <div style={{ flex: 1 }}>
              <div className="list-item-primary">{item.label}</div>
              <div className="list-item-secondary">{item.desc}</div>
            </div>
          </div>
        ))}

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onFileChosen}
        />

        <div style={{ padding: '10px', fontSize: 11, color: 'var(--color-text-dim)', borderTop: '1px solid var(--color-border)' }}>
          {status && (
            <div style={{
              marginBottom: 8,
              color: status.kind === 'error' ? 'var(--color-error, #e57373)' : 'var(--color-success)',
            }}>
              {status.text}
            </div>
          )}
          <div style={{ marginBottom: 4 }}>
            Last export: {lastExport ? new Date(lastExport).toLocaleString() : 'never'}
          </div>
          <div style={{ marginBottom: 4 }}>
            Includes bookmarks, highlights &amp; notes, favorites, reading plans and settings.
          </div>
          <div style={{ marginBottom: 4 }}>
            Importing adds to what is already here; it never deletes anything.
          </div>
          <div>
            Direct phone-storage access: {directStorage ? 'available' : 'not available'}
          </div>
        </div>
      </div>
    </div>
  );
}
