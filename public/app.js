'use strict';

// Copy-to-clipboard buttons (share links).
document.addEventListener('click', function (e) {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.getAttribute('data-copy');
  const done = function () {
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(function () { btn.textContent = original; }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text, done); });
  } else {
    fallbackCopy(text, done);
  }
});

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (err) { /* ignore */ }
  document.body.removeChild(ta);
  done();
}

// Toggle criteria in the admin marking grid.
const main = document.querySelector('main[data-student-id]');
if (main) {
  const studentId = main.getAttribute('data-student-id');
  main.addEventListener('click', function (e) {
    const btn = e.target.closest('.toggle');
    if (!btn) return;
    const criterionId = btn.getAttribute('data-criterion-id');
    const next = btn.getAttribute('data-complete') !== '1';
    btn.disabled = true;
    fetch('/admin/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studentId, criterionId, complete: next }),
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data.ok) throw new Error('save failed');
        btn.setAttribute('data-complete', next ? '1' : '0');
        btn.classList.toggle('complete', next);
        btn.classList.toggle('outstanding', !next);
        updateSummary(data.summary);
      })
      .catch(function () { alert('Could not save — please try again.'); })
      .finally(function () { btn.disabled = false; });
  });
}

function updateSummary(summary) {
  if (!summary) return;
  const count = document.getElementById('count');
  const pct = document.getElementById('pct');
  const bar = document.getElementById('bar');
  if (count) count.textContent = summary.done;
  if (pct) pct.textContent = summary.pct + '%';
  if (bar) bar.style.width = summary.pct + '%';
}
