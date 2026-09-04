/**
 * calibration-sync.js
 * -----------------------------------------------------------------------
 * Offline-first save for calibration certificates.
 *
 * - Every completed calibration is saved to IndexedDB immediately (works
 *   fully offline, survives app restarts and closed tabs).
 * - If the browser is online, it's uploaded to Supabase (PDF -> Storage,
 *   metadata -> the calibration_events table) right away.
 * - If offline, it sits in a "pending" queue and is retried automatically
 *   when the connection comes back (the 'online' event) and on every
 *   app load.
 *
 * Requires the Supabase JS client already loaded on the page:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 * and matches the schema in calibration_schema.sql
 * (instruments, calibration_events, 'certificates' storage bucket).
 * -----------------------------------------------------------------------
 */

const DB_NAME = "calibration-pwa";
const DB_VERSION = 1;
const STORE_CERTS = "certificates";     // every saved certificate, synced or not
const CERTIFICATES_BUCKET = "certificates";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_CERTS)) {
        const store = db.createObjectStore(STORE_CERTS, { keyPath: "localId" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("tag", "tagNumber", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
}

/**
 * Call this the moment a calibration is finished and its PDF blob exists.
 *
 * @param {Object} record
 * @param {string} record.tagNumber        - AMS tag, e.g. 'LI-6101'
 * @param {string} record.calibrationDate  - 'YYYY-MM-DD'
 * @param {string} record.result           - 'Passed' | 'Failed'
 * @param {number} record.intervalMonths
 * @param {string} [record.technician]
 * @param {string} [record.certificateNo]
 * @param {Blob}   record.pdfBlob          - the generated certificate PDF
 * @param {string} [record.manufacturer]   - used only if a new instrument gets created
 * @param {string} [record.model]          - used only if a new instrument gets created
 * @param {string} [record.serialNumber]   - used only if a new instrument gets created
 * @param {string} [record.siteLocation]   - used only if a new instrument gets created (stored as area)
 * @returns {Promise<string>} localId of the saved record
 */
async function saveCalibration(record) {
  const localId = uuid();
  const entry = {
    localId,
    tagNumber: record.tagNumber,
    calibrationDate: record.calibrationDate,
    result: record.result,
    intervalMonths: record.intervalMonths,
    technician: record.technician || null,
    certificateNo: record.certificateNo || null,
    manufacturer: record.manufacturer || null,
    model: record.model || null,
    serialNumber: record.serialNumber || null,
    siteLocation: record.siteLocation || null,
    pdfBlob: record.pdfBlob,          // stored as a Blob directly — IndexedDB supports this natively
    synced: false,
    createdAt: new Date().toISOString(),
  };

  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CERTS, "readwrite");
    tx.objectStore(STORE_CERTS).put(entry);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  // Try to sync immediately if we're online; otherwise it waits for the
  // 'online' listener registered by initCalibrationSync().
  if (navigator.onLine) {
    syncPending().catch(err => console.warn("Sync attempt failed, will retry later:", err));
  }

  return localId;
}

/**
 * List every certificate saved locally for a given tag (used to show
 * "recent calibrations" in the UI even while offline, before they've synced).
 */
async function listLocalCalibrations(tagNumber) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CERTS, "readonly");
    const idx = tx.objectStore(STORE_CERTS).index("tag");
    const req = idx.getAll(tagNumber);
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.calibrationDate.localeCompare(a.calibrationDate)));
    req.onerror = () => reject(req.error);
  });
}

/**
 * Upload every not-yet-synced record to Supabase. Safe to call repeatedly —
 * anything already synced is skipped. Call this on app load and whenever
 * the browser regains connectivity.
 */
