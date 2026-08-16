BEFORE YOU DEPLOY: ADD THE 4 LIBRARY FILES
===========================================
This app used to load 4 helper libraries from the internet every time
it started. That's why it broke when you cleared Chrome's browsing data
and weren't online yet. Fix: download these 4 files once and save them
into the "lib" folder inside this project, using the EXACT filenames
below (right-click each link -> "Save Link As").

1. https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js
   -> save as: lib/chart.umd.min.js

2. https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
   -> save as: lib/jspdf.umd.min.js

3. https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js
   -> save as: lib/jspdf.plugin.autotable.min.js

4. https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js
   -> save as: lib/xlsx.full.min.js

Once those 4 files are sitting in the "lib" folder, the app is fully
self-contained -- no CDN needed at all, ever.


DEPLOY VIA GITHUB + NETLIFY/VERCEL (AUTO-DEPLOY)
=================================================
1. Create a new GitHub repo and upload this whole "calibration-app"
   folder to it (including the "lib" folder with the 4 files).
2. Go to https://app.netlify.com (or vercel.com) and choose
   "Import from GitHub", then pick your repo.
3. No build settings needed -- leave build command blank, publish
   directory = the repo root (or the calibration-app folder if you
   uploaded a parent folder too).
4. Deploy. You'll get a permanent URL like https://your-app.netlify.app.
5. From now on, any time you push a change to GitHub, it auto-deploys.


INSTALL AS AN ANDROID APP
==========================
1. Open your Netlify/Vercel link in Chrome on your phone.
2. Tap "Install" in the header, or Chrome menu (⋮) -> "Install app".
3. Open from the home screen -- runs full screen like a normal app.

Important: because the app now caches everything itself on first load
(including the 4 library files), it will keep working offline even if
you later lose signal. Clearing Chrome's "site data" for this one site
will still wipe the offline cache (that's how all browsers work) --
but the very next time you're online for even a few seconds, it
re-caches everything automatically.
