# GradeTracker

Track BTEC-style student work and share each student a private, read-only link
showing what they've completed and what's still **outstanding before the end of
the year**.

Built from the "Year 1 outstanding work break down" sheet: each **Unit** has
**Assignments** (A1, A2, …), and each assignment covers a set of
**Pass / Merit / Distinction** criteria (P1, M1, D1, …).

## What it does

- **Teacher admin** (password-protected):
  - Add students; each gets a unique private link automatically.
  - Tick criteria complete/outstanding in a per-student grid (saves instantly).
  - Add / rename / delete units, assignments and criteria.
- **Students** open their own link (`/s/<token>`) and see **only their own**
  progress — a clear "still to complete" list plus the full breakdown. No login.
  They can print it or save as PDF.

## Unit grades (Pass / Merit / Distinction)

Each unit shows a calculated grade badge on both the student page and the admin
marking grid, using the standard cumulative BTEC ladder:

- **Pass** — all P criteria complete
- **Merit** — all P **and** all M criteria complete
- **Distinction** — all P, M **and** D criteria complete
- otherwise **Working towards**

On the marking grid the badge updates live as you tick criteria.

## Importing students & progress (CSV)

From the admin dashboard you can bulk-load students and their progress:

1. Click **Download CSV (template & backup)**. The file has one column per
   criterion, headed `Unit 1 | P1`, `Unit 1 | P2`, …, and a row per existing
   student.
2. In a spreadsheet, add a row per student (first column = name) and put an
   **x** in each criterion they've completed (blank = outstanding). Accepted
   "complete" values: `x`, `yes`, `1`, `done`, `✓`.
3. Back in the admin, upload the file (or paste the CSV) under **Import / export**.

Students are matched by name (case-insensitive) or created automatically. Only
the criteria included as columns are changed. Unrecognised columns are ignored
and reported. The same CSV download also works as a simple backup.

### It also reads existing tracking sheets

You don't have to use the template. The importer auto-detects a typical teacher
tracking sheet:

- a **unit title** row (e.g. `Unit 1 Exploring Business`),
- an assignment row (`A1`, `A2`, …),
- a **`Students`** row of bare criteria codes (`P1`, `P2`, … `D4`),
- student rows with `y`/`n` cells, plus trailing summary columns
  (`Unit Grade`, `Unit Points`) which are ignored.

`y` / `yes` / `x` / `1` / `done` / `✓` count as complete; `n` / `r` / blank
count as outstanding. The unit name in the title row is matched to a unit by
prefix (`Unit 1 Exploring Business` → `Unit 1`), so the bare codes map to the
right criteria. Upload one unit sheet at a time.

## Importing a full Excel workbook (.xlsx)

You can upload your whole mark book directly — no need to convert tabs to CSV.
Under **Import / export** on the dashboard, choose **Import workbook** and pick
the `.xlsx`. It reads every tab whose name identifies a unit (e.g. `Unit 8` or
`U1 A123`) and that has a row of criteria codes (`P1`, `P2`, …):

- **Units, assignments and criteria are built from the sheet.** Adjacent
  criterion columns become one assignment (`A1`, `A2`, …); a grade/points column
  between them starts the next assignment.
- **Student names** are read as First + Surname and matched across tabs, so each
  student's progress spans every unit.
- `y` / `yes` / `x` / `1` counts as complete; `n` / `r` / `U` / blank counts as
  outstanding.
- Summary-only tabs (grades/points) and non-unit tabs are skipped and listed in
  the result so you can see exactly what was and wasn't imported.

Already-existing units/criteria are reused (matched by name/code), so
re-uploading updates rather than duplicates.

### Student numbers & GDPR-friendly display

If a tab has a **Student No.** column (e.g. `SC243208`), it's captured and used
to match students across tabs (falling back to name). Students are shown as
**`StudentNo · First L.`** — first name plus last initial only, never the full
surname — **everywhere, including the teacher admin**. Full names are stored
(used for matching) but only revealed when you expand "Edit name / student
number" on a student. You can also clear everything via **Danger zone → Clear
all data** on the dashboard to re-import from scratch.

