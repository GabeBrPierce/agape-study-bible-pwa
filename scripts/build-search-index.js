#!/usr/bin/env node
/**
 * build-search-index.js
 *
 * For every translation listed in public/data/manifest.json (plus WEB), walks
 * its bundled chapter files under public/data/<id>/ and produces a compact
 * search index at public/data/<id>/search-index.json.
 *
 * It also writes public/data/precache-manifest.json: the list of every chapter
 * file and search index the service worker should precache.
 *
 * Index format:
 *   {
 *     "hash":        "<sha256 of all verse text, canonical order>",
 *     "verseCount":  31102,
 *     "bookCount":   66,
 *     "generatedAt": "<ISO timestamp>",
 *     "verses": [
 *       { "b": "GEN", "c": 1, "v": 1, "t": "In the beginning..." },
 *       ...
 *     ]
 *   }
 *
 * Usage:  node scripts/build-search-index.js
 * Re-run any time the bundled data changes.
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// Canonical book order (matches bundle-translation.js)
const BOOKS = [
  ['GEN',50],['EXO',40],['LEV',27],['NUM',36],['DEU',34],
  ['JOS',24],['JDG',21],['RUT',4], ['1SA',31],['2SA',24],
  ['1KI',22],['2KI',25],['1CH',29],['2CH',36],['EZR',10],
  ['NEH',13],['EST',10],['JOB',42],['PSA',150],['PRO',31],
  ['ECC',12],['SNG',8], ['ISA',66],['JER',52],['LAM',5],
  ['EZK',48],['DAN',12],['HOS',14],['JOL',3], ['AMO',9],
  ['OBA',1], ['JON',4], ['MIC',7], ['NAH',3], ['HAB',3],
  ['ZEP',3], ['HAG',2], ['ZEC',14],['MAL',4],
  ['MAT',28],['MRK',16],['LUK',24],['JHN',21],['ACT',28],
  ['ROM',16],['1CO',16],['2CO',13],['GAL',6], ['EPH',6],
  ['PHP',4], ['COL',4], ['1TH',5], ['2TH',3], ['1TI',6],
  ['2TI',4], ['TIT',3], ['PHM',1], ['HEB',13],['JAS',5],
  ['1PE',5], ['2PE',3], ['1JN',5], ['2JN',1], ['3JN',1],
  ['JUD',1], ['REV',22],
];

const ROOT_DATA = path.join(__dirname, '..', 'public', 'data');

function translationIds() {
  const ids = ['web'];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT_DATA, 'manifest.json'), 'utf8'));
    for (const t of manifest.translations || []) {
      if (t.id && !ids.includes(t.id)) ids.push(t.id);
    }
  } catch { /* no manifest — WEB only */ }
  return ids;
}

function buildIndex(id, precache) {
  const dataDir = path.join(ROOT_DATA, id);
  if (!fs.existsSync(dataDir)) {
    console.warn(`\n[${id}] no data folder — skipped`);
    return;
  }

  const verses = [];
  const hashInput = crypto.createHash('sha256');
  let missingChapters = 0;
  let booksFound = 0;

  for (const [book, chapterCount] of BOOKS) {
    let bookHasAny = false;
    for (let ch = 1; ch <= chapterCount; ch++) {
      const file = path.join(dataDir, book, `${ch}.json`);
      if (!fs.existsSync(file)) { missingChapters++; continue; }

      precache.push(`/data/${id}/${book}/${ch}.json`);

      let data;
      try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (e) {
        console.warn(`  parse error: ${id}/${book}/${ch}.json — ${e.message}`);
        continue;
      }

      for (const v of data.verses || []) {
        const verseNum = v.verse ?? v.number ?? v.verseNumber;
        const text     = (v.text ?? v.content ?? '').trim();
        if (!text) continue;

        verses.push({ b: book, c: ch, v: verseNum, t: text });
        hashInput.update(`${book}:${ch}:${verseNum}:${text}\n`);
        bookHasAny = true;
      }
    }
    if (bookHasAny) booksFound++;
  }

  const hash = hashInput.digest('hex');
  const outFile = path.join(dataDir, 'search-index.json');
  fs.writeFileSync(outFile, JSON.stringify({
    hash,
    verseCount:  verses.length,
    bookCount:   booksFound,
    generatedAt: new Date().toISOString(),
    verses,
  }));
  precache.push(`/data/${id}/search-index.json`);

  const sizeMB = (fs.statSync(outFile).size / 1024 / 1024).toFixed(2);
  console.log(`\n[${id}] ${verses.length.toLocaleString()} verses, ${booksFound} books, ${missingChapters} missing chapter files, ${sizeMB} MB index`);
}

function run() {
  const precache = [];
  for (const id of translationIds()) buildIndex(id, precache);

  const out = path.join(ROOT_DATA, 'precache-manifest.json');
  fs.writeFileSync(out, JSON.stringify(precache));
  console.log(`\nPrecache manifest: ${precache.length.toLocaleString()} files -> ${out}`);
}

run();
