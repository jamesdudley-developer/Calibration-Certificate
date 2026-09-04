(function () {
  'use strict';

  // ---------- State ----------
  const DEFAULT_AF = [
    { point: 1, value: '', measured: '' },
    { point: 2, value: '', measured: '' }
  ];

  const DEFAULT_AL = [
    { point: 1, value: '', measured: '' },
    { point: 2, value: '', measured: '' }
  ];

  let chart = null;
  let sigPad = null;       // drawing canvas context
  let sigDrawing = false;
  let hasSignature = false;

  // ---------- Helpers ----------
  function $(id) { return document.getElementById(id); }

  function num(v) {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function fmt(n, digits = 4) {
    if (n === null || n === undefined || isNaN(n)) return '';
    return Number(n).toFixed(digits);
  }

  function getLRV() { return num($('lrv').value) ?? 0; }
  function getURV() { return num($('urv').value) ?? 0; }
  function getSpan() { return getURV() - getLRV(); }

  function isFlowUnit() {
    const sel = $('unitSelect');
    const opt = sel && sel.options[sel.selectedIndex];
    return !!(opt && opt.dataset.category === 'Flow');
  }

  function isSwitchUnit() {
    const sel = $('unitSelect');
    const opt = sel && sel.options[sel.selectedIndex];
    return !!(opt && opt.dataset.category === 'Discrete');
  }

  function isSqrtExtraction() {
    const chk = $('sqrtExtraction');
    return !!(chk && isFlowUnit() && chk.checked);
  }

  // For a flow transmitter with square-root extraction, the process value
  // entered at each calibration point is the %-of-range differential
  // pressure (DP) actually injected into the transmitter. The transmitter's
  // internal extractor makes its 4-20mA output proportional to the SQUARE
  // ROOT of that %DP (since flow ∝ √DP), so the target mA point must follow
  // the sqrt curve rather than a straight line.
  function targetMA(processValue) {
    const lrv = getLRV();
    const span = getSpan();
    if (span === 0 || processValue === null) return null;
    const pct = (processValue - lrv) / span;
    if (isSqrtExtraction()) {
      if (pct < 0) return null; // sqrt of a negative %DP is undefined
      return 4 + 16 * Math.sqrt(pct);
    }
    return 4 + 16 * pct;
  }

  function maError(target, measured) {
    if (target === null || measured === null) return null;
    return measured - target;
  }

  function pctSpanError(error) {
    if (error === null) return null;
    return (error / 16) * 100;
  }

  function unitLabel() {
    const sel = $('unitSelect');
    if (!sel) return 'mmH₂O';
    // Prefer pretty display name when available
    const pretty = {
      'mmH2O': 'mmH₂O',
      'kPa': 'kPa',
      'bar': 'bar',
      'mbar': 'mbar',
      'psi': 'psi',
      'LevelPct': 'Level %',
      'm': 'm',
      'mm': 'mm',
      'm³/h': 'm³/h',
      'L/min': 'L/min',
      '°C': '°C',
      '°F': '°F',
      'kg': 'kg',
      't': 't',
      'Switch': 'Switch'
    };
    const base = pretty[sel.value] || sel.value || 'mmH₂O';
    return isSqrtExtraction() ? base + ' (√ extraction)' : base;
  }

  // ---------- Range / Unit ----------
  let lastSwitchMode = false;

  function updateSqrtToggleUI() {
    const wrap = $('sqrtExtractionWrap');
    const chk = $('sqrtExtraction');
    const stateEl = $('sqrtExtractionState');
    const on = !!(chk && chk.checked);
    if (stateEl) stateEl.textContent = on ? 'ON' : 'OFF';
    if (wrap) wrap.classList.toggle('active', on);
  }

  function updateSqrtVisibility() {
    const wrap = $('sqrtExtractionWrap');
    if (!wrap) return;
    const show = isFlowUnit();
    // Controlled via inline style rather than the `hidden` attribute: an
    // author CSS rule with matching specificity (e.g. `display: flex`)
    // silently overrides `[hidden]`'s UA-level `display: none`, which is
    // why a plain hidden-attribute toggle failed to actually hide this.
    wrap.style.display = show ? 'flex' : 'none';
    if (!show) {
      const chk = $('sqrtExtraction');
      if (chk) chk.checked = false;
    }
    updateSqrtToggleUI();
  }

  function updateTableHeaders() {
    const switchMode = isSwitchUnit();
    const c3 = switchMode ? 'Expected State' : 'Target mA';
    const c4 = switchMode ? 'Actual State' : 'Measured mA';
    const c5 = switchMode ? 'Result' : 'mA Error';
    const c6 = switchMode ? 'Notes' : '% Span Error';
    ['afCol3Header', 'alCol3Header'].forEach(id => { if ($(id)) $(id).textContent = c3; });
    ['afCol4Header', 'alCol4Header'].forEach(id => { if ($(id)) $(id).textContent = c4; });
    ['afCol5Header', 'alCol5Header'].forEach(id => { if ($(id)) $(id).textContent = c5; });
    ['afCol6Header', 'alCol6Header'].forEach(id => { if ($(id)) $(id).textContent = c6; });
  }

  function currentTableHeaders() {
    if (isSwitchUnit()) return ['Test Point', unitLabel(), 'Expected State', 'Actual State', 'Result', 'Notes'];
    return ['Test Point', unitLabel(), 'Target mA', 'Measured mA', 'mA Error', '% Span Error'];
  }

  function updateSpan() {
    updateSqrtVisibility();
    const switchModeNow = isSwitchUnit();
    if (switchModeNow !== lastSwitchMode) {
      lastSwitchMode = switchModeNow;
      // Target/Measured cells are fundamentally different input types
      // (numeric vs. Open/Closed select) between analog and switch modes,
      // so rebuild the test-point rows fresh whenever the mode flips.
      populateTables();
    }
    updateTableHeaders();
    const span = getSpan();
    const unit = unitLabel();
    if ($('spanValue')) $('spanValue').textContent = fmt(span, 2);
    if ($('unitLabel')) $('unitLabel').textContent = unit;
    if ($('afUnitHeader')) $('afUnitHeader').textContent = unit;
    if ($('alUnitHeader')) $('alUnitHeader').textContent = unit;
    recalcAll();
  }

  // ---------- Table rows ----------
  function createRow(type, data) {
    const tr = document.createElement('tr');
    tr.dataset.type = type;
    const switchMode = isSwitchUnit();
    tr.dataset.mode = switchMode ? 'switch' : 'analog';

    const pointTd = document.createElement('td');
    const pointInput = document.createElement('input');
    pointInput.type = 'number';
    pointInput.value = data.point;
    pointInput.className = 'point-num';
    pointInput.min = 1;
    pointTd.appendChild(pointInput);

    const valTd = document.createElement('td');
    const valInput = document.createElement('input');
    valInput.type = 'number';
    valInput.step = 'any';
    valInput.value = data.value;
    valInput.className = 'process-val';
    valInput.placeholder = '—';
    valTd.appendChild(valInput);

    function buildStateSelect(className) {
      const sel = document.createElement('select');
      sel.className = className;
      ['', 'Open', 'Closed'].forEach(v => {
        const o = document.createElement('option');
        o.value = v;
        o.textContent = v || '—';
        sel.appendChild(o);
      });
      return sel;
    }

    const targetTd = document.createElement('td');
    let targetInput;
    if (switchMode) {
      targetInput = buildStateSelect('target-ma switch-select');
    } else {
      targetInput = document.createElement('input');
      targetInput.type = 'text';
      targetInput.readOnly = true;
      targetInput.tabIndex = -1;
      targetInput.className = 'target-ma calc-field';
      targetInput.placeholder = '—';
    }
    targetTd.appendChild(targetInput);

    const measTd = document.createElement('td');
    let measInput;
    if (switchMode) {
      measInput = buildStateSelect('measured-ma switch-select');
    } else {
      measInput = document.createElement('input');
      measInput.type = 'number';
      measInput.step = 'any';
      measInput.value = data.measured;
      measInput.className = 'measured-ma';
      measInput.placeholder = '—';
    }
    measTd.appendChild(measInput);

    const errTd = document.createElement('td');
    const errInput = document.createElement('input');
    errInput.type = 'text';
    errInput.readOnly = true;
    errInput.tabIndex = -1;
    errInput.className = 'ma-error calc-field';
    errInput.placeholder = switchMode ? '—' : '—';
    errTd.appendChild(errInput);

    const pctTd = document.createElement('td');
    const pctInput = document.createElement('input');
    pctInput.type = 'text';
    if (switchMode) {
      // Free-text notes field for discrete testing; never auto-overwritten.
      pctInput.className = 'pct-error';
      pctInput.placeholder = 'Notes';
    } else {
      pctInput.readOnly = true;
      pctInput.tabIndex = -1;
      pctInput.className = 'pct-error calc-field';
      pctInput.placeholder = '—';
    }
    pctTd.appendChild(pctInput);

    tr.append(pointTd, valTd, targetTd, measTd, errTd, pctTd);

    // listeners
    if (switchMode) {
      valInput.addEventListener('input', () => recalcRow(tr));
      [targetInput, measInput].forEach(inp => {
        inp.addEventListener('change', () => { recalcRow(tr); updateChart(); });
      });
    } else {
      [valInput, measInput].forEach(inp => {
        inp.addEventListener('input', () => recalcRow(tr));
        inp.addEventListener('change', () => updateChart());
      });
    }

    return tr;
  }


  function todayYYMMDD() {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return yy + mm + dd;
  }

  function dateToYYMMDD(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    return iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);
  }

  function parseISODate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function isValidISODate(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    const d = parseISODate(iso);
    if (!d) return false;
    // Reject impossible dates (e.g. 2026-02-31) by round-tripping
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return iso === `${y}-${m}-${day}`;
  }

  function certDateStamp() {
    const cal = $('calDate') && $('calDate').value;
    if (cal && isValidISODate(cal)) return dateToYYMMDD(cal);
    return todayYYMMDD();
  }

  function updateCertNo() {
    const idEl = $('instrumentId');
    const certEl = $('certNo');
    if (!certEl) return;
    const inst = (idEl && idEl.value || '').trim();
    const stamp = certDateStamp();
    certEl.value = inst ? (stamp + '-' + inst) : (stamp + '-');
  }

  function setDateFieldState(el, ok, message) {
    if (!el) return;
    el.classList.toggle('date-invalid', !ok);
    el.title = ok ? '' : (message || 'Invalid date');
    const label = el.closest('label');
    if (label) {
      let hint = label.querySelector('.date-hint');
      if (!ok && message) {
        if (!hint) {
          hint = document.createElement('span');
          hint.className = 'date-hint';
          label.appendChild(hint);
        }
        hint.textContent = message;
      } else if (hint) {
        hint.remove();
      }
    }
  }

  function validateDates() {
    const calEl = $('calDate');
    const signEl = $('signDate');
    const cal = calEl && calEl.value;
    const sign = signEl && signEl.value;
    let allOk = true;

    // Calibration date
    if (cal) {
      if (!isValidISODate(cal)) {
        setDateFieldState(calEl, false, 'Invalid calendar date');
        allOk = false;
      } else {
        const calD = parseISODate(cal);
        const tomorrow = new Date();
        tomorrow.setHours(23, 59, 59, 999);
        // Allow today; warn if far future (> 1 day ahead)
        const maxFuture = new Date();
        maxFuture.setDate(maxFuture.getDate() + 1);
        maxFuture.setHours(23, 59, 59, 999);
        if (calD > maxFuture) {
          setDateFieldState(calEl, false, 'Calibration date cannot be in the future');
          allOk = false;
        } else {
          setDateFieldState(calEl, true);
        }
      }
    } else {
      setDateFieldState(calEl, true);
    }

    // Sign date
    if (sign) {
      if (!isValidISODate(sign)) {
        setDateFieldState(signEl, false, 'Invalid calendar date');
        allOk = false;
      } else if (cal && isValidISODate(cal) && parseISODate(sign) < parseISODate(cal)) {
        setDateFieldState(signEl, false, 'Sign date cannot be before calibration date');
        allOk = false;
      } else {
        setDateFieldState(signEl, true);
      }
    } else {
      setDateFieldState(signEl, true);
    }

    // Equipment next-due dates
    document.querySelectorAll('#equipBody input[type="date"]').forEach(dueEl => {
      const due = dueEl.value;
      if (!due) {
        dueEl.classList.remove('date-invalid');
        dueEl.title = '';
        return;
      }
      if (!isValidISODate(due)) {
        dueEl.classList.add('date-invalid');
        dueEl.title = 'Invalid calendar date';
        allOk = false;
      } else if (cal && isValidISODate(cal) && parseISODate(due) < parseISODate(cal)) {
        dueEl.classList.add('date-invalid');
        dueEl.title = 'Next due should be on or after calibration date';
        allOk = false;
      } else {
        dueEl.classList.remove('date-invalid');
        dueEl.title = '';
      }
    });

    return allOk;
  }

  function getMaxErrorLimit() {
    const n = num($('maxErrorLimit') && $('maxErrorLimit').value);
    return n === null ? null : Math.abs(n);
  }

  function recalcRow(tr) {
    if (tr.dataset.mode === 'switch') {
      const expected = tr.querySelector('.target-ma').value;
      const actual = tr.querySelector('.measured-ma').value;
      const resultEl = tr.querySelector('.ma-error');
      resultEl.classList.remove('error-pos', 'error-neg');
      if (!expected || !actual) {
        resultEl.value = '';
      } else if (expected === actual) {
        resultEl.value = 'PASS';
        resultEl.classList.add('error-neg'); // green
      } else {
        resultEl.value = 'FAIL';
        resultEl.classList.add('error-pos'); // red
      }
      return; // .pct-error is a free-text Notes field here; never overwrite it
    }

    const val = num(tr.querySelector('.process-val').value);
    const measured = num(tr.querySelector('.measured-ma').value);
    const target = targetMA(val);
    const error = maError(target, measured);
    const pct = pctSpanError(error);
    const limit = getMaxErrorLimit();

    const targetEl = tr.querySelector('.target-ma');
    const errEl = tr.querySelector('.ma-error');
    const pctEl = tr.querySelector('.pct-error');

    targetEl.value = target !== null ? fmt(target, 4) : '';
    errEl.value = error !== null ? fmt(error, 6) : '';
    errEl.classList.remove('error-pos', 'error-neg');

    pctEl.value = pct !== null ? fmt(pct, 4) : '';
    pctEl.classList.remove('error-pos', 'error-neg');
    if (pct !== null && limit !== null) {
      if (Math.abs(pct) < limit) {
        pctEl.classList.add('error-neg'); // green
      } else {
        pctEl.classList.add('error-pos'); // red
      }
    }
  }

  function recalcAll() {
    document.querySelectorAll('#asFoundBody tr, #asLeftBody tr').forEach(recalcRow);
    updateChart();
  }

  function populateTables() {
    const afBody = $('asFoundBody');
    const alBody = $('asLeftBody');
    afBody.innerHTML = '';
    alBody.innerHTML = '';
    DEFAULT_AF.forEach(d => afBody.appendChild(createRow('af', d)));
    DEFAULT_AL.forEach(d => alBody.appendChild(createRow('al', d)));
    recalcAll();
  }

  // ---------- Chart ----------
  function getSeries(tbodyId) {
    const points = [];
    const pcts = [];
    document.querySelectorAll(`#${tbodyId} tr`).forEach(tr => {
      const pt = num(tr.querySelector('.point-num').value);
      const pct = num(tr.querySelector('.pct-error').value);
      if (pt !== null && pct !== null) {
        points.push(pt);
        pcts.push(pct);
      }
    });
    // sort by point number
    const pairs = points.map((p, i) => ({ p, pct: pcts[i] })).sort((a, b) => a.p - b.p);
    return {
      labels: pairs.map(x => x.p),
      data: pairs.map(x => x.pct)
    };
  }

  function updateChart() {
    const chartContainer = $('chartContainer');
    const chartNote = $('chartSwitchNote');
    if (isSwitchUnit()) {
      if (chartContainer) chartContainer.style.display = 'none';
      if (chartNote) chartNote.style.display = 'block';
      return;
    }
    if (chartContainer) chartContainer.style.display = '';
    if (chartNote) chartNote.style.display = 'none';

    // Guard: Chart.js may not be loaded (offline / blocked CDN)
    if (typeof Chart === 'undefined') {
      return;
    }

    const af = getSeries('asFoundBody');
    const al = getSeries('asLeftBody');

    // merge unique labels
    const labelSet = new Set([...af.labels, ...al.labels]);
    const labels = Array.from(labelSet).sort((a, b) => a - b);

    function align(series) {
      return labels.map(l => {
        const idx = series.labels.indexOf(l);
        return idx >= 0 ? series.data[idx] : null;
      });
    }

    try {
      if (!chart) {
        const canvas = $('errorChart');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        chart = new Chart(ctx, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [
              {
                label: 'AS FOUND',
                data: align(af),
                borderColor: '#c53030',
                backgroundColor: 'transparent',
                borderWidth: 1.25,
                tension: 0.12,
                pointRadius: 5,
                pointHoverRadius: 7,
                pointStyle: 'circle',
                pointBackgroundColor: '#c53030',
                pointBorderColor: '#ffffff',
                pointBorderWidth: 1.5,
                spanGaps: true,
                order: 2
              },
              {
                label: 'AS LEFT',
                data: align(al),
                borderColor: '#276749',
                backgroundColor: 'transparent',
                borderWidth: 1.25,
                borderDash: [5, 4],
                tension: 0.12,
                pointRadius: 7,
                pointHoverRadius: 9,
                pointStyle: 'triangle',
                pointBackgroundColor: '#38a169',
                pointBorderColor: '#0f2744',
                pointBorderWidth: 1.75,
                spanGaps: true,
                order: 1
              }
            ]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                position: 'top',
                labels: { usePointStyle: true, pointStyleWidth: 10 }
              },
              tooltip: {
                callbacks: {
                  label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y?.toFixed(3) ?? '—'} %`
                }
              }
            },
            scales: {
              x: {
                title: { display: true, text: 'Test Point' },
                ticks: { stepSize: 1 }
              },
              y: {
                title: { display: true, text: '% Span Error' },
                grid: { color: 'rgba(0,0,0,0.06)' },
                min: -1,
                max: 1
              }
            }
          }
        });
        // Apply symmetry on first create
        const allVals0 = [...align(af), ...align(al)].filter(v => v !== null && !isNaN(v));
        if (allVals0.length) {
          const maxAbs = Math.max(...allVals0.map(v => Math.abs(v)), 0.1);
          const pad = maxAbs * 0.15;
          chart.options.scales.y.min = -(maxAbs + pad);
          chart.options.scales.y.max = maxAbs + pad;
          chart.update();
        }
      } else {
        chart.data.labels = labels;
        chart.data.datasets[0].data = align(af);
        chart.data.datasets[1].data = align(al);
        // Symmetrical Y axis around 0
        const allVals = [...align(af), ...align(al)].filter(v => v !== null && !isNaN(v));
        if (allVals.length) {
          const maxAbs = Math.max(...allVals.map(v => Math.abs(v)), 0.1);
          const pad = maxAbs * 0.15;
          chart.options.scales.y.min = -(maxAbs + pad);
          chart.options.scales.y.max = maxAbs + pad;
        } else {
          chart.options.scales.y.min = -1;
          chart.options.scales.y.max = 1;
        }
        chart.update();
      }
    } catch (e) {
      console.error('Chart update failed:', e);
    }
  }

  // ---------- Equipment ----------
  function addEquipRow(device = '', serial = '', due = '') {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="text" value="${device}" placeholder="Device" /></td>
      <td><input type="text" value="${serial}" placeholder="Serial" /></td>
      <td><input type="date" value="${due}" /></td>
    `;
    $('equipBody').appendChild(tr);
  }

  // ---------- PDF Export ----------

  // ---------- Signature pad ----------
  function initSignature() {
    const modal = $('sigModal');
    const pad = $('sigPad');
    const preview = $('sigPreview');
    const placeholder = $('sigPlaceholder');
    if (!pad || !preview) return;

    const ctx = pad.getContext('2d');
    sigPad = ctx;
    ctx.strokeStyle = '#1a202c';
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    function pos(e) {
      const rect = pad.getBoundingClientRect();
      const scaleX = pad.width / rect.width;
      const scaleY = pad.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return {
        x: (src.clientX - rect.left) * scaleX,
        y: (src.clientY - rect.top) * scaleY
      };
    }

    function start(e) {
      e.preventDefault();
      sigDrawing = true;
      const p = pos(e);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }
    function move(e) {
      if (!sigDrawing) return;
      e.preventDefault();
      const p = pos(e);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      hasSignature = true;
    }
    function end(e) {
      if (!sigDrawing) return;
      e.preventDefault();
      sigDrawing = false;
    }

    pad.addEventListener('mousedown', start);
    pad.addEventListener('mousemove', move);
    pad.addEventListener('mouseup', end);
    pad.addEventListener('mouseleave', end);
    pad.addEventListener('touchstart', start, { passive: false });
    pad.addEventListener('touchmove', move, { passive: false });
    pad.addEventListener('touchend', end);

    function openModal() {
      modal.hidden = false;
      // clear any previous strokes only if never signed? keep existing
      document.body.style.overflow = 'hidden';
    }
    function closeModal() {
      modal.hidden = true;
      document.body.style.overflow = '';
      copyToPreview();
    }
    function clearPad() {
      ctx.clearRect(0, 0, pad.width, pad.height);
      hasSignature = false;
      copyToPreview();
    }
    function copyToPreview() {
      const pctx = preview.getContext('2d');
      pctx.clearRect(0, 0, preview.width, preview.height);
      if (hasSignature) {
        pctx.drawImage(pad, 0, 0, preview.width, preview.height);
        placeholder.classList.add('hidden');
      } else {
        placeholder.classList.remove('hidden');
      }
    }

    $('sigPreviewWrap').addEventListener('click', openModal);
    $('sigDone').addEventListener('click', closeModal);
    $('sigClearPad').addEventListener('click', clearPad);
    $('clearSig').addEventListener('click', () => {
      clearPad();
    });

    // expose for reset
    window.__clearSignature = clearPad;
    window.__getSignatureDataUrl = () => hasSignature ? pad.toDataURL('image/png') : null;
  }

  // ---------- PDF Export ----------

  function exportExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Excel library failed to load. Check your internet connection and try again.');
    return;
  }

  const wb = XLSX.utils.book_new();
  const unit = unitLabel();

  const rows = [
    ['Calibration Certificate'],
    ['Certificate No', $('certNo').value || ''],
    ['Result', $('result').value || ''],
    [],
    ['Device Details'],
    ['Instrument ID', $('instrumentId').value || ''],
    ['Process ID', $('processId').value || ''],
    ['Serial Number', ($('serialNumber') && $('serialNumber').value) || ''],
    ['Manufacturer', $('manufacturer').value || ''],
    ['Model', $('model').value || ''],
    ['Extended Model', ($('extendedModel') && $('extendedModel').value) || ''],
    [],
    ['Calibration Details'],
    ['Calibration Date', $('calDate').value || ''],
    ['Calibration Interval', $('calInterval').value || ''],
    ['Technician', $('technician').value || ''],
    ['Max Error Limit (%)', $('maxErrorLimit').value || ''],
    ['Service Reason', $('serviceReason').value || ''],
    ['Adjustment Limit (%)', $('adjLimit').value || ''],
    ['Work Order', $('workOrder').value || ''],
    ['Critical Service', $('criticalService').value || ''],
    ['Site Location', $('siteLocation').value || ''],
    ['Sensor Type', $('sensorType').value || ''],
    ['Ambient Temperature', $('ambientTemp').value || ''],
    ['Sensor Limits', $('sensorLimits').value || ''],
    [],
    ['Range & Span'],
    ['Unit', unit],
    ['LRV', $('lrv').value || ''],
    ['URV', $('urv').value || ''],
    ['Span', fmt(getSpan(), 2)],
    [],
    ['Calibration Equipment'],
    ['Device', 'Serial', 'Next Calibration Due'],
  ];

  document.querySelectorAll('#equipBody tr').forEach(tr => {
    const inputs = tr.querySelectorAll('input');
    rows.push([
      inputs[0] ? inputs[0].value : '',
      inputs[1] ? inputs[1].value : '',
      inputs[2] ? inputs[2].value : ''
    ]);
  });

  rows.push([]);
  rows.push(['AS FOUND']);
  rows.push(currentTableHeaders());
  document.querySelectorAll('#asFoundBody tr').forEach(tr => {
    rows.push([
      tr.querySelector('.point-num').value,
      tr.querySelector('.process-val').value,
      tr.querySelector('.target-ma').value,
      tr.querySelector('.measured-ma').value,
      tr.querySelector('.ma-error').value,
      tr.querySelector('.pct-error').value
    ]);
  });

  rows.push([]);
  rows.push(['AS LEFT']);
  rows.push(currentTableHeaders());
  document.querySelectorAll('#asLeftBody tr').forEach(tr => {
    rows.push([
      tr.querySelector('.point-num').value,
      tr.querySelector('.process-val').value,
      tr.querySelector('.target-ma').value,
      tr.querySelector('.measured-ma').value,
      tr.querySelector('.ma-error').value,
      tr.querySelector('.pct-error').value
    ]);
  });

  rows.push([]);
  rows.push(['Comments', ($('comments') && $('comments').value) || '']);
  rows.push([]);
  rows.push(['Sign Off']);
  rows.push(['Name', ($('signName') && $('signName').value) || '']);
  rows.push(['Date', ($('signDate') && $('signDate').value) || '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 24 }, { wch: 20 }, { wch: 20 }, { wch: 16 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Certificate');

  const cert = ($('certNo').value || '').trim() || (certDateStamp() + '-' + (($('instrumentId').value || '').trim() || 'Certificate'));
  XLSX.writeFile(wb, cert + '.xlsx');
}

async function buildCertificateDoc() {
    if (!validateDates()) {
      const proceed = confirm('Some dates look invalid (highlighted in red). Export anyway?');
      if (!proceed) return null;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 14;

    // Title
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Calibration Certificate', pageW / 2, y, { align: 'center' });
    y += 8;

    // Certificate No + Result centered
    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    const certLine = `Certificate No: ${$('certNo').value || '—'}    Result: ${$('result').value}`;
    doc.text(certLine, pageW / 2, y, { align: 'center' });
    y += 8;

    // Helper: bordered key-value table (2 columns of pairs)
    function borderedPairs(title, pairs) {
      if (y > 260) { doc.addPage(); y = 14; }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(title, 14, y);
      y += 3;

      const body = pairs.map(p => [p[0], p[1] || '—', p[2], p[3] || '—']);
      doc.autoTable({
        startY: y,
        head: false,
        body: body,
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 1.5, lineColor: [180, 180, 180], lineWidth: 0.2 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 42, textColor: [60, 60, 60] },
          1: { cellWidth: 48 },
          2: { fontStyle: 'bold', cellWidth: 42, textColor: [60, 60, 60] },
          3: { cellWidth: 48 }
        },
        margin: { left: 14, right: 14 }
      });
      y = doc.lastAutoTable.finalY + 6;
    }

    borderedPairs('Device Details', [
      ['Instrument ID', $('instrumentId').value, 'Process ID', $('processId').value],
      ['Serial Number', $('serialNumber') ? $('serialNumber').value : '', 'Manufacturer', $('manufacturer').value],
      ['Model', $('model').value, 'Extended Model', $('extendedModel') ? $('extendedModel').value : '']
    ]);

    borderedPairs('Calibration Details', [
      ['Calibration Date', $('calDate').value, 'Calibration Interval', $('calInterval').value],
      ['Technician', $('technician').value, 'Max Error Limit (%)', $('maxErrorLimit').value],
      ['Service Reason', $('serviceReason').value, 'Adjustment Limit (%)', $('adjLimit').value],
      ['Work Order', $('workOrder').value, 'Critical Service', $('criticalService').value],
      ['Site Location', $('siteLocation').value, 'Sensor Type', $('sensorType').value],
      ['Ambient Temperature', $('ambientTemp').value, 'Sensor Limits', $('sensorLimits').value]
    ]);

    // Range & Span
    const unit = unitLabel();
    borderedPairs('Range & Span', [
      ['Unit', unit, 'Span', fmt(getSpan(), 2)],
      ['LRV', $('lrv').value, 'URV', $('urv').value]
    ]);

    // Equipment
    if (y > 250) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Calibration Equipment', 14, y);
    y += 2;

    const equipData = [];
    document.querySelectorAll('#equipBody tr').forEach(tr => {
      const inputs = tr.querySelectorAll('input');
      equipData.push([
        inputs[0].value || '—',
        inputs[1].value || '—',
        inputs[2].value || '—'
      ]);
    });

    doc.autoTable({
      startY: y,
      head: [['Device', 'Serial', 'Next Calibration Due']],
      body: equipData,
      theme: 'grid',
      headStyles: { fillColor: [26, 54, 93], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 8;

    function tableData(tbodyId) {
      const rows = [];
      document.querySelectorAll(`#${tbodyId} tr`).forEach(tr => {
        const pt = tr.querySelector('.point-num').value;
        const val = tr.querySelector('.process-val').value;
        const target = tr.querySelector('.target-ma').value;
        const meas = tr.querySelector('.measured-ma').value;
        const err = tr.querySelector('.ma-error').value;
        const pct = tr.querySelector('.pct-error').value;
        if (pt || val || meas) {
          rows.push([pt, val || '—', target || '—', meas || '—', err || '—', pct || '—']);
        }
      });
      return rows;
    }

    // AS FOUND
    if (y > 240) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('AS FOUND', 14, y);
    y += 2;

    const limit = getMaxErrorLimit();
    const switchModeExport = isSwitchUnit();

    function resultColorHook(data) {
      if (data.section !== 'body') return;
      if (switchModeExport) {
        // Colour the Result column (index 4: PASS/FAIL)
        if (data.column.index === 4) {
          const raw = (data.cell.raw || '').toString().trim().toUpperCase();
          if (raw === 'PASS') {
            data.cell.styles.textColor = [39, 103, 73];
            data.cell.styles.fontStyle = 'bold';
          } else if (raw === 'FAIL') {
            data.cell.styles.textColor = [155, 44, 44];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      } else {
        // Colour the % Span Error column (index 5)
        if (data.column.index === 5) {
          const raw = parseFloat(data.cell.raw);
          if (!isNaN(raw) && limit !== null) {
            if (Math.abs(raw) < limit) {
              data.cell.styles.textColor = [39, 103, 73];   // green
              data.cell.styles.fontStyle = 'bold';
            } else {
              data.cell.styles.textColor = [155, 44, 44];   // red
              data.cell.styles.fontStyle = 'bold';
            }
          }
        }
      }
    }

    doc.autoTable({
      startY: y,
      head: [currentTableHeaders()],
      body: tableData('asFoundBody'),
      theme: 'grid',
      headStyles: { fillColor: [26, 54, 93], fontSize: 8 },
      bodyStyles: { fontSize: 8, halign: 'center' },
      margin: { left: 14, right: 14 },
      didParseCell: resultColorHook
    });
    y = doc.lastAutoTable.finalY + 8;

    // AS LEFT
    if (y > 240) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('AS LEFT', 14, y);
    y += 2;

    doc.autoTable({
      startY: y,
      head: [currentTableHeaders()],
      body: tableData('asLeftBody'),
      theme: 'grid',
      headStyles: { fillColor: [26, 54, 93], fontSize: 8 },
      bodyStyles: { fontSize: 8, halign: 'center' },
      margin: { left: 14, right: 14 },
      didParseCell: resultColorHook
    });
    y = doc.lastAutoTable.finalY + 8;

    // Chart
    if (switchModeExport) {
      if (y > 260) { doc.addPage(); y = 14; }
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text('Trend chart not applicable for discrete switch calibration — see Result column above.', 14, y);
      doc.setTextColor(0);
      y += 10;
    } else {
    if (y > 200) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('% Span Error Chart', 14, y);
    y += 4;
    try {
      const canvas = $('errorChart');
      // Hide tooltips / hover so they do not appear in the export image
      if (chart) {
        chart.options.plugins.tooltip.enabled = false;
        chart.setActiveElements([]);
        chart.update('none');
      }
      const imgData = canvas.toDataURL('image/png', 1.0);
      if (chart) {
        chart.options.plugins.tooltip.enabled = true;
        chart.update('none');
      }
      const imgW = pageW - 28;
      const imgH = Math.min((canvas.height / canvas.width) * imgW, 70);
      doc.addImage(imgData, 'PNG', 14, y, imgW, imgH);
      y += imgH + 8;
    } catch (e) {
      if (chart) {
        try { chart.options.plugins.tooltip.enabled = true; chart.update('none'); } catch (_) {}
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text('(Chart could not be rendered)', 14, y + 6);
      y += 14;
    }
    }

    // Comments (bordered table style)
    if (y > 250) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Comments', 14, y);
    y += 3;
    const comments = ($('comments') && $('comments').value) || '—';
    doc.autoTable({
      startY: y,
      head: false,
      body: [[comments]],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 3, lineColor: [180, 180, 180], lineWidth: 0.2, minCellHeight: 18, valign: 'top' },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 8;

    // Sign Off (bordered table style)
    if (y > 230) { doc.addPage(); y = 14; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Sign Off', 14, y);
    y += 3;

    doc.autoTable({
      startY: y,
      head: false,
      body: [
        ['Name', $('signName').value || '—', 'Date', $('signDate').value || '—']
      ],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, lineColor: [180, 180, 180], lineWidth: 0.2 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 25, textColor: [60, 60, 60] },
        1: { cellWidth: 60 },
        2: { fontStyle: 'bold', cellWidth: 25, textColor: [60, 60, 60] },
        3: { cellWidth: 60 }
      },
      margin: { left: 14, right: 14 }
    });
    y = doc.lastAutoTable.finalY + 4;

    // Signature row as bordered box
    const sigData = window.__getSignatureDataUrl && window.__getSignatureDataUrl();
    doc.autoTable({
      startY: y,
      head: false,
      body: [['Signature', '']],
      theme: 'grid',
      styles: { fontSize: 9, cellPadding: 2, lineColor: [180, 180, 180], lineWidth: 0.2, minCellHeight: 28 },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 30, textColor: [60, 60, 60], valign: 'middle' },
        1: { cellWidth: 140 }
      },
      margin: { left: 14, right: 14 },
      didDrawCell: function (data) {
        if (data.section === 'body' && data.column.index === 1 && sigData) {
          try {
            const dim = data.cell;
            doc.addImage(sigData, 'PNG', dim.x + 2, dim.y + 2, Math.min(60, dim.width - 4), Math.min(24, dim.height - 4));
          } catch (e) {}
        }
      }
    });
    y = doc.lastAutoTable.finalY + 8;

    // Footer
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(120);
      doc.text(`Page ${i} of ${pageCount}  •  Generated ${new Date().toLocaleString()}`, pageW / 2, 290, { align: 'center' });
    }
  return doc;
}

async function exportPDF() {
  const doc = await buildCertificateDoc();
  if (!doc) return;
  const cert = ($('certNo').value || '').trim() || (certDateStamp() + '-' + (($('instrumentId').value || '').trim() || 'Certificate'));
    const filename = `${cert}.pdf`;
    if (window.CalibrationSync) {
    try {
      const pdfBlob = doc.output('blob');
      const resultRaw = ($('result').value || '').toUpperCase();
      const resultMapped = resultRaw === 'FAILED' ? 'Failed' : 'Passed';
      const intervalMatch = (($('calInterval').value || '').match(/\d+/) || [])[0];
      window.CalibrationSync.save({
        tagNumber: ($('instrumentId').value || '').trim(),
        calibrationDate: $('calDate').value || new Date().toISOString().slice(0, 10),
        result: resultMapped,
        intervalMonths: intervalMatch ? parseInt(intervalMatch, 10) : 12,
        technician: $('technician').value || null,
        certificateNo: $('certNo').value || null,
        manufacturer: $('manufacturer').value || null,
        model: $('model').value || null,
        serialNumber: $('serialNumber').value || null,
        siteLocation: $('siteLocation').value || null,
        pdfBlob: pdfBlob,
      }).catch(err => console.warn('Calibration database save failed (will retry when online):', err));
    } catch (err) {
      console.warn('Could not queue calibration for database save:', err);
    }
  }
  doc.save(filename);
  }

  


async function uploadToDatabase() {
  const btn = $('uploadDb');
  if (!window.CalibrationSync) {
    alert('Database sync is not available on this page.');
    return;
  }
  const doc = await buildCertificateDoc();
  if (!doc) return;
  const origLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const pdfBlob = doc.output('blob');
    const resultRaw = ($('result').value || '').toUpperCase();
    const resultMapped = resultRaw === 'FAILED' ? 'Failed' : 'Passed';
    const intervalMatch = (($('calInterval').value || '').match(/\d+/) || [])[0];
    await window.CalibrationSync.save({
      tagNumber: ($('instrumentId').value || '').trim(),
      calibrationDate: $('calDate').value || new Date().toISOString().slice(0, 10),
      result: resultMapped,
      intervalMonths: intervalMatch ? parseInt(intervalMatch, 10) : 12,
      technician: $('technician').value || null,
      certificateNo: $('certNo').value || null,
      manufacturer: $('manufacturer').value || null,
      model: $('model').value || null,
      serialNumber: $('serialNumber').value || null,
      siteLocation: $('siteLocation').value || null,
      pdfBlob: pdfBlob,
    });
    btn.textContent = 'Uploaded ✓';
    setTimeout(() => { btn.textContent = origLabel; btn.disabled = false; }, 2500);
  } catch (err) {
    console.warn('Upload to database failed:', err);
    alert('Upload failed: ' + (err.message || err) + '\n\nIt has been queued locally and will retry automatically when possible.');
    btn.textContent = origLabel;
    btn.disabled = false;
  }
}

function clearAllFields() {
    // text/number/date/select inputs inside main + header (except result keeps PASSED)
    document.querySelectorAll('main input, main textarea, header input').forEach(el => {
      if (el.type === 'checkbox' || el.type === 'radio') return;
      if (el.id === 'result') return;
      el.value = '';
    });
    // selects in main
    document.querySelectorAll('main select').forEach(sel => {
      if (sel.id === 'criticalService') sel.value = 'No';
      else if (sel.id === 'unitSelect') sel.selectedIndex = 0;
      else sel.selectedIndex = 0;
    });
    $('result').value = 'PASSED';
    if ($('sqrtExtraction')) $('sqrtExtraction').checked = false;

    // rebuild tables to 2 empty rows
    const afBody = $('asFoundBody');
    const alBody = $('asLeftBody');
    afBody.innerHTML = '';
    alBody.innerHTML = '';
    DEFAULT_AF.forEach(d => afBody.appendChild(createRow('af', d)));
    DEFAULT_AL.forEach(d => alBody.appendChild(createRow('al', d)));

    // equipment: leave 2 empty rows
    const equipBody = $('equipBody');
    equipBody.innerHTML = '';
    for (let i = 0; i < 2; i++) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><input type="text" placeholder="Device" /></td>
        <td><input type="text" placeholder="Serial" /></td>
        <td><input type="date" /></td>`;
      equipBody.appendChild(tr);
    }

    if (window.__clearSignature) window.__clearSignature();
    updateSpan();
    updateCertNo();
  }


  // ---------- PWA install prompt ----------
  let deferredPrompt = null;

  function setupInstall() {
    const btn = $('installBtn');
    if (!btn) return;

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btn.hidden = false;
    });

    btn.addEventListener('click', async () => {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      btn.hidden = true;
    });

    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      btn.hidden = true;
    });

    // Hide if already running as installed app
    if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
      btn.hidden = true;
    }
  }

  // ---------- Init ----------
  function init() {
    const today = new Date().toISOString().slice(0, 10);
    if ($('calDate')) $('calDate').value = '';
    if ($('signDate')) $('signDate').value = today;

    // Listeners first
    $('lrv').addEventListener('input', updateSpan);
    if ($('instrumentId')) {
      $('instrumentId').addEventListener('input', updateCertNo);
      $('instrumentId').addEventListener('change', updateCertNo);
    }
    if ($('calDate')) {
      $('calDate').addEventListener('input', () => { updateCertNo(); validateDates(); });
      $('calDate').addEventListener('change', () => { updateCertNo(); validateDates(); });
    }
    if ($('signDate')) {
      $('signDate').addEventListener('input', validateDates);
      $('signDate').addEventListener('change', validateDates);
    }
    // Equipment due dates (delegated)
    if ($('equipBody')) {
      $('equipBody').addEventListener('change', e => {
        if (e.target && e.target.type === 'date') validateDates();
      });
      $('equipBody').addEventListener('input', e => {
        if (e.target && e.target.type === 'date') validateDates();
      });
    }
    $('urv').addEventListener('input', updateSpan);
    $('unitSelect').addEventListener('change', updateSpan);
    if ($('sqrtExtraction')) $('sqrtExtraction').addEventListener('change', () => { recalcAll(); updateSpan(); });
    if ($('maxErrorLimit')) {
      $('maxErrorLimit').addEventListener('input', () => {
        document.querySelectorAll('#asFoundBody tr, #asLeftBody tr').forEach(recalcRow);
      });
    }

    $('addAfRow').addEventListener('click', () => {
      const body = $('asFoundBody');
      const next = body.children.length + 1;
      const row = createRow('af', { point: next, value: '', measured: '' });
      body.appendChild(row);
      recalcRow(row);
      updateChart();
    });

    $('addAlRow').addEventListener('click', () => {
      const body = $('asLeftBody');
      const next = body.children.length + 1;
      const row = createRow('al', { point: next, value: '', measured: '' });
      body.appendChild(row);
      recalcRow(row);
      updateChart();
    });

    $('addEquip').addEventListener('click', () => addEquipRow());
    $('exportPdf').addEventListener('click', exportPDF);
    if ($('exportExcel')) $('exportExcel').addEventListener('click', exportExcel);
  if ($('uploadDb')) $('uploadDb').addEventListener('click', uploadToDatabase);

    $('resetAll').addEventListener('click', () => {
      if (confirm('Clear all fields and reset the form?')) {
        clearAllFields();
      }
    });

    try {
      populateTables();
    } catch (e) {
      console.error('Error populating tables / chart:', e);
      const afBody = $('asFoundBody');
      const alBody = $('asLeftBody');
      if (afBody && afBody.children.length === 0) {
        DEFAULT_AF.forEach(d => afBody.appendChild(createRow('af', d)));
        DEFAULT_AL.forEach(d => alBody.appendChild(createRow('al', d)));
        document.querySelectorAll('#asFoundBody tr, #asLeftBody tr').forEach(recalcRow);
      }
    }

    updateSpan();
    updateCertNo();
    initSignature();
    setupInstall();

    // Reduce accidental pull-to-refresh while scrolling the form
    document.body.style.overscrollBehaviorY = 'none';
    document.documentElement.style.overscrollBehaviorY = 'none';

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