The importer copes with common sheet quirks: names split into First/Surname
columns (in either header position), a blank/offset **P1** header (inferred from
the next code), and `Withdrawn` in the number column (ignored). For safety it
**validates that name columns actually contain names** and **skips tabs/rows it
can't parse cleanly** (e.g. numeric criteria headers, summary-only tabs,
misaligned rows) rather than inventing records — everything skipped is reported
after import.

## Cloud sync (OneDrive / SharePoint) — "Sync now" button

When configured, the dashboard shows a **Sync now** button that pulls the latest
workbook from the cloud and re-imports it (idempotent — matches existing
students/units, no duplicates). Configure via environment variables, either:

**Option A — direct download URL (simplest, no Azure):**

```
SYNC_XLSX_URL=https://…   # a link that returns the .xlsx bytes
```

Use this if your file has a shareable "Anyone with the link" download URL.

**Option B — Microsoft Graph (for org-protected files):**

```
GRAPH_TENANT_ID=…
GRAPH_CLIENT_ID=…
GRAPH_CLIENT_SECRET=…
# then EITHER the file's share/web link:
GRAPH_FILE_URL=https://yourschool.sharepoint.com/…/Mark_Book.xlsx
# OR the drive + item ids:
GRAPH_DRIVE_ID=…
GRAPH_ITEM_ID=…
```

Setup for Option B (your IT / Azure admin does this once):

1. In **Azure Portal → App registrations**, create an app; note the
   **Directory (tenant) ID** and **Application (client) ID**.
2. **Certificates & secrets → New client secret**; copy the value.
3. **API permissions → Microsoft Graph → Application permissions →
   `Files.Read.All`** (or `Sites.Read.All`), then **Grant admin consent**.
4. Put the workbook in OneDrive/SharePoint and set `GRAPH_FILE_URL` to its link.

The host must allow outbound HTTPS to `login.microsoftonline.com` and
`graph.microsoft.com`. (A scheduled auto-pull or push-on-save can be added later
on top of this.)

## Running it

```bash
npm install
ADMIN_PASSWORD=yourpassword npm start
```

Then open http://localhost:3000 and sign in.

### Environment variables

| Variable         | Default      | Purpose                                              |
| ---------------- | ------------ | ---------------------------------------------------- |
| `PORT`           | `3000`       | Port to listen on.                                   |
| `ADMIN_PASSWORD` | `changeme`   | Teacher sign-in password. **Change this.**           |
| `COOKIE_SECRET`  | random       | Set a fixed value so admin sessions survive restarts. |

## Deploying

The app needs a **persistent disk** for `data/db.json`. Point `DATA_DIR` at the
mounted volume.

**Render (one-click via blueprint):** `render.yaml` is included. Create a new
Blueprint from this repo, then set `ADMIN_PASSWORD` in the dashboard. It
provisions a 1 GB persistent disk mounted at `/data`. See **[DEPLOY.md](DEPLOY.md)**
for a full step-by-step, non-technical walkthrough.

**Docker / any host:**

```bash
docker build -t gradetracker .
docker run -p 3000:3000 \
  -e ADMIN_PASSWORD=yourpassword \
  -e COOKIE_SECRET=some-long-random-string \
  -v gradetracker-data:/data \
  gradetracker
```

The `-v` volume keeps your data across restarts and image rebuilds.

## Data

All data lives in `data/db.json` (created on first run and seeded with Units 1,
4, 8, 9 and 27 from the sheet). It's git-ignored. Back it up to keep your data;
delete it to reset to the seed.

## Notes

- Student links are unguessable tokens. Anyone with a link can view that
  student's progress (read-only), so share them privately. Use **Regenerate
  link** on a student to invalidate the old one.
- Unit 8's criteria were blank on the original sheet, so its assignments start
  empty — add criteria in **Units & criteria**.
