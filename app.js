// ShipCard: everything runs locally in the browser. No uploads, no tracking.
(() => {
  const $ = (id) => document.getElementById(id);
  const canvas = $('card');
  const ctx = canvas.getContext('2d');
  const W = 1200, H = 675;

  const THEMES = [
    { name: 'Night', a: '#0f172a', b: '#111827', text: '#f8fafc', muted: '#94a3b8', accent: '#10b981' },
    { name: 'Ocean', a: '#0c4a6e', b: '#1e1b4b', text: '#f0f9ff', muted: '#a5b4fc', accent: '#38bdf8' },
    { name: 'Sunset', a: '#7c2d12', b: '#4c0519', text: '#fff7ed', muted: '#fdba74', accent: '#fb923c' },
    { name: 'Paper', a: '#f8fafc', b: '#e2e8f0', text: '#0f172a', muted: '#475569', accent: '#16a34a' },
    { name: 'Grape', a: '#3b0764', b: '#111827', text: '#faf5ff', muted: '#c4b5fd', accent: '#a78bfa' },
  ];
  let theme = THEMES[0];
  const state = { before: null, after: null, diff: null };

  // ---------- theme swatches ----------
  const themesEl = $('themes');
  THEMES.forEach((t, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = t.name;
    b.setAttribute('aria-label', t.name + ' theme');
    b.style.background = `linear-gradient(135deg, ${t.a}, ${t.b})`;
    if (i === 0) b.classList.add('on');
    b.onclick = () => {
      theme = t;
      themesEl.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      render();
    };
    themesEl.appendChild(b);
  });

  // ---------- loading images ----------
  function loadFile(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }
  function loadUrl(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = url;
    });
  }
  async function setImage(which, img) {
    state[which] = img;
    const thumb = $(which === 'before' ? 'thumbBefore' : 'thumbAfter');
    thumb.src = img.src;
    thumb.hidden = false;
    if (state.before && state.after) state.diff = computeDiff(state.before, state.after, +$('sens').value);
    render();
  }

  function wireDrop(which) {
    const zone = $(which === 'before' ? 'dropBefore' : 'dropAfter');
    const input = $(which === 'before' ? 'fileBefore' : 'fileAfter');
    input.onchange = async () => { if (input.files[0]) setImage(which, await loadFile(input.files[0])); };
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', async (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
      if (f) setImage(which, await loadFile(f));
    });
  }
  wireDrop('before');
  wireDrop('after');

  window.addEventListener('paste', async (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    const img = await loadFile(item.getAsFile());
    setImage(!state.before ? 'before' : 'after', img);
  });

  $('sample').onclick = async () => {
    const [b, a] = await Promise.all([loadUrl('sample-before.png'), loadUrl('sample-after.png')]);
    state.before = b; // set both, then diff once
    await setImage('before', b);
    await setImage('after', a);
  };

  // ---------- visual diff ----------
  // Both images are scaled to the same analysis width, compared pixel by pixel,
  // then changed pixels are grouped into grid cells and merged into regions.
  const AW = 600, CELL = 10;
  function toPixels(img, w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, img.naturalHeight * (w / img.naturalWidth));
    return g.getImageData(0, 0, w, h).data;
  }
  function computeDiff(before, after, sens) {
    const hb = Math.round(before.naturalHeight * (AW / before.naturalWidth));
    const ha = Math.round(after.naturalHeight * (AW / after.naturalWidth));
    const AH = Math.max(1, Math.min(hb, ha, 2400));
    const p1 = toPixels(before, AW, AH);
    const p2 = toPixels(after, AW, AH);
    const cols = Math.ceil(AW / CELL), rows = Math.ceil(AH / CELL);
    const counts = new Uint16Array(cols * rows);
    let changed = 0;
    for (let y = 0; y < AH; y++) {
      for (let x = 0; x < AW; x++) {
        const i = (y * AW + x) * 4;
        const d = Math.abs(p1[i] - p2[i]) + Math.abs(p1[i + 1] - p2[i + 1]) + Math.abs(p1[i + 2] - p2[i + 2]);
        if (d > sens * 3) { changed++; counts[((y / CELL) | 0) * cols + ((x / CELL) | 0)]++; }
      }
    }
    const minPx = CELL * CELL * 0.03;
    const on = new Uint8Array(cols * rows);
    for (let k = 0; k < on.length; k++) on[k] = counts[k] > minPx ? 1 : 0;
    // dilate one cell so nearby changes merge into one region
    const dil = new Uint8Array(on.length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      if (!on[r * cols + c]) continue;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) dil[rr * cols + cc] = 1;
      }
    }
    // connected components -> bounding boxes
    const seen = new Uint8Array(on.length);
    const boxes = [];
    for (let k = 0; k < dil.length; k++) {
      if (!dil[k] || seen[k]) continue;
      let minC = 1e9, minR = 1e9, maxC = -1, maxR = -1, n = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const q = stack.pop();
        const r = (q / cols) | 0, c = q % cols;
        if (on[q]) n++;
        minC = Math.min(minC, c); maxC = Math.max(maxC, c);
        minR = Math.min(minR, r); maxR = Math.max(maxR, r);
        const nb = [q - 1, q + 1, q - cols, q + cols];
        for (const m of nb) {
          if (m < 0 || m >= dil.length || seen[m] || !dil[m]) continue;
          if ((m === q - 1 && c === 0) || (m === q + 1 && c === cols - 1)) continue;
          seen[m] = 1; stack.push(m);
        }
      }
      if (n >= 3) boxes.push({ x: minC * CELL, y: minR * CELL, w: (maxC - minC + 1) * CELL, h: (maxR - minR + 1) * CELL });
    }
    boxes.sort((a, b) => b.w * b.h - a.w * a.h);
    return { boxes: boxes.slice(0, 12), pct: (changed / (AW * AH)) * 100, AW, AH };
  }

  // ---------- drawing ----------
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function fitText(text, max, size, weight) {
    let s = size;
    do { ctx.font = `${weight} ${s}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; s -= 2; }
    while (ctx.measureText(text).width > max && s > 16);
  }
  // draws an image into a panel, filling the width and cropping from the top
  function drawPanel(img, x, y, w, h, label, isAfter) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 30; ctx.shadowOffsetY = 12;
    roundRect(x, y, w, h, 16);
    ctx.fillStyle = '#0b0d10';
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(x, y, w, h, 16);
    ctx.clip();
    let scale = 1;
    if (img) {
      scale = w / img.naturalWidth;
      ctx.drawImage(img, x, y, w, img.naturalHeight * scale);
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.06)';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,.35)';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Drop a screenshot', x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
    }
    if (isAfter && img && state.diff && $('highlight').checked) {
      const k = (img.naturalWidth / state.diff.AW) * scale; // analysis px -> panel px
      ctx.lineWidth = 3;
      state.diff.boxes.forEach((b) => {
        const bx = x + b.x * k - 8, by = y + b.y * k - 6, bw = b.w * k + 16, bh = b.h * k + 12;
        if (by > y + h) return;
        ctx.fillStyle = hexA(theme.accent, 0.14);
        ctx.strokeStyle = theme.accent;
        ctx.shadowColor = theme.accent; ctx.shadowBlur = 12;
        roundRect(bx, by, bw, bh, 8);
        ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
      });
    }
    ctx.restore();
    // label pill
    ctx.font = '700 15px system-ui, sans-serif';
    const tw = ctx.measureText(label).width;
    roundRect(x + 14, y + 14, tw + 24, 30, 15);
    ctx.fillStyle = isAfter ? theme.accent : 'rgba(17,24,39,.82)';
    ctx.fill();
    ctx.fillStyle = isAfter ? '#04120c' : '#e5e7eb';
    ctx.fillText(label, x + 26, y + 34);
  }
  function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function layoutOffset() {
    const pw = (W - 112 - 28) / 2;
    const aspect = Math.max(
      state.before ? state.before.naturalHeight / state.before.naturalWidth : 0,
      state.after ? state.after.naturalHeight / state.after.naturalWidth : 0
    ) || 0.625;
    return Math.round((460 - Math.min(460, Math.round(pw * aspect))) / 2);
  }

  function render() {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, theme.a);
    g.addColorStop(1, theme.b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // soft glow
    const rg = ctx.createRadialGradient(W * 0.8, -40, 10, W * 0.8, -40, 520);
    rg.addColorStop(0, hexA(theme.accent, 0.28));
    rg.addColorStop(1, hexA(theme.accent, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    const title = $('title').value.trim() || 'What I shipped';
    const handle = $('handle').value.trim();
    ctx.fillStyle = theme.text;
    const off0 = layoutOffset();
    fitText(title, 820, 40, 800);
    ctx.fillText(title, 56, 82 + off0);
    if (handle) {
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'right';
      ctx.fillText(handle, W - 56, 80 + off0);
      ctx.textAlign = 'left';
    }

    const gap = 28, pw = (W - 112 - gap) / 2, maxH = 460;
    // panel height follows the screenshots' aspect ratio so there is no empty band
    const aspect = Math.max(
      state.before ? state.before.naturalHeight / state.before.naturalWidth : 0,
      state.after ? state.after.naturalHeight / state.after.naturalWidth : 0
    ) || 0.625;
    const ph = Math.min(maxH, Math.round(pw * aspect));
    const off = Math.round((maxH - ph) / 2); // center the whole composition vertically
    const top = 118 + off;
    drawPanel(state.before, 56, top, pw, ph, 'BEFORE', false);
    drawPanel(state.after, 56 + pw + gap, top, pw, ph, 'AFTER', true);
    // arrow between panels
    const ax = 56 + pw + gap / 2, ay = top + ph / 2;
    ctx.beginPath(); ctx.arc(ax, ay, 22, 0, Math.PI * 2);
    ctx.fillStyle = theme.text; ctx.fill();
    ctx.strokeStyle = theme.a; ctx.lineWidth = 3.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(ax - 8, ay); ctx.lineTo(ax + 8, ay); ctx.moveTo(ax + 2, ay - 7); ctx.lineTo(ax + 9, ay); ctx.lineTo(ax + 2, ay + 7); ctx.stroke();

    // footer line
    const fy = top + ph + 52;
    ctx.font = '600 22px system-ui, sans-serif';
    if (state.diff) {
      const n = state.diff.boxes.length;
      const txt = `${state.diff.pct.toFixed(1)}% of the screen changed`;
      ctx.fillStyle = theme.accent;
      ctx.fillText(txt, 56, fy);
      ctx.fillStyle = theme.muted;
      ctx.fillText(`  ·  ${n} ${n === 1 ? 'area' : 'areas'}`, 56 + ctx.measureText(txt).width, fy);
    } else {
      ctx.fillStyle = theme.muted;
      ctx.fillText(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 56, fy);
    }
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillStyle = hexA(theme.muted.length === 7 ? theme.muted : '#94a3b8', 0.75);
    ctx.textAlign = 'right';
    ctx.fillText('shipcard', W - 56, fy);
    ctx.textAlign = 'left';

    const ready = !!(state.before && state.after);
    $('download').disabled = !ready;
    $('copy').disabled = !ready;
    $('stat').innerHTML = state.diff
      ? `Found <b>${state.diff.boxes.length}</b> changed ${state.diff.boxes.length === 1 ? 'area' : 'areas'}, <b>${state.diff.pct.toFixed(1)}%</b> of the screen`
      : 'Add two screenshots to see the diff';
  }

  // ---------- controls ----------
  ['title', 'handle'].forEach((id) => $(id).addEventListener('input', render));
  $('highlight').addEventListener('change', render);
  $('sens').addEventListener('input', () => {
    if (state.before && state.after) state.diff = computeDiff(state.before, state.after, +$('sens').value);
    render();
  });
  $('download').onclick = () => {
    const a = document.createElement('a');
    a.download = 'shipcard.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  $('copy').onclick = () => {
    canvas.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        $('copy').textContent = 'Copied';
      } catch {
        $('copy').textContent = 'Not supported';
      }
      setTimeout(() => ($('copy').textContent = 'Copy image'), 1600);
    });
  };

  render();
})();
