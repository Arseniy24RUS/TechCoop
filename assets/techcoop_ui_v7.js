const DATA = window.TECHCOOP_UI_V7 || {};
const $ = id => document.getElementById(id);

const ROLE_ORDER = DATA.meta?.role_order || ['qualified_customer', 'developer', 'integrator', 'science_cadre_center'];
const ROLE_LABELS = DATA.meta?.role_labels || {
  qualified_customer: 'Заказчик',
  developer: 'Разработчик',
  integrator: 'Интегратор',
  science_cadre_center: 'Наука и кадры'
};
const ROLE_COLUMNS = DATA.meta?.role_columns || {
  qualified_customer: 'Заказчики',
  developer: 'Разработчики',
  integrator: 'Интеграторы',
  science_cadre_center: 'Наука и кадры'
};
const STATIC_BASE = '../data/v7_static/';
const EVIDENCE_TABS = [
  ['gisp', 'ГИСП'],
  ['software', 'ПО'],
  ['patents', 'Патенты/РИД'],
  ['vacancies', 'Вакансии'],
  ['procurement', 'Закупки'],
  ['finance', 'Финансы'],
  ['roles', 'Роли']
];

const state = {
  view: 'map',
  direction: DATA.meta?.default_direction || 'AI_DATA',
  region: DATA.meta?.default_region || 'moscow city',
  role: 'all',
  strongOnly: true,
  selectedRoute: null,
  selectedCompany: null,
  activeEvidenceTab: 'gisp',
  searchSeq: 0,
  passportSeq: 0,
  roleDrawer: { role: null, page: 0, offset: 0 },
  companyMap: null
};

const staticCache = {
  manifest: null,
  json: new Map(),
  companyShards: new Map(),
  profileShards: new Map(),
  roleInnShards: new Map(),
  evidenceShards: new Map(),
  roleGroupIndex: null
};

const compByInn = new Map((DATA.companies || []).map(c => [String(c.inn), c]));
const dirById = new Map((DATA.directions || []).map(d => [d.id, d]));
const roleColors = {
  qualified_customer: '#ff5c8a',
  developer: '#37d7ee',
  integrator: '#5aa6ff',
  science_cadre_center: '#a979ff'
};

const regionName = id => (DATA.regions || []).find(r => r.id === id)?.name || id || 'регион';
const esc = s => String(s ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
const fmt = (n, d = 0) => (n == null || Number.isNaN(Number(n))) ? '—' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
const money = n => {
  n = Number(n || 0);
  if (Math.abs(n) >= 1e6) return fmt(n / 1e6, 1) + ' трлн ₽';
  if (Math.abs(n) >= 1e3) return fmt(n / 1e3, 1) + ' млрд ₽';
  return fmt(n, 0) + ' млн ₽';
};

function debounce(fn, delay = 220) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function roleBadge(role) {
  return `<span class="role-badge ${role}">${ROLE_LABELS[role] || role}</span>`;
}

function roleDot(role) {
  const color = roleColors[role] || '#fff';
  return `<span class="dot" style="background:${color}"></span>`;
}

function mapKey() {
  return `${state.direction}|${state.region}`;
}

function getMap() {
  let map = DATA.maps?.[mapKey()];
  if (!map) {
    const regions = DATA.regions_by_direction?.[state.direction] || [];
    state.region = regions.includes(DATA.meta?.default_region) ? DATA.meta.default_region : (regions[0] || state.region);
    map = DATA.maps?.[mapKey()] || DATA.maps?.[Object.keys(DATA.maps || {})[0]];
  }
  return map || { stats: { organizations: 0, links: 0, strong_tracks: 0 }, roles: {}, routes: [], links: [] };
}

function initialView() {
  const fromBody = document.body?.dataset.initialView;
  const path = location.pathname.toLowerCase();
  const hash = location.hash.toLowerCase();
  if (hash.includes('passport') || path.includes('passport')) return 'passport';
  if (hash.includes('map') || path.includes('map')) return 'map';
  return fromBody === 'passport' ? 'passport' : 'map';
}

async function init() {
  state.view = initialView();
  renderDirectionOptions();
  renderRegionOptions();
  bindFilters();
  bindActions();
  bindNavigation();
  bindSearch();
  bindDrawer();

  const defaultCompany = (DATA.companies || []).find(c => (c.name || '').includes('МТС')) || (DATA.companies || [])[0];
  state.selectedCompany = new URLSearchParams(location.search).get('inn') || defaultCompany?.inn || null;

  renderMap();
  renderPassport();
  showView(state.view, false);
  loadManifest().then(() => refreshStaticCounters()).catch(() => {});

  if ('ResizeObserver' in window && $('flowPanel')) {
    const ro = new ResizeObserver(scheduleDrawFlow);
    ro.observe($('flowPanel'));
  }
}

function bindFilters() {
  $('directionFilter').onchange = e => {
    state.direction = e.target.value;
    const regions = DATA.regions_by_direction?.[state.direction] || [];
    if (!regions.includes(state.region)) {
      state.region = regions.includes(DATA.meta?.default_region) ? DATA.meta.default_region : (regions[0] || state.region);
    }
    state.selectedRoute = null;
    renderRegionOptions();
    renderMap();
  };
  $('regionFilter').onchange = e => {
    state.region = e.target.value;
    state.selectedRoute = null;
    renderMap();
  };
  $('roleFilter').onchange = e => {
    state.role = e.target.value;
    renderMap();
  };
  $('strongOnly').onchange = e => {
    state.strongOnly = e.target.checked;
    renderMap();
  };
  $('resetFilters').onclick = () => {
    state.direction = DATA.meta?.default_direction || 'AI_DATA';
    state.region = DATA.meta?.default_region || 'moscow city';
    state.role = 'all';
    state.strongOnly = true;
    state.selectedRoute = null;
    renderDirectionOptions();
    renderRegionOptions();
    $('roleFilter').value = 'all';
    $('strongOnly').checked = true;
    renderMap();
  };
}

function bindNavigation() {
  document.querySelectorAll('.nav button').forEach(button => {
    button.onclick = () => showView(button.dataset.view, true);
  });
}

function bindSearch() {
  const search = debounce(handlePassportSearch);
  const global = debounce(handleGlobalSearch);
  if ($('searchCompany')) {
    $('searchCompany').oninput = search;
    $('searchCompany').onfocus = search;
  }
  if ($('globalSearch')) {
    $('globalSearch').oninput = global;
    $('globalSearch').onfocus = global;
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && $('suggestions')) $('suggestions').style.display = 'none';
  });
}

function bindDrawer() {
  document.querySelectorAll('[data-close-drawer]').forEach(el => {
    el.addEventListener('click', closeRoleDrawer);
  });
}

function renderDirectionOptions() {
  $('directionFilter').innerHTML = (DATA.directions || [])
    .map(d => `<option value="${esc(d.id)}" ${d.id === state.direction ? 'selected' : ''}>${esc(d.short_name || d.name || d.id)}</option>`)
    .join('');
}

