# App icon placeholder

`electron-builder` expects `resources/icon.ico` (Windows, 256x256 recommended).

Pilot builds ship unsigned + with a placeholder. When an official icon is ready:

1. Drop a 256x256 `.ico` file at `resources/icon.ico`.
2. The file is `.gitignored` -- commit it intentionally or keep it local-only
   depending on whether it contains trademarked branding.

Until then, `electron-builder` falls back to its default icon. If the default
fails on older Windows installs, render a transparent PNG at 256x256 and
rename it to `.ico` as a stopgap.
