/**
 * searchIndex.js
 *
 * Loads the pre-built offline search index from /data/<translationId>/search-index.json
 * and provides fast substring search over all 31k bundled verses.
 *
 * Only the most recently used translation's index is kept in memory (they are
 * ~5 MB each and this targets low-memory devices); switching translations
 * fetches the new one, which the service worker serves from cache when offline.
 * Falls back to the IndexedDB chapter cache when the index file is unavailable.
 */

let _index   = null;   // { id, data: { hash, verseCount, bookCount, generatedAt, verses: [{b,c,v,t}] } }
let _loading = null;   // { id, promise } in-flight fetch (prevents duplicate fetches)

async function loadIndex(translationId = 'web') {
  if (_index && _index.id === translationId) return _index.data;
  if (_loading && _loading.id === translationId) return _loading.promise;

  const promise = fetch(`${process.env.PUBLIC_URL}/data/${translationId}/search-index.json`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      _index = { id: translationId, data };
      if (_loading && _loading.promise === promise) _loading = null;
      return data;
    })
    .catch(err => {
      if (_loading && _loading.promise === promise) _loading = null;
      throw err;
    });

  _loading = { id: translationId, promise };
  return promise;
}

const searchIndex = {
  /**
   * Returns the corpus hash and metadata without performing a search.
   * Useful for displaying Bible integrity info in Settings.
   */
  async getInfo(translationId = 'web') {
    const idx = await loadIndex(translationId);
    return {
      hash:        idx.hash,
      verseCount:  idx.verseCount,
      bookCount:   idx.bookCount,
      generatedAt: idx.generatedAt,
    };
  },

  /**
   * Search all bundled verses for a substring match.
   * Returns [{ book, chapter, verse, preview }] for every match.
   */
  async searchLocal(query, translationId = 'web') {
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) return [];

    // Try the pre-built index first
    try {
      const idx = await loadIndex(translationId);
      const results = [];
      for (const entry of idx.verses) {
        if (entry.t.toLowerCase().includes(q)) {
          results.push({
            book:    entry.b,
            chapter: entry.c,
            verse:   entry.v,
            preview: entry.t.length > 120 ? entry.t.slice(0, 120) + '…' : entry.t,
          });
        }
      }
      return results;
    } catch (indexErr) {
      console.warn('Search index unavailable, falling back to chapter cache:', indexErr.message);
    }

    // Fallback: scan IndexedDB chapter cache (only previously-viewed chapters)
    try {
      const dbReq = indexedDB.open('agape-study-bible', 1);
      const db = await new Promise((res, rej) => {
        dbReq.onsuccess = e => res(e.target.result);
        dbReq.onerror   = e => rej(e.target.error);
      });

      const tx    = db.transaction('chapterCache', 'readonly');
      const store = tx.objectStore('chapterCache');
      const allEntries = await new Promise((res, rej) => {
        const r = store.getAll();
        r.onsuccess = e => res(e.target.result);
        r.onerror   = e => rej(e.target.error);
      });

      const results = [];
      for (const entry of allEntries) {
        if (entry.translationId !== translationId) continue;
        for (const v of (entry.data?.verses || [])) {
          const text = (v.text || v.content || '').toLowerCase();
          if (text.includes(q)) {
            results.push({
              book:    entry.book,
              chapter: entry.chapter,
              verse:   v.number ?? v.verse ?? v.verseNumber,
              preview: (v.text || v.content || '').slice(0, 120),
            });
          }
        }
      }
      return results;
    } catch (err) {
      console.error('searchLocal fallback error:', err);
      return [];
    }
  },
};

export default searchIndex;