function renderRegionOptions() {
  const regions = DATA.regions_by_direction?.[state.direction] || [];
  $('regionFilter').innerHTML = regions
    .map(region => `<option value="${esc(region)}" ${region === state.region ? 'selected' : ''}>${esc(regionName(region))}</option>`)
    .join('');
}

function showView(view, updateHash = true) {
  state.view = view === 'passport' ? 'passport' : 'map';
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(state.view === 'passport' ? 'passportScreen' : 'mapScreen').classList.add('active');
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
  if (updateHash) history.replaceState(null, '', state.view === 'passport' ? '#passport' : '#map');
  if (state.view === 'map') scheduleDrawFlow();
  else renderPassport();
}

function refreshStaticCounters() {
  const manifest = staticCache.manifest;
  if (!manifest || !$('mapSubtitle')) return;
  const base = fmt(manifest.counts?.base_companies || 0);
  const roles = fmt(manifest.counts?.role_scored_companies || 0);
  $('mapSubtitle').textContent = `Статическая витрина: ${base} организаций в поиске, ${roles} компаний с рассчитанными ролями`;
}

function renderMap() {
  const map = getMap();
  const direction = dirById.get(state.direction);
  if (!state.selectedRoute || !map.routes.find(r => r.id === state.selectedRoute)) {
    state.selectedRoute = map.routes[0]?.id || null;
  }

  $('mapSubtitle').textContent = `${direction?.short_name || state.direction}: ${regionName(state.region)} — кооперационные треки между организациями`;
  const stats = [
    ['∑', map.stats.organizations, 'организаций'],
    ['↔', map.stats.links, 'связок'],
    ['★', map.stats.strong_tracks || 0, 'сильных трека'],
    ['⌖', 1, 'регион']
  ];
  $('mapStats').innerHTML = stats.map(item => `<div class="stat card"><div class="icon">${item[0]}</div><div><div class="num">${fmt(item[1])}</div><div class="lab">${item[2]}</div></div></div>`).join('');

  renderColumns(map);
  renderRoutePanel(map);
  renderLegend();
  scheduleDrawFlow();
}

function renderColumns(map) {
  const route = map.routes.find(r => r.id === state.selectedRoute);
  const routeNodes = new Set(route?.nodes || []);
  $('columns').innerHTML = ROLE_ORDER.map(role => {
    const all = map.roles[role] || [];
    const visibleCount = state.strongOnly ? 4 : 7;
    let nodes = all.slice(0, visibleCount);
    if (state.role !== 'all' && state.role !== role) nodes = all.slice(0, 3);
    const dimmed = state.role !== 'all' && state.role !== role ? ' is-dimmed' : '';
    return `<section class="role-col${dimmed}" data-role="${role}">
      <div class="role-title ${role}">${ROLE_COLUMNS[role]}</div>
      ${nodes.map(node => nodeCard(node, routeNodes)).join('')}
      <button class="show-more" data-show-role="${esc(role)}">Показать всех</button>
    </section>`;
  }).join('');

  document.querySelectorAll('.node-card').forEach(el => {
    el.onclick = () => openPassport(el.dataset.inn);
  });
  document.querySelectorAll('[data-show-role]').forEach(el => {
    el.onclick = () => openRoleDrawer(el.dataset.showRole);
  });
}

function nodeCard(node, routeNodes) {
  const active = routeNodes.has(node.id) ? ' is-route' : '';
  return `<article class="node-card ${node.role}${active}" data-node="${esc(node.id)}" data-inn="${esc(node.inn)}">
    <div class="score">${fmt(node.score, 0)}%</div>
    <div class="name">${esc(node.name)}</div>
    <div class="region">${esc(node.region_name)}</div>
    <span class="role-pill">${esc(node.role_label)}</span>
  </article>`;
}

function scheduleDrawFlow() {
  requestAnimationFrame(() => requestAnimationFrame(drawFlow));
}

function edgeColor(link) {
  return roleColors[link.source_role] || '#37d7ee';
}

function edgeWidth(score, active) {
  const base = 4 + Math.max(0, Math.min(40, Number(score || 0) - 55)) / 2.8;
  return active ? Math.min(20, base + 4) : Math.min(16, base);
}

function cubicPoint(x1, y1, x2, y2, c1x, c1y, c2x, c2y, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * x1 + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * x2,
    y: mt * mt * mt * y1 + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * y2
  };
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function drawFlow() {
  const panel = $('flowPanel');
  const svg = $('edgeLayer');
  if (!panel || !svg || state.view !== 'map') return;

  const map = getMap();
  const rect = panel.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  svg.innerHTML = '';
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  svg.setAttribute('width', rect.width);
  svg.setAttribute('height', rect.height);

  const route = map.routes.find(r => r.id === state.selectedRoute);
  const selectedLinks = new Set(route?.links || []);
  const nodeEls = new Map([...document.querySelectorAll('.node-card')].map(el => [el.dataset.node, el]));
  const defs = svgEl('defs');
  svg.appendChild(defs);

  const visibleLinks = (map.links || [])
    .filter(link => nodeEls.has(link.source) && nodeEls.has(link.target))
    .filter(link => !state.strongOnly || Number(link.score || 0) >= 70 || selectedLinks.has(link.id));

  visibleLinks.forEach((link, index) => {
    const source = nodeEls.get(link.source);
    const target = nodeEls.get(link.target);
    const sr = source.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const x1 = sr.right - rect.left;
    const y1 = sr.top + sr.height / 2 - rect.top;
    const x2 = tr.left - rect.left;
    const y2 = tr.top + tr.height / 2 - rect.top;
    const span = Math.max(80, x2 - x1);
    const lift = Math.max(-42, Math.min(42, (y2 - y1) * .18));
    const c1x = x1 + span * .42;
    const c2x = x2 - span * .42;
    const c1y = y1 + lift;
    const c2y = y2 - lift;
    const path = `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
    const active = selectedLinks.has(link.id);
    const color = edgeColor(link);
    const gradientId = `edgeGradient${index}`;
    const gradient = svgEl('linearGradient', { id: gradientId, x1, y1, x2, y2, gradientUnits: 'userSpaceOnUse' });
    gradient.appendChild(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': active ? '.96' : '.55' }));
    gradient.appendChild(svgEl('stop', { offset: '100%', 'stop-color': roleColors[link.target_role] || '#a979ff', 'stop-opacity': active ? '.96' : '.5' }));
    defs.appendChild(gradient);

    svg.appendChild(svgEl('path', { d: path, class: 'edge-track', 'stroke-width': edgeWidth(link.score, active) + 7 }));
    const ribbon = svgEl('path', {
      d: path,
      class: `edge-ribbon${active ? ' is-active' : (route ? ' is-muted' : '')}`,
      stroke: `url(#${gradientId})`,
      'stroke-width': edgeWidth(link.score, active)
    });
    ribbon.style.color = color;
    ribbon.addEventListener('click', () => selectRouteByLink(map, link.id));
    svg.appendChild(ribbon);

    const hit = svgEl('path', { d: path, class: 'edge-hit' });
    hit.addEventListener('click', () => selectRouteByLink(map, link.id));
    svg.appendChild(hit);

    const point = cubicPoint(x1, y1, x2, y2, c1x, c1y, c2x, c2y, .5);
    const labelGroup = svgEl('g');
    const text = svgEl('text', { x: point.x.toFixed(1), y: point.y.toFixed(1), class: 'edge-label' });
    text.textContent = `${fmt(link.score, 0)}%`;
    labelGroup.appendChild(svgEl('rect', {
      x: (point.x - 18).toFixed(1),
      y: (point.y - 10).toFixed(1),
      width: 36,
      height: 20,
      rx: 8,
      class: 'edge-label-bg'
    }));
    labelGroup.appendChild(text);
    svg.appendChild(labelGroup);
  });
}