async function syncPending(supabaseClient) {
  const supabase = supabaseClient || window.__calSyncSupabase;
  if (!supabase) {
    console.warn("syncPending: no Supabase client configured, skipping.");
    return { synced: 0, failed: 0 };
  }

  const db = await openDB();
  const pending = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CERTS, "readonly");
    const idx = tx.objectStore(STORE_CERTS).index("synced");
    // IDBKeyRange doesn't do booleans well across browsers — filter in JS instead.
    const req = tx.objectStore(STORE_CERTS).getAll();
    req.onsuccess = () => resolve(req.result.filter(r => !r.synced));
    req.onerror = () => reject(req.error);
  });

  let synced = 0, failed = 0;

  for (const rec of pending) {
    try {
      // 1. Resolve (or create) the instrument by tag.
      let { data: inst, error: instErr } = await supabase
        .from("instruments")
        .select("id")
        .eq("tag_number", rec.tagNumber)
        .maybeSingle();

      if (instErr) throw instErr;

      if (!inst) {
        // No matching instrument yet — create it with whatever metadata this
        // calibration form captured. Site/area/manufacturer etc. can still be
        // edited later from the web table if anything here was left blank.
        const { data: created, error: createErr } = await supabase
          .from("instruments")
          .insert({
            tag_number: rec.tagNumber,
            interval_months: rec.intervalMonths,
            manufacturer: rec.manufacturer,
            model: rec.model,
            serial_number: rec.serialNumber,
            area: rec.siteLocation,
          })
          .select("id")
          .single();
        if (createErr) throw createErr;
        inst = created;
      }

      // 2. Upload the PDF to Storage.
      const path = `${rec.tagNumber}/${rec.calibrationDate}_${rec.certificateNo || rec.localId}.pdf`;
      const { error: uploadErr } = await supabase.storage
        .from(CERTIFICATES_BUCKET)
        .upload(path, rec.pdfBlob, { contentType: "application/pdf", upsert: true });
      if (uploadErr) throw uploadErr;

      // 3. Insert the calibration_events row.
      const { error: insertErr } = await supabase
        .from("calibration_events")
        .insert({
          instrument_id: inst.id,
          calibration_date: rec.calibrationDate,
          result: rec.result,
          interval_months: rec.intervalMonths,
          technician: rec.technician,
          certificate_no: rec.certificateNo,
          pdf_path: path,
          source_file: `local-${rec.localId}`,
        });
      if (insertErr) throw insertErr;

      // 4. Mark synced locally (keep the record — don't delete — so the
      //    device retains an offline copy of everything it's ever logged).
      await markSynced(rec.localId);
      synced++;
    } catch (err) {
      console.warn(`Sync failed for ${rec.tagNumber} (${rec.calibrationDate}):`, err.message || err);
      failed++;
      // leave it in the queue — will retry next time syncPending() runs
    }
  }

  return { synced, failed };
}

async function markSynced(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_CERTS, "readwrite");
    const store = tx.objectStore(STORE_CERTS);
    const req = store.get(localId);
    req.onsuccess = () => {
      const rec = req.result;
      if (rec) {
        rec.synced = true;
        rec.pdfBlob = null; // no need to keep the blob twice once it's in Storage
        store.put(rec);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Call once on app startup, after creating your Supabase client.
 *   initCalibrationSync(supabase);
 * Wires up auto-retry on reconnect and does an initial sync attempt.
 */
function initCalibrationSync(supabaseClient) {
  window.__calSyncSupabase = supabaseClient;
  window.addEventListener("online", () => {
    console.log("Back online — syncing pending calibrations…");
    syncPending().then(({ synced, failed }) => {
      if (synced) console.log(`Synced ${synced} calibration(s).`);
      if (failed) console.warn(`${failed} calibration(s) still pending.`);
    });
  });
  // attempt a sync on load too, in case anything was queued from a previous session
  if (navigator.onLine) syncPending();
}

// Expose as a small global namespace so it drops into a vanilla-JS PWA
// without a bundler/module system.
window.CalibrationSync = {
  init: initCalibrationSync,
  save: saveCalibration,
  listLocal: listLocalCalibrations,
  syncPending,
};
