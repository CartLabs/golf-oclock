// Push delivery via ntfy.sh — free, no account, installs as a phone app.
// Set NTFY_TOPIC to a long random string (it IS the password — anyone who
// knows the topic can read it). Optional NTFY_SERVER for self-hosted.

const SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

export async function sendPush(hits) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    console.log('[notify] NTFY_TOPIC not set — skipping push.');
    return false;
  }
  if (!hits.length) return false;

  // One notification per course+date keeps the phone from buzzing 30 times.
  const groups = new Map();
  for (const h of hits) {
    const k = `${h.slot.courseName}|${h.slot.date}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(h);
  }

  for (const [, group] of groups) {
    const s = group[0].slot;
    const times = group
      .map((g) => g.slot.timeLabel)
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 8);
    const more = group.length > times.length ? ` +${group.length - times.length} more` : '';
    const price = s.greenFee != null ? ` · from $${s.greenFee}` : '';
    const holes = s.holes ? ` · ${s.holes} holes` : '';

    // foreUP always opens today's sheet and ignores a date in the URL, so for
    // those courses say which day to pick once the page loads.
    const datedLink = s.platform !== 'foreUP';
    const nudge = datedLink ? '' : `\nOpens today's sheet — pick ${prettyDate(s.date)}`;

    const title = `⛳ ${s.courseName} — ${prettyDate(s.date)}`;
    const body = `${times.join(', ')}${more}${holes}${price}\n${group[0].watchLabels.join(', ')}${nudge}`;

    try {
      await fetch(`${SERVER}/${encodeURIComponent(topic)}`, {
        method: 'POST',
        headers: {
          'Title': title,
          'Tags': 'golf',
          'Priority': 'default',
          'Click': s.bookingUrl,
          'Actions': `view, Book now, ${s.bookingUrl}`,
        },
        body,
      });
    } catch (err) {
      console.error('[notify] push failed:', err.message);
    }
  }
  return true;
}

function prettyDate(iso) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}