function selectRouteByLink(map, linkId) {
  const route = map.routes.find(item => item.links.includes(linkId));
  if (!route) return;
  state.selectedRoute = route.id;
  renderColumns(map);
  renderRoutePanel(map);
  scheduleDrawFlow();
}

function renderRoutePanel(map) {
  const route = map.routes.find(r => r.id === state.selectedRoute) || map.routes[0];
  if (!route) {
    $('routePanel').innerHTML = '<div class="empty">Для текущей выборки нет построенных маршрутов.</div>';
    return;
  }
  state.selectedRoute = route.id;
  const nodeMap = new Map(Object.values(map.roles || {}).flat().map(node => [node.id, node]));
  const routeNodes = route.nodes.map(id => nodeMap.get(id)).filter(Boolean);
  const level = route.score >= 80 ? 'Высокая совместимость' : route.score >= 60 ? 'Хорошая совместимость' : 'Средняя совместимость';
  $('routePanel').innerHTML = `<h3>Выбрана связка</h3>
    <div class="breadcrumb">
      ${routeNodes.map(node => `<div class="crumb">${roleDot(node.role)}<div><b>${esc(node.name)}</b><span>${esc(node.role_label)} · ${esc(node.region_name)}</span></div></div>`).join('')}
    </div>
    <div class="compat"><div class="big">${fmt(route.score, 0)}%</div><span class="badge">${level}</span></div>
    <h3>Почему эта связка?</h3>
    ${(route.reasons || []).map(reason => `<div class="reason"><span class="check">✓</span><div>${esc(reason)}</div></div>`).join('')}
    <div class="route-actions"><button class="btn primary" onclick="openRoutePassport()">Смотреть детали трека →</button></div>`;
}

function openRoutePassport() {
  const map = getMap();
  const route = map.routes.find(r => r.id === state.selectedRoute);
  if (!route) return;
  const inn = (route.nodes[1] || route.nodes[0] || '').split(':')[1];
  if (inn) openPassport(inn);
}

function renderLegend() {
  $('legend').innerHTML = `<div>
      <h4>Роли</h4>
      ${ROLE_ORDER.map(role => `<div class="legend-item">${roleDot(role)} ${ROLE_LABELS[role]}</div>`).join('')}
    </div>
    <div>
      <h4>Сила связи</h4>
      <div class="legend-item"><span class="line-sample" style="width:58px;height:9px"></span> 80-100% очень сильная</div>
      <div class="legend-item"><span class="line-sample" style="width:44px;height:6px"></span> 60-79% сильная</div>
      <div class="legend-item"><span class="line-sample" style="width:30px;height:3px"></span> 40-59% средняя</div>
    </div>
    <div>
      <h4>Совместимость</h4>
      <div class="legend-item"><span class="badge">80% и выше</span> высокая</div>
      <div class="legend-item"><span class="badge" style="background:rgba(242,201,76,.16);color:var(--gold)">60-79%</span> хорошая</div>
      <div class="legend-item"><span class="badge" style="background:rgba(255,107,107,.16);color:var(--red)">ниже 40%</span> низкая</div>
    </div>
    <div>
      <h4>Как это работает</h4>
      <div class="hint">Система сопоставляет роли, технологическое направление, регион, evidence score и финансовые признаки, чтобы найти кооперационные треки для технологических проектов.</div>
    </div>`;
}

async function loadJson(path) {
  if (staticCache.json.has(path)) return staticCache.json.get(path);
  const response = await fetch(STATIC_BASE + path);
  if (!response.ok) throw new Error(`Cannot load ${path}: ${response.status}`);
  const data = await response.json();
  staticCache.json.set(path, data);
  return data;
}

async function loadManifest() {
  if (staticCache.manifest) return staticCache.manifest;
  staticCache.manifest = await loadJson('manifest.json');
  return staticCache.manifest;
}

function prefix(value) {
  const digits = String(value || '').replace(/\D+/g, '');
  return (digits.slice(0, 3) || 'unknown').padEnd(3, '0');
}

