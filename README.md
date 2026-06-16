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
