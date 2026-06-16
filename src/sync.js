'use strict';

// Pulls the latest workbook from a cloud source so the admin "Sync now" button
// can re-import it. Two configurations (no extra dependencies — uses global
// fetch from Node 18+):
//
//  1. Direct download URL  — set SYNC_XLSX_URL to a link that returns the .xlsx
//     bytes (e.g. a SharePoint/OneDrive "Anyone with the link" download URL).
//
//  2. Microsoft Graph (app-only) — for org-protected OneDrive/SharePoint files:
//       GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET
//     plus EITHER GRAPH_FILE_URL (the file's share/web link)
//          OR     GRAPH_DRIVE_ID + GRAPH_ITEM_ID
//     The Azure app needs Files.Read.All (application) with admin consent.

const TENANT = process.env.GRAPH_TENANT_ID;
const CLIENT_ID = process.env.GRAPH_CLIENT_ID;
const CLIENT_SECRET = process.env.GRAPH_CLIENT_SECRET;
const FILE_URL = process.env.GRAPH_FILE_URL;
const DRIVE_ID = process.env.GRAPH_DRIVE_ID;
const ITEM_ID = process.env.GRAPH_ITEM_ID;
const DIRECT_URL = process.env.SYNC_XLSX_URL;

function graphConfigured() {
  return !!(TENANT && CLIENT_ID && CLIENT_SECRET && (FILE_URL || (DRIVE_ID && ITEM_ID)));
}

function isConfigured() {
  return !!DIRECT_URL || graphConfigured();
}

function sourceLabel() {
  if (graphConfigured()) return 'OneDrive / SharePoint (Microsoft Graph)';
  if (DIRECT_URL) return 'direct download URL';
  return 'not configured';
}

// SharePoint/OneDrive share URL -> Graph share id (the documented "u!" scheme).
function encodeShareUrl(url) {
  const b64 = Buffer.from(url, 'utf8').toString('base64');
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

async function getGraphToken() {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });
  const res = await fetch(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    body,
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status}). Check the Azure app credentials.`);
  const json = await res.json();
  if (!json.access_token) throw new Error('Microsoft sign-in returned no token.');
  return json.access_token;
}

async function downloadViaGraph() {
  const token = await getGraphToken();
  let url;
  if (DRIVE_ID && ITEM_ID) {
    url = `https://graph.microsoft.com/v1.0/drives/${DRIVE_ID}/items/${ITEM_ID}/content`;
  } else {
    url = `https://graph.microsoft.com/v1.0/shares/${encodeShareUrl(FILE_URL)}/driveItem/content`;
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Download from OneDrive/SharePoint failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadViaUrl() {
  const res = await fetch(DIRECT_URL);
  if (!res.ok) throw new Error(`Download from URL failed (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

// Returns the workbook as a Buffer, or throws a friendly error.
async function fetchWorkbook() {
  if (graphConfigured()) return downloadViaGraph();
  if (DIRECT_URL) return downloadViaUrl();
  throw new Error('Cloud sync is not configured.');
}

module.exports = { isConfigured, sourceLabel, fetchWorkbook };