function slugKey(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

async function loadCompanyByInn(inn) {
  inn = String(inn || '').replace(/\D+/g, '');
  if (!inn) return null;
  const shard = prefix(inn);
  if (!staticCache.companyShards.has(shard)) {
    try {
      staticCache.companyShards.set(shard, await loadJson(`companies/${shard}.json`));
    } catch (e) {
      staticCache.companyShards.set(shard, []);
    }
  }
  const row = staticCache.companyShards.get(shard).find(item => String(item[0]) === inn);
  return row ? companyFromRow(row) : null;
}

function companyFromRow(row) {
  return {
    inn: String(row[0]),
    ogrn: row[1] ? String(row[1]) : null,
    region: row[2] || null,
    region_name: row[2] ? regionName(row[2]) : null,
    okved: row[3] || null,
    okved_section: row[4] || null,
    revenue_mrub: row[5],
    assets_mrub: row[6],
    profit_mrub: row[7],
    lon: row[8],
    lat: row[9],
    geocoding_quality: row[10],
    has_roles: Boolean(row[11]),
    has_enterprise: Boolean(row[12])
  };
}

async function loadProfileByInn(inn) {
  inn = String(inn || '').replace(/\D+/g, '');
  if (!inn) return null;
  const shard = prefix(inn);
  if (!staticCache.profileShards.has(shard)) {
    try {
      staticCache.profileShards.set(shard, await loadJson(`profiles/${shard}.json`));
    } catch (e) {
      staticCache.profileShards.set(shard, {});
    }
  }
  return staticCache.profileShards.get(shard)[inn] || null;
}

async function loadRolesByInn(inn) {
  inn = String(inn || '').replace(/\D+/g, '');
  if (!inn) return [];
  const shard = prefix(inn);
  if (!staticCache.roleInnShards.has(shard)) {
    try {
      staticCache.roleInnShards.set(shard, await loadJson(`roles/by_inn/${shard}.json`));
    } catch (e) {
      staticCache.roleInnShards.set(shard, {});
    }
  }
  return staticCache.roleInnShards.get(shard)[inn] || [];
}

async function loadEvidenceByInn(inn) {
  inn = String(inn || '').replace(/\D+/g, '');
  const out = { gisp: [], software: [], patents: [], vacancies: [], procurement: [] };
  if (!inn) return out;
  const shard = prefix(inn);
  await Promise.all(Object.keys(out).map(async source => {
    const key = `${source}/${shard}`;
    if (!staticCache.evidenceShards.has(key)) {
      try {
        staticCache.evidenceShards.set(key, await loadJson(`evidence/${source}/${shard}.json`));
      } catch (e) {
        staticCache.evidenceShards.set(key, {});
      }
    }
    out[source] = staticCache.evidenceShards.get(key)[inn] || [];
  }));
  return out;
}

async function composeCompany(inn) {
  const id = String(inn || '').replace(/\D+/g, '');
  const old = compByInn.get(id) || null;
  const [base, profile, rolesByInn, evidence] = await Promise.all([
    loadCompanyByInn(id),
    loadProfileByInn(id),
    loadRolesByInn(id),
    loadEvidenceByInn(id)
  ]);
  if (!base && !profile && !old) return null;

  const roleRows = (rolesByInn || []).map(row => ({
    direction: row[0],
    role: row[1],
    region: row[2],
    score: row[3],
    revenue_mrub: row[4]
  }));
  const roles = unique([
    ...(profile?.roles || []),
    ...roleRows.map(row => row.role),
    ...(old?.roles || [])
  ]);
  const directions = unique([
    ...(profile?.directions || []),
    ...roleRows.map(row => row.direction),
    ...(old?.directions || [])
  ]);
  const finance = profile?.finance || {};
  const displayName = profile?.display_name || profile?.company_short_name || profile?.company_name || old?.name || null;
  const evidenceCounts = {
    gisp: evidence.gisp.length || profile?.counts?.gisp || old?.counts?.gisp || 0,
    software: evidence.software.length || profile?.counts?.software || old?.counts?.software || 0,
    patents: evidence.patents.length || profile?.counts?.patents || old?.counts?.patents || 0,
    vacancies: evidence.vacancies.length || profile?.counts?.vacancies || old?.counts?.vacancies || 0,
    procurement: evidence.procurement.length || profile?.counts?.procurement || old?.counts?.procurement || 0
  };

  return {
    inn: id || old?.inn || profile?.inn,
    ogrn: profile?.ogrn || base?.ogrn || old?.ogrn || null,
    name: displayName,
    display_name: displayName || 'Профиль расчётной базы',
    has_resolved_name: Boolean(displayName),
    company_name: profile?.company_name || null,
    company_short_name: profile?.company_short_name || null,
    legal_address: profile?.legal_address || null,
    status: profile?.status || old?.status || null,
    management: profile?.management || null,
    management_post: profile?.management_post || null,
    region: base?.region || profile?.regions?.[0] || old?.region || null,
    region_name: base?.region_name || regionName(profile?.regions?.[0] || old?.region),
    okved: base?.okved || profile?.okved_main || old?.okved || null,
    okved_name: profile?.okved_name || null,
    revenue_mrub: finance.revenue_mrub ?? base?.revenue_mrub ?? old?.revenue_mrub,
    assets_mrub: finance.assets_mrub ?? base?.assets_mrub ?? old?.assets_mrub,
    profit_mrub: finance.profit_mrub ?? base?.profit_mrub ?? old?.profit_mrub,
    est_spend_mrub: finance.est_spend_mrub ?? old?.est_spend_mrub,
    rnd_intangible_mrub: finance.rnd_intangible_mrub,
    tier: finance.tier,
    lat: base?.lat ?? old?.lat,
    lon: base?.lon ?? old?.lon,
    geocoding_quality: base?.geocoding_quality || old?.geocoding_quality || null,
    roles,
    directions,
    direction_names: profile?.direction_names || old?.direction_names || [],
    role_rows: roleRows,
    max_role_score: maxNumber(roleRows.map(row => row.score), profile?.scores?.max_role, old?.max_role_score),
    evidence_score: profile?.scores?.evidence ?? old?.evidence_score ?? 0,
    evidence_level: profile?.scores?.level || null,
    component_scores: profile?.scores || {},
    counts: evidenceCounts,
    examples: profile?.examples || old?.examples || {},
    flags: profile?.flags || {},
    evidence_details: evidence,
    base_only: !displayName
  };
}

function maxNumber(values, ...fallbacks) {
  const nums = [...values, ...fallbacks].map(Number).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"'.(),]/g, ' ').replace(/\s+/g, ' ').trim();
}

async function searchCompanies(query, limit = 18) {
  query = String(query || '').trim();
  if (query.length < 2) return [];
  await loadManifest().catch(() => null);

  const results = new Map();
  const add = async (inn, reason) => {
    const company = await composeCompany(inn);
    if (company && !results.has(company.inn)) {
      results.set(company.inn, { company, reason });
    }
  };

  const digits = query.replace(/\D+/g, '');
  if (digits.length >= 6 && digits.length <= 12) {
    await add(digits, 'ИНН');
  }
  if (digits.length >= 8) {
    const ogrnMatches = await searchByOgrn(digits, limit);
    for (const item of ogrnMatches) await add(item.inn, 'ОГРН');
  }

  const nameMatches = await searchByName(query, limit);
  for (const item of nameMatches) await add(item.inn, 'Название');

  const regionMatches = await searchByLookup('region', query, limit);
  for (const item of regionMatches) await add(item.inn, item.reason);

  const okvedMatches = await searchByLookup('okved', query, limit);
  for (const item of okvedMatches) await add(item.inn, item.reason);

  return [...results.values()].slice(0, limit);
}

async function searchByName(query, limit) {
  const normalized = normalizeSearch(query);
  if (normalized.length < 2) return [];
  let index = [];
  try {
    index = await loadJson('search/name_index.json');
  } catch (e) {
    return [];
  }
  return index
    .filter(row => row[0]?.includes(normalized) || row[1]?.toLowerCase().includes(normalized))
    .sort((a, b) => Number(b[5] || 0) - Number(a[5] || 0))
    .slice(0, limit)
    .map(row => ({ inn: row[2] }));
}

async function searchByOgrn(digits, limit) {
  const shard = prefix(digits);
  let rows = [];
  try {
    rows = await loadJson(`search/ogrn/${shard}.json`);
  } catch (e) {
    return [];
  }
  return rows
    .filter(row => String(row[0]).startsWith(digits))
    .slice(0, limit)
    .map(row => ({ inn: row[1] }));
}

async function searchByLookup(kind, query, limit) {
  const manifest = await loadManifest().catch(() => null);
  if (!manifest) return [];
  const normalized = normalizeSearch(query);
  let key = null;
  let reason = null;

  if (kind === 'region') {
    const regions = manifest.meta?.regions || [];
    const found = regions.find(region => normalizeSearch(`${region.id} ${region.name} ${regionName(region.id)}`).includes(normalized));
    if (!found) return [];
    key = found.id;
    reason = `Регион: ${regionName(found.id)}`;
  } else {
    const digits = query.match(/\d{2}/)?.[0];
    if (!digits) return [];
    key = digits;
    reason = `ОКВЭД ${digits}`;
  }

  let index = {};
  try {
    index = await loadJson(`lookup/${kind}/index.json`);
  } catch (e) {
    return [];
  }
  const entry = index[key] || index[String(key)];
  if (!entry?.pages?.length) return [];
  const page = await loadJson(entry.pages[0]);
  return page.slice(0, limit).map(row => ({ inn: row[0], reason }));
}

async function handleGlobalSearch() {
  const input = $('globalSearch');
  const target = $('globalSearchResults');
  if (!input || !target) return;
  const seq = ++state.searchSeq;
  const query = input.value.trim();
  if (query.length < 2) {
    target.innerHTML = '<div class="hint">Введите название, ИНН, ОГРН, регион или ОКВЭД.</div>';
    return;
  }
  target.innerHTML = '<div class="hint">Ищу по статическим данным...</div>';
  const results = await searchCompanies(query, 16).catch(() => []);
  if (seq !== state.searchSeq) return;
  renderSearchResults(target, results);
}

function renderSearchResults(target, results) {
  if (!results.length) {
    target.innerHTML = '<div class="neutral-note">Совпадений не найдено. Для компаний без resolved identity используйте точный ИНН или ОГРН.</div>';
    return;
  }
  target.innerHTML = results.map(({ company, reason }) => searchResultHtml(company, reason)).join('');
  target.querySelectorAll('[data-open-inn]').forEach(el => {
    el.onclick = () => openPassport(el.dataset.openInn);
  });
}

function searchResultHtml(company, reason) {
  const name = company.display_name || 'Профиль расчётной базы';
  const nameNote = company.has_resolved_name ? '' : ' · название не найдено в identity-слое';
  return `<div class="search-result" data-open-inn="${esc(company.inn)}">
    <div>
      <div class="result-name">${esc(name)}</div>
      <div class="result-meta">ИНН ${esc(company.inn)} · ОГРН ${esc(company.ogrn || '—')} · ${esc(company.region_name || company.region || 'регион не указан')} · ОКВЭД ${esc(company.okved || '—')}${nameNote}</div>
    </div>
    <div class="result-badge">${esc(reason || (company.has_resolved_name ? 'identity' : 'base'))}</div>
  </div>`;
}

async function handlePassportSearch() {
  const query = $('searchCompany').value.trim();
  const suggestions = $('suggestions');
  if (query.length < 2) {
    suggestions.style.display = 'none';
    return;
  }
  const seq = ++state.searchSeq;
  const results = await searchCompanies(query, 12).catch(() => []);
  if (seq !== state.searchSeq) return;
  suggestions.innerHTML = results.map(({ company, reason }) => `<div class="suggestion" data-inn="${esc(company.inn)}">
    <b>${esc(company.display_name)}</b>
    <div class="sub">ИНН ${esc(company.inn)} · ${esc(company.region_name || '')} · ${esc(reason || '')}${company.has_resolved_name ? '' : ' · название не найдено'}</div>
  </div>`).join('');
  suggestions.style.display = results.length ? 'block' : 'none';
  suggestions.querySelectorAll('.suggestion').forEach(el => {
    el.onclick = () => {
      state.selectedCompany = el.dataset.inn;
      $('searchCompany').value = el.querySelector('b')?.textContent || el.dataset.inn;
      suggestions.style.display = 'none';
      renderPassport();
    };
  });
}

function openPassport(inn) {
  state.selectedCompany = String(inn);
  showView('passport');
}

async function renderPassport() {
  const token = ++state.passportSeq;
  const fallbackInn = state.selectedCompany || (DATA.companies || [])[0]?.inn;
  if (!fallbackInn) return;
  if ($('companyHead')) $('companyHead').innerHTML = '<div class="empty">Загружаю профиль компании...</div>';
  const company = await composeCompany(fallbackInn).catch(() => null);
  if (token !== state.passportSeq || !company) return;
  state.selectedCompany = company.inn;
  if ($('searchCompany')) $('searchCompany').value = company.has_resolved_name ? company.display_name : company.inn;
  renderCompanyHead(company);
  renderRoleExplanation(company);
  const partners = recommendedPartners(company);
  renderPartners(partners);
  renderMiniRoute(company, partners);
  renderIndicators(company);
  renderScenarios(company, partners);
  renderEvidenceDetails(company);
  renderCompanyLocation(company);
}

function renderCompanyHead(company) {
  const roles = (company.roles || []).map(roleBadge).join('') || '<span class="role-badge developer">роль не рассчитана</span>';
  const cards = [
    ['identity', 'Идентичность', company.component_scores?.identity || (company.has_resolved_name ? 100 : 0)],
    ['financial', 'Финансы', company.component_scores?.financial || (company.revenue_mrub ? 60 : 0)],
    ['labor', 'Кадры', company.component_scores?.labor || (company.counts.vacancies ? 60 : 0)],
    ['product', 'Продукт', company.component_scores?.product || ((company.counts.gisp || company.counts.software) ? 70 : 0)],
    ['ip', 'РИД', company.component_scores?.ip || (company.counts.patents ? 60 : 0)],
    ['procurement', 'Закупки', company.component_scores?.procurement || (company.counts.procurement ? 60 : 0)]
  ];
  const evidence = cards.map(item => `<div class="evidence-card ${Number(item[2] || 0) > 0 ? 'ok' : ''}"><span>${Number(item[2] || 0) > 0 ? '✓' : '·'}</span><b>${esc(item[1])}</b><span class="state">${fmt(item[2], 0)}</span></div>`).join('');
  const evidenceScore = Number(company.evidence_score || 0);
  const rolePotential = Math.round(Number(company.max_role_score || 0) / 6);
  const score = Math.max(0, Math.min(100, evidenceScore > 0 ? Math.round(evidenceScore) : rolePotential));
  const initial = (company.display_name || 'C').replace(/[«"\s]/g, '').slice(0, 1);
  const missingName = company.has_resolved_name ? '' : '<div class="neutral-note" style="margin-top:10px">Название не найдено в текущем публичном identity-слое. Профиль показан по реквизитам расчётной базы.</div>';
  $('companyHead').innerHTML = `<div class="logo-box">${esc(initial)}</div>
    <div>
      <div class="company-name">${esc(company.display_name)}</div>
      <div class="meta-line"><span>Регион: ${esc(company.region_name || '')}</span><span>ОКВЭД ${esc(company.okved || '—')}</span></div>
      <div class="meta-line" style="margin-top:12px"><span>ИНН ${esc(company.inn)}</span><span>ОГРН ${esc(company.ogrn || '—')}</span><span class="badge">${esc(company.status || 'статус не указан')}</span></div>
      ${company.legal_address ? `<div class="meta-line" style="margin-top:10px"><span>${esc(company.legal_address)}</span></div>` : ''}
      ${missingName}
    </div>
    <div class="score-block">
      <div class="hint">Роли в системе</div>
      <div class="role-badges">${roles}</div>
      <div class="hint">Индекс доказательности и кооперационного потенциала</div>
      <div><span class="score-number">${score}</span> / 100 <span class="badge">${esc(company.evidence_level || (score >= 75 ? 'Высокий' : 'Средний'))}</span></div>
      <div class="score-bar"><span style="width:${score}%"></span></div>
    </div>
    <div>
      <div class="hint" style="margin-bottom:8px">Evidence ladder</div>
      <div class="evidence-grid">${evidence}</div>
    </div>`;
}

function renderRoleExplanation(company) {
  const text = {
    qualified_customer: 'Размещает спрос или потенциально нуждается во внедрении технологических решений за счёт масштаба бизнеса, отрасли и финансовых признаков.',
    developer: 'Создаёт или может создавать собственные технологические продукты, ПО, оборудование или промышленные решения.',
    integrator: 'Может внедрять решения у заказчиков, связывать оборудование, ПО, процессы и сопровождение проекта.',
    science_cadre_center: 'Закрывает НИОКР, экспертизу, подготовку кадров или образовательный контур.'
  };
  $('roleExplain').innerHTML = `<h3>1. Роль в кооперации</h3>
    <p class="hint">Роли рассчитаны на основе официальных данных, отраслевых признаков, публичной активности и evidence-слоя.</p>
    ${(company.roles || []).map(role => `<div class="role-explain">${roleDot(role)} <b>${ROLE_LABELS[role]}</b>${text[role] || ''}</div>`).join('') || '<div class="neutral-note">Для компании пока нет рассчитанных ролей.</div>'}
    <div class="hint">Роль описывает вероятную функцию компании в технологической кооперации.</div>`;
}

function compatibleRoles(roles) {
  const source = new Set(roles || []);
  const out = new Set();
  if (source.has('qualified_customer')) ['developer', 'integrator', 'science_cadre_center'].forEach(r => out.add(r));
  if (source.has('developer')) ['qualified_customer', 'integrator', 'science_cadre_center'].forEach(r => out.add(r));
  if (source.has('integrator')) ['qualified_customer', 'developer', 'science_cadre_center'].forEach(r => out.add(r));
  if (source.has('science_cadre_center')) ['qualified_customer', 'developer', 'integrator'].forEach(r => out.add(r));
  if (out.size === 0) ROLE_ORDER.forEach(r => out.add(r));
  return [...out];
}

function recommendedPartners(company) {
  const directions = company.directions || [];
  const direction = directions.includes(state.direction) ? state.direction : (directions[0] || state.direction);
  const roles = compatibleRoles(company.roles);
  const rows = (DATA.role_rows || []).filter(row => row.inn !== company.inn && row.direction === direction && roles.includes(row.role));
  const scored = rows.map(row => {
    const partner = compByInn.get(String(row.inn));
    if (!partner) return null;
    const sameRegion = partner.region === company.region;
    const evidence = Number(partner.evidence_score || 0);
    const score = Math.min(96, Math.max(45, Math.round(.58 * row.score + .25 * evidence + (sameRegion ? 12 : 2))));
    return { company: partner, row, score, sameRegion };
  }).filter(Boolean).sort((a, b) => b.score - a.score);

  const seen = new Set();
  const result = [];
  for (const item of scored) {
    if (seen.has(item.company.inn)) continue;
    seen.add(item.company.inn);
    result.push(item);
    if (result.length >= 12) break;
  }
  return result;
}

function renderPartners(partners) {
  if (!partners.length) {
    $('partners').innerHTML = `<h3>2. Потенциальные партнёры</h3><div class="neutral-note">Для этой компании партнёры не рассчитаны в демонстрационном подграфе. Полные ролевые списки доступны на карте через «Показать всех».</div>`;
    return;
  }
  $('partners').innerHTML = `<h3>2. Потенциальные партнёры</h3>
    <div class="partner-list">${partners.slice(0, 8).map((item, index) => `<div class="partner" onclick="openPassport('${esc(item.company.inn)}')">
      <div>${index + 1}</div>
      <div>${roleDot(item.row.role)} <b>${esc(item.company.name)}</b><div class="sub">${esc(item.company.region_name || '')} · ${esc(ROLE_LABELS[item.row.role])} · ${item.sameRegion ? 'общий регион' : 'другой регион'}</div></div>
      <div class="pct">${item.score}%</div>
    </div>`).join('')}</div>`;
}

function renderMiniRoute(company, partners) {
  const p1 = partners[0]?.company;
  const p2 = partners[1]?.company;
  const p3 = partners[2]?.company;
  $('miniRoute').innerHTML = `<h3>3. Маршруты кооперации</h3>
    <div class="mini-route">
      <svg class="route-svg" viewBox="0 0 460 245">
        <path d="M95 80 C170 80 195 102 230 112" stroke="#ff5c8a" stroke-width="3" fill="none" stroke-dasharray="7 7"/>
        <path d="M365 80 C300 82 272 100 230 112" stroke="#37d7ee" stroke-width="3" fill="none" stroke-dasharray="7 7"/>
        <path d="M230 147 C230 172 230 188 230 204" stroke="#a979ff" stroke-width="3" fill="none" stroke-dasharray="7 7"/>
      </svg>
      <div class="route-box route-left">${esc(p1?.name || 'партнёр 1')}<br><span class="role-badge ${partners[0]?.row.role || 'developer'}">${esc(ROLE_LABELS[partners[0]?.row.role] || 'партнёр')}</span></div>
      <div class="route-box route-center">${esc(company.display_name)}<br>${(company.roles || []).slice(0, 2).map(roleBadge).join('')}</div>
      <div class="route-box route-right">${esc(p2?.name || 'партнёр 2')}<br><span class="role-badge ${partners[1]?.row.role || 'integrator'}">${esc(ROLE_LABELS[partners[1]?.row.role] || 'партнёр')}</span></div>
      <div class="route-box route-bottom">${esc(p3?.name || 'партнёр 3')}<br><span class="role-badge ${partners[2]?.row.role || 'science_cadre_center'}">${esc(ROLE_LABELS[partners[2]?.row.role] || 'партнёр')}</span></div>
    </div>`;
}

function renderIndicators(company) {
  $('indicators').innerHTML = `<h3>4. Ключевые показатели</h3>
    <div class="metrics">
      <div><h4>Финансовые</h4>${metricRow('Выручка', money(company.revenue_mrub))}${metricRow('Активы', money(company.assets_mrub))}${metricRow('Чистая прибыль', money(company.profit_mrub))}${metricRow('Оценочный спрос', money(company.est_spend_mrub))}</div>
      <div><h4>Evidence</h4>${metricRow('Продукция ГИСП', fmt(company.counts?.gisp || 0))}${metricRow('ПО в реестре', fmt(company.counts?.software || 0))}${metricRow('РИД / патенты', fmt(company.counts?.patents || 0))}${metricRow('Вакансии', fmt(company.counts?.vacancies || 0))}${metricRow('Закупки', fmt(company.counts?.procurement || 0))}</div>
    </div>
    <div class="hint" style="margin-top:12px">Отсутствие записей в отдельном источнике означает только отсутствие найденного публичного evidence в этом источнике.</div>`;
}

function metricRow(label, value) {
  return `<div class="metric-row"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

function renderScenarios(company, partners) {
  const p0 = partners[0]?.company?.name || 'потенциальным партнёром';
  const p1 = partners[1]?.company?.name || 'интегратором';
  const p2 = partners[2]?.company?.name || 'научно-кадровым центром';
  const revenue = Math.max(20, Math.min(250, Math.round(Number(company.revenue_mrub || 1000) * .001)));
  $('scenarios').innerHTML = `<h3>5. Сценарии кооперации</h3>
    <div class="scenario-cards">
      <div class="scenario"><h4>Пилотное внедрение</h4><p class="hint">С ${esc(p0)} для проверки технологического эффекта.</p><div class="money">${revenue}-${revenue * 2} млн ₽</div><span class="badge">Низкая сложность</span></div>
      <div class="scenario"><h4>Совместная разработка</h4><p class="hint">С ${esc(p1)} для сборки решения под отраслевой спрос.</p><div class="money">${Math.round(revenue * .7)}-${Math.round(revenue * 1.4)} млн ₽</div><span class="badge" style="background:rgba(242,201,76,.16);color:var(--gold)">Средняя сложность</span></div>
      <div class="scenario"><h4>НИОКР и кадры</h4><p class="hint">С ${esc(p2)} для подготовки компетенций и экспертизы.</p><div class="money">${Math.max(10, Math.round(revenue * .3))}-${Math.round(revenue)} млн ₽</div><span class="badge">Низкая сложность</span></div>
    </div>`;
}

function renderEvidenceDetails(company) {
  const container = $('companyEvidence');
  if (!container) return;
  const tabExists = EVIDENCE_TABS.some(([key]) => key === state.activeEvidenceTab);
  if (!tabExists) state.activeEvidenceTab = 'gisp';
  container.innerHTML = `<h3>6. Подтверждающие записи</h3>
    <div class="tabs">${EVIDENCE_TABS.map(([key, label]) => `<button class="tab-btn ${state.activeEvidenceTab === key ? 'active' : ''}" data-evidence-tab="${key}">${label}</button>`).join('')}</div>
    <div id="evidenceBody">${renderEvidenceBody(company, state.activeEvidenceTab)}</div>`;
  container.querySelectorAll('[data-evidence-tab]').forEach(button => {
    button.onclick = () => {
      state.activeEvidenceTab = button.dataset.evidenceTab;
      renderEvidenceDetails(company);
    };
  });
}

function renderEvidenceBody(company, tab) {
  if (tab === 'finance') {
    return `<div class="metrics">${metricRow('Выручка', money(company.revenue_mrub))}${metricRow('Активы', money(company.assets_mrub))}${metricRow('Прибыль', money(company.profit_mrub))}${metricRow('НМА / R&D', money(company.rnd_intangible_mrub))}</div>`;
  }
  if (tab === 'roles') {
    const rows = company.role_rows || [];
    if (!rows.length) return emptySource();
    return table(['Направление', 'Роль', 'Регион', 'Score', 'Выручка'], rows.slice(0, 80).map(row => [
      dirById.get(row.direction)?.short_name || row.direction,
      ROLE_LABELS[row.role] || row.role,
      regionName(row.region),
      fmt(row.score, 0),
      money(row.revenue_mrub)
    ]));
  }
  const rows = company.evidence_details?.[tab] || [];
  if (!rows.length) return emptySource();
  if (tab === 'gisp') {
    return table(['Продукт', 'Реестр', 'ОКПД2', 'Действует до', 'Источник'], rows.slice(0, 120).map(row => row));
  }
  if (tab === 'software') {
    return table(['ПО', 'Реестр', 'Класс', 'Дата', 'Гос. номер', 'Гос. дата', 'Источник'], rows.slice(0, 120).map(row => row));
  }
  if (tab === 'patents') {
    return table(['Название', 'Номер', 'Класс', 'Дата', 'URL', 'Источник'], rows.slice(0, 120).map(row => row));
  }
  if (tab === 'vacancies') {
    return table(['Вакансия', 'Работодатель', 'Регион', 'От', 'До', 'Дата', 'URL', 'Источник'], rows.slice(0, 120).map(row => row));
  }
  if (tab === 'procurement') {
    return table(['Предмет', 'Номер', 'Сумма', 'Заказчик', 'Дата', 'URL', 'Источник'], rows.slice(0, 120).map(row => row));
  }
  return emptySource();
}

function emptySource() {
  return '<div class="neutral-note">В этом источнике публичных записей не найдено.</div>';
}

function table(headers, rows) {
  return `<div class="evidence-table-wrap"><table class="evidence-table"><thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${formatCell(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function formatCell(value) {
  if (value == null || value === '') return '—';
  const text = String(value);
  if (/^https?:\/\//i.test(text)) return `<a class="source-link" href="${esc(text)}" target="_blank" rel="noopener">источник</a>`;
  if (!Number.isNaN(Number(value)) && Math.abs(Number(value)) > 1000000) return fmt(Number(value), 0);
  return esc(text);
}

function renderCompanyLocation(company) {
  const container = $('companyLocation');
  if (!container) return;
  if (state.companyMap) {
    state.companyMap.remove();
    state.companyMap = null;
  }
  const address = company.legal_address || `${company.region_name || company.region || ''} ${company.display_name || ''}`.trim();
  const searchUrl = `https://www.openstreetmap.org/search?query=${encodeURIComponent(address || company.inn)}`;
  const hasCoords = Number.isFinite(Number(company.lat)) && Number.isFinite(Number(company.lon));
  const precise = ['house', 'street'].includes(company.geocoding_quality);
  const approximate = company.geocoding_quality === 'city';
  container.innerHTML = `<h3>7. Адрес и карта</h3>
    <div class="hint">${address ? esc(address) : 'Юридический адрес не найден в текущем identity-слое.'}</div>
    ${hasCoords ? `<div class="badge" style="margin-top:10px">${precise ? 'Точная точка' : approximate ? 'Приближённая городская точка' : 'Координаты расчётной базы'}</div><div id="companyMap" class="location-map"></div>` : `<div class="neutral-note" style="margin-top:12px">Координаты не найдены. <a class="source-link" href="${esc(searchUrl)}" target="_blank" rel="noopener">Открыть поиск в OpenStreetMap</a></div>`}`;
  if (!hasCoords || !window.L) return;
  const lat = Number(company.lat);
  const lon = Number(company.lon);
  state.companyMap = L.map('companyMap', { zoomControl: true, attributionControl: true }).setView([lat, lon], precise ? 15 : 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.companyMap);
  const markerOptions = approximate
    ? { icon: L.divIcon({ className: '', html: '<div class="approx-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }
    : {};
  L.marker([lat, lon], markerOptions).addTo(state.companyMap).bindPopup(esc(company.display_name));
  setTimeout(() => state.companyMap?.invalidateSize(), 180);
}

async function openRoleDrawer(role) {
  state.roleDrawer = { role, page: 0, offset: 0 };
  const drawer = $('roleDrawer');
  drawer.classList.add('open');
  await renderRoleDrawer();
}

function closeRoleDrawer() {
  $('roleDrawer')?.classList.remove('open');
}

async function loadRoleGroupIndex() {
  if (staticCache.roleGroupIndex) return staticCache.roleGroupIndex;
  staticCache.roleGroupIndex = await loadJson('roles/by_group/index.json');
  return staticCache.roleGroupIndex;
}

async function renderRoleDrawer() {
  const role = state.roleDrawer.role;
  const content = $('drawerContent');
  $('drawerTitle').textContent = ROLE_COLUMNS[role] || ROLE_LABELS[role] || 'Компании';
  $('drawerSubtitle').textContent = `${dirById.get(state.direction)?.short_name || state.direction} · ${regionName(state.region)}`;
  content.innerHTML = '<div class="hint">Загружаю полный список роли...</div>';
  let entry = null;
  try {
    const index = await loadRoleGroupIndex();
    entry = index?.[state.direction]?.[state.region]?.[role];
  } catch (e) {}
  if (!entry?.pages?.length) {
    content.innerHTML = '<div class="neutral-note">Для текущего фильтра нет полного списка компаний.</div>';
    return;
  }
  const pageNo = Math.max(0, Math.min(state.roleDrawer.page, entry.pages.length - 1));
  const rows = await loadJson(entry.pages[pageNo]);
  const start = state.roleDrawer.offset;
  const end = Math.min(start + 200, rows.length);
  const visible = rows.slice(start, end);
  const enriched = await Promise.all(visible.map(row => enrichRoleRow(row)));
  content.innerHTML = `<div class="pager"><div>Показано ${fmt(pageNo * 5000 + start + 1)}-${fmt(pageNo * 5000 + end)} из ${fmt(entry.rows)}</div><div class="pager-actions">${pagerButton('Назад', pageNo > 0 || start > 0, 'prev')}${pagerButton('Дальше', end < rows.length || pageNo < entry.pages.length - 1, 'next')}</div></div>
    ${enriched.map(item => `<div class="list-row" data-open-inn="${esc(item.inn)}"><div><div class="list-name">${esc(item.name)}</div><div class="list-meta">ИНН ${esc(item.inn)} · ${esc(item.region_name)} · ОКВЭД ${esc(item.okved || '—')} · score ${fmt(item.score, 0)}${item.has_resolved_name ? '' : ' · название не найдено'}</div></div><div class="result-badge">${money(item.revenue_mrub)}</div></div>`).join('')}`;
  content.querySelectorAll('[data-open-inn]').forEach(el => {
    el.onclick = () => openPassport(el.dataset.openInn);
  });
  content.querySelector('[data-page="prev"]')?.addEventListener('click', () => changeRolePage(-1, rows.length, entry.pages.length));
  content.querySelector('[data-page="next"]')?.addEventListener('click', () => changeRolePage(1, rows.length, entry.pages.length));
}

function pagerButton(label, enabled, action) {
  return `<button class="btn" data-page="${action}" ${enabled ? '' : 'disabled'}>${label}</button>`;
}

function changeRolePage(delta, currentRows, pageCount) {
  if (delta > 0) {
    if (state.roleDrawer.offset + 200 < currentRows) state.roleDrawer.offset += 200;
    else if (state.roleDrawer.page + 1 < pageCount) {
      state.roleDrawer.page += 1;
      state.roleDrawer.offset = 0;
    }
  } else {
    if (state.roleDrawer.offset >= 200) state.roleDrawer.offset -= 200;
    else if (state.roleDrawer.page > 0) {
      state.roleDrawer.page -= 1;
      state.roleDrawer.offset = Math.max(0, currentRows - 200);
    }
  }
  renderRoleDrawer();
}

async function enrichRoleRow(row) {
  const inn = String(row[0]);
  const [base, profile] = await Promise.all([loadCompanyByInn(inn), loadProfileByInn(inn)]);
  const name = profile?.display_name || profile?.company_short_name || profile?.company_name || compByInn.get(inn)?.name || 'Профиль расчётной базы';
  return {
    inn,
    name,
    has_resolved_name: Boolean(profile?.display_name || profile?.company_short_name || profile?.company_name || compByInn.get(inn)?.name),
    ogrn: row[1] || base?.ogrn,
    okved: row[2] || base?.okved,
    score: row[3],
    revenue_mrub: row[4],
    lat: row[5],
    lon: row[6],
    geocoding_quality: row[7],
    region_name: regionName(state.region)
  };
}

function bindActions() {
  const set = (id, fn) => {
    const el = $(id);
    if (el) el.onclick = fn;
  };
  set('exportReport', downloadReport);
  set('routePassportBtn', openRoutePassport);
  set('favoriteBtn', toggleFavorite);
  set('shareBtn', shareCurrent);
}

function currentRoute() {
  const map = getMap();
  return { map, route: map.routes.find(r => r.id === state.selectedRoute) || map.routes[0] || null };
}

function routeCompanies(route, map) {
  if (!route) return [];
  const nodes = new Map(Object.values(map.roles || {}).flat().map(n => [n.id, n]));
  return route.nodes.map(id => nodes.get(id)).filter(Boolean).map(n => ({
    inn: n.inn,
    name: n.name,
    role: n.role_label,
    region: n.region_name,
    score: n.score,
    evidence_score: n.evidence_score
  }));
}

function downloadReport() {
  const { map, route } = currentRoute();
  const direction = dirById.get(state.direction);
  const report = {
    generated_at: new Date().toISOString(),
    direction: { id: state.direction, name: direction?.short_name || state.direction },
    region: { id: state.region, name: regionName(state.region) },
    route_score: route?.score || null,
    companies: routeCompanies(route, map),
    stats: map.stats
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `techcoop_route_${state.direction}_${state.region.replace(/[^a-z0-9]+/gi, '_')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function toggleFavorite() {
  const button = $('favoriteBtn');
  if (!button) return;
  const active = !button.classList.contains('primary');
  button.classList.toggle('primary', active);
  button.textContent = active ? '★ В избранном' : '☆ В избранное';
}

async function shareCurrent() {
  const company = await composeCompany(state.selectedCompany).catch(() => null);
  const text = company ? `TechCoop.AI: ${company.display_name}, ИНН ${company.inn}` : `TechCoop.AI: ${regionName(state.region)}`;
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) await navigator.share({ title: 'TechCoop.AI', text, url });
    else if (navigator.clipboard) await navigator.clipboard.writeText(`${text}\n${url}`);
    flashButton('shareBtn', 'Ссылка скопирована');
  } catch (e) {}
}

function flashButton(id, text) {
  const button = $(id);
  if (!button) return;
  const old = button.textContent;
  button.textContent = text;
  setTimeout(() => { button.textContent = old; }, 1400);
}

window.addEventListener('resize', () => {
  if (state.view === 'map') scheduleDrawFlow();
});

init().catch(error => {
  console.error(error);
  if ($('globalSearchResults')) $('globalSearchResults').innerHTML = '<div class="neutral-note">Статические данные не загрузились. Проверьте запуск через локальный сервер.</div>';
});
