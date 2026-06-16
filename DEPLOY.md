# Deploying GradeTracker on Render — step by step

This is a no-jargon guide to putting GradeTracker online so you can sign in and
share links with students. It takes about 10 minutes. You don't need to write
any code.

---

## Before you start

- A **GitHub account** (you already have one — the code lives there).
- A **Render account** — free to create at <https://render.com> (you can click
  "Sign in with GitHub").
- Decide on a **teacher password** you'll use to sign in. Pick something only
  you know.

---

## Step 1 — Create the service from the blueprint

1. Sign in to <https://dashboard.render.com>.
2. Click **New +** (top right) → **Blueprint**.
3. If asked, **connect your GitHub** and give Render access to the
   **GradeTracker** repository.
4. Choose the **GradeTracker** repo from the list and click **Connect**.

Render reads the `render.yaml` file in the repo and proposes a web service
called **gradetracker** with a small attached disk for your data. You don't need
to change these.

## Step 2 — Set your teacher password

During setup Render will ask you to fill in the **`ADMIN_PASSWORD`** value
(it's marked as needing a value). Type the password you chose. This is the
password you'll use to sign in as the teacher.

> You can leave `COOKIE_SECRET` and `DATA_DIR` exactly as they are — Render
> fills those in automatically.

## Step 3 — Deploy

1. Click **Apply** (or **Create / Deploy**).
2. Render builds and starts the app. The first build takes a few minutes —
   watch the log until it says something like
   `GradeTracker running on http://localhost:3000` and the status turns
   **Live**.

## Step 4 — Open it and sign in

1. At the top of the service page Render shows your app's URL, e.g.
   `https://gradetracker-xxxx.onrender.com`.
2. Open it → you'll see the **teacher sign in** page.
3. Enter the password from Step 2.

## Step 5 — Add students and share links

1. On the dashboard, type a student's name and click **Add student**.
2. Each student gets a private link like
   `https://gradetracker-xxxx.onrender.com/s/abc123…`.
3. Click **Copy link** and send it to that student (email, Teams, Google
   Classroom, etc.). They open it and see only their own progress — no login.
4. Click **Mark work** on a student to tick off criteria as they're completed.
   Changes save automatically and the student's link updates instantly.

That's it — you're live. 🎉

---

## Updating the app later

Any time new changes are merged into the `main` branch on GitHub, Render
redeploys automatically. Your student data on the disk is kept across updates.

---

## Cost: free vs paid

| | Free instance | Starter (~$7/month) — set up in `render.yaml` |
|---|---|---|
| Cost | £0 | ~$7/month |
| Keeps student data | ❌ No persistent disk — data resets on restart/redeploy | ✅ Data saved on a disk |
| Always awake | ❌ Sleeps when idle; first visit takes ~30s to wake | ✅ Stays awake |
| Good for | Trying it out | Real classroom use |

The blueprint is configured for the **Starter** plan so your data is safe. If
you only want to trial it for free, tell me and I'll switch the config to the
free tier (just be aware progress won't be saved between restarts).

---

## Keeping your data safe

All data lives in a single file (`db.json`) on the Render disk. To take a
backup, you can download it from the service's **Shell** tab:

```
cat /data/db.json
```

Copy the output somewhere safe. To restore, paste it back into that file.

---

## Troubleshooting

- **"Not found" when a student opens their link** — the link was probably
  regenerated. Open that student in the admin and copy the new link.
- **Forgot the teacher password** — in Render, open the service →
  **Environment** → edit `ADMIN_PASSWORD` → save (it redeploys).
- **App is slow to load first time** — on the free tier it was asleep; wait
  ~30 seconds. Upgrade to Starter to avoid this.
