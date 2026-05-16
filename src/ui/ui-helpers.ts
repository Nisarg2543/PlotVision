/** Shared lightweight DOM builder helpers for dock step panels. */

export function makeSec(title: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ds';
  if (title) {
    const h = document.createElement('div');
    h.className = 'ds-title';
    h.textContent = title;
    el.appendChild(h);
  }
  return el;
}

export function makeDiv(cls: string): HTMLElement {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  return el;
}

export function makeSpan(text: string, style?: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  if (style) el.style.cssText = style;
  return el;
}

export function makeRow(justify: 'between' | 'start' = 'start'): HTMLElement {
  const el = makeDiv('');
  el.style.cssText = `display:flex;align-items:center;justify-content:${justify === 'between' ? 'space-between' : 'flex-start'};gap:6px;flex-wrap:wrap;`;
  return el;
}

export function makeLbl(text: string): HTMLElement {
  const el = document.createElement('label');
  el.className = 'pv-label';
  el.textContent = text;
  return el;
}

export function makeBtn(text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = text;
  return b;
}

export function makeBtnSvg(svg: string, text: string, cls: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = `${svg}<span>${text}</span>`;
  return b;
}

export function makeSelect(options: [string, string][], cur: string): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'pv-select';
  options.forEach(([val, label]) => {
    const o = document.createElement('option');
    o.value = val; o.textContent = label;
    if (val === cur) o.selected = true;
    sel.appendChild(o);
  });
  return sel;
}

export function makeIconBtn(inner: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-btn';
  b.innerHTML = inner;
  b.title = title;
  return b;
}

export function makeCheckbox(
  label: string, checked: boolean, onChange?: (e: Event) => void
): HTMLElement {
  const wrap = makeDiv('pv-check');
  const chk = document.createElement('input');
  chk.type = 'checkbox'; chk.checked = checked;
  if (onChange) chk.addEventListener('change', onChange);
  const lbl = makeSpan(label);
  lbl.addEventListener('click', () => { chk.checked = !chk.checked; chk.dispatchEvent(new Event('change')); });
  wrap.appendChild(chk); wrap.appendChild(lbl);
  return wrap;
}

export function makeFilterSlider(
  label: string, value: number, min: number, max: number,
  onChange: (v: number) => void
): HTMLElement {
  const wrap = makeDiv('filter-row');
  const labelRow = makeDiv('filter-label-row');
  const lbl = makeSpan(label);
  const val = makeSpan(String(value));
  val.className = 'filter-val';
  labelRow.appendChild(lbl); labelRow.appendChild(val);
  const slider = document.createElement('input');
  slider.type = 'range'; slider.min = String(min); slider.max = String(max);
  slider.value = String(value);
  slider.addEventListener('input', () => {
    const v = parseInt(slider.value, 10);
    val.textContent = String(v);
    onChange(v);
  });
  wrap.appendChild(labelRow); wrap.appendChild(slider);
  return wrap;
}

export function makeHint(text: string): HTMLElement {
  const el = makeDiv('text-muted');
  el.style.lineHeight = '1.6';
  el.textContent = text;
  return el;
}
