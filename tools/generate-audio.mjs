#!/usr/bin/env node
/*
 * One-time audio generator for the Hebrew RFID Game.
 *
 * Creates an MP3 for the Hebrew and Arabic word of every entry in
 * data/words.json, saving them to public/audio/<id>_he.mp3 / <id>_ar.mp3, and
 * writes public/audio/manifest.json listing what was produced. The game plays
 * these clips when present, so the device running the game needs NO installed
 * voices and NO internet — only the machine that runs THIS script does.
 *
 * Run it on any machine with internet (uses Node built-ins only, no install):
 *     node tools/generate-audio.mjs
 *
 * Then commit public/audio/. Re-run it whenever you add/change words.
 *
 * Audio source: Google Translate's public TTS endpoint. It's free and needs no
 * key, but it's an undocumented endpoint and may rate-limit; the script pauses
 * between requests and skips files that already exist (delete a file to redo it).
 */

import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const OUT_DIR = path.join(ROOT, 'public', 'audio');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchTts(text, lang) {
  const url = 'https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob'
    + `&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(text)}`;
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://translate.google.com/' }
    }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for "${text}" (${lang})`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = { he: [], ar: [] };
  const jobs = [];
  for (const w of data.words) {
    if (w.hebrew) jobs.push({ id: w.id, lang: 'he', text: w.hebrew });
    if (w.arabic) jobs.push({ id: w.id, lang: 'ar', text: w.arabic });
  }

  let done = 0, failed = 0;
  for (const job of jobs) {
    const file = path.join(OUT_DIR, `${job.id}_${job.lang}.mp3`);
    if (fs.existsSync(file) && fs.statSync(file).size > 0) {
      manifest[job.lang].push(job.id);
      console.log(`skip  ${job.id}_${job.lang} (exists)`);
      continue;
    }
    try {
      const buf = await fetchTts(job.text, job.lang);
      fs.writeFileSync(file, buf);
      manifest[job.lang].push(job.id);
      done++;
      console.log(`ok    ${job.id}_${job.lang}  "${job.text}"  (${buf.length} bytes)`);
      await sleep(400); // be polite to the endpoint
    } catch (err) {
      failed++;
      console.warn(`FAIL  ${job.id}_${job.lang}: ${err.message}`);
    }
  }

  // De-dupe and sort for a stable manifest.
  manifest.he = [...new Set(manifest.he)].sort();
  manifest.ar = [...new Set(manifest.ar)].sort();
  fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nDone. ${done} new, ${failed} failed.`);
  console.log(`Manifest: ${manifest.he.length} Hebrew, ${manifest.ar.length} Arabic clips.`);
  if (failed) console.log('Re-run to retry the failed ones (existing files are skipped).');
  console.log('\nNext: commit public/audio/ and run the game — clips play automatically.');
}

main().catch((e) => { console.error(e); process.exit(1); });
