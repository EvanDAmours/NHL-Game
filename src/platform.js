// Hosting adapters. When Rink GM runs as a published claude.ai page it gets a
// per-player cloud backup (the `db` capability, private to each viewer) and
// file saving through the `downloads` capability. Run anywhere else (vite dev,
// a static host) every helper quietly falls back to plain browser behavior.
import LZString from "lz-string";

const CHUNK = 180000; // characters per cloud document (documents cap at 256 KiB)
let cloudP = null;

function claudeUse(name) {
  try {
    return window.claude?.use ? window.claude.use(name) : Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}

// Resolves { db, base } for this viewer's private save area, or null.
export function cloud() {
  if (!cloudP) {
    cloudP = (async () => {
      const [db, user] = await Promise.all([claudeUse("db"), claudeUse("user")]);
      if (!db || !user) return null;
      const id = await user.id();
      if (!id) return null;
      return { db, base: `data/users/${id}` };
    })().catch(() => null);
  }
  return cloudP;
}

export const cloudStatus = { state: "checking", savedAt: null, error: null };

export async function cloudSave(league) {
  const c = await cloud();
  if (!c) {
    cloudStatus.state = "off";
    return false;
  }
  try {
    const packed = LZString.compressToBase64(JSON.stringify(league));
    const saveId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const n = Math.ceil(packed.length / CHUNK);
    const meta = c.db.doc(`${c.base}/save`);
    for (let i = 0; i < n; i++) {
      await meta.collection("chunks").doc(`c${i}`).set({ saveId, i, s: packed.slice(i * CHUNK, (i + 1) * CHUNK) });
    }
    const user = league.teams[league.userTid];
    const savedAt = Date.now();
    await meta.set({ saveId, n, savedAt, team: `${user.city} ${user.name}`, year: league.year, phase: league.phase });
    cloudStatus.state = "on";
    cloudStatus.savedAt = savedAt;
    cloudStatus.error = null;
    return true;
  } catch (e) {
    cloudStatus.state = "error";
    cloudStatus.error = e?.code === "quota_exceeded" ? "Cloud storage is full." : e?.code === "invalid_argument" ? "This view can't save to the cloud." : "Cloud backup failed; will retry.";
    return false;
  }
}

export async function cloudMeta() {
  const c = await cloud();
  if (!c) {
    cloudStatus.state = "off";
    return null;
  }
  try {
    const snap = await c.db.doc(`${c.base}/save`).get();
    cloudStatus.state = "on";
    if (!snap.exists) return null;
    const m = snap.data();
    cloudStatus.savedAt = m.savedAt;
    return m;
  } catch {
    return null;
  }
}

export async function cloudLoad() {
  const c = await cloud();
  const meta = await cloudMeta();
  if (!c || !meta) return null;
  const parts = [];
  for (let i = 0; i < meta.n; i++) {
    const snap = await c.db.doc(`${c.base}/save`).collection("chunks").doc(`c${i}`).get();
    const d = snap.exists ? snap.data() : null;
    if (!d || d.saveId !== meta.saveId) return null;
    parts.push(d.s);
  }
  const json = LZString.decompressFromBase64(parts.join(""));
  return json ? JSON.parse(json) : null;
}

// Offer a file to the player. Returns "saved", "declined" or "failed".
export async function saveFile(filename, text) {
  const dl = await claudeUse("downloads");
  if (dl) {
    try {
      await dl.save({ filename, data: new Blob([text]) });
      return "saved";
    } catch (e) {
      return e?.code === "declined" ? "declined" : "failed";
    }
  }
  if (window.claude) return "failed"; // inside a viewer without downloads: links are inert
  try {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 500);
    return "saved";
  } catch {
    return "failed";
  }
}

export async function cloudDelete() {
  const c = await cloud();
  const meta = await cloudMeta();
  if (!c || !meta) return;
  try {
    const ref = c.db.doc(`${c.base}/save`);
    for (let i = 0; i < meta.n; i++) await ref.collection("chunks").doc(`c${i}`).delete();
    await ref.delete();
  } catch {
    /* best effort */
  }
}
