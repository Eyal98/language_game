# Word audio clips

This folder holds pre-recorded pronunciations the game plays for each word:
`<id>_he.mp3` (Hebrew) and `<id>_ar.mp3` (Arabic). They let the game speak words
on any browser/device with **no installed voices and no internet**.

`manifest.json` lists which clips exist; the game reads it to decide what to play.

## Generating the clips

On any machine with internet, run (Node only, no install):

    node tools/generate-audio.mjs

Then commit this folder. Re-run after adding or changing words; existing files
are skipped (delete a file to regenerate just that one).

While `manifest.json` lists no clips for a language, the game falls back to the
browser's built-in speech synthesis for that language (if a voice is installed).
