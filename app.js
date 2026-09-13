'use strict';
const $ = id => document.getElementById(id);
const number = n => n.toLocaleString('zh-CN');
let library, activeGroup = '', activeChild = '', activeMechanism = '', featuredItem, focusBeforeModal;
let columnCount = getColumnCount();
const displayAward = item => item.awardLabel || item.award;
function topItem(items) {
  return items.reduce((best, item) => !best || item.awardPriority < best.awardPriority ||
    (item.awardPriority === best.awardPriority && Number(item.year) > Number(best.year)) ? item : best, undefined);
}
function getColumnCount() { return innerWidth <= 560 ? 1 : innerWidth <= 900 ? 2 : 4; }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function allItems(groups = library.groups) { return groups.flatMap(g => g.children.flatMap(c => c.items)); }
function categoryGroups() {
  return library.groups.filter(g => !activeGroup || g.id === activeGroup).map(g => ({
    ...g, children: g.children.filter(c => !activeChild || c.id === activeChild)
  })).filter(g => g.children.length);
}
function matchesMechanism(item) { return !activeMechanism || item.innovationMechanisms.includes(activeMechanism); }
function visibleGroups() {
  return categoryGroups().map(group => ({...group,
    children: group.children.map(child => {
      const items = child.items.filter(matchesMechanism);
      return {...child, items, count:items.length};
    }).filter(child => child.count)
  })).filter(group => group.children.length);
}
function chip(label, count, active, callback) {
  const button = el('button', 'chip' + (active ? ' active' : ''), label);
  button.type = 'button'; button.setAttribute('aria-pressed', String(active));
  button.append(el('small', '', number(count))); button.addEventListener('click', callback);
  return button;
}
function renderFilters() {
  const focusKey = document.activeElement?.dataset.filterKey;
  $('categoryReset').classList.toggle('active', !activeGroup);
  $('categoryReset').setAttribute('aria-pressed', String(!activeGroup));
  $('categoryReset').querySelector('small').textContent = number(allItems().filter(matchesMechanism).length);
  $('filters').replaceChildren(...library.groups.map((group, index) => {
    const wrapper = el('div', 'category-branch');
    const selected = activeGroup === group.id;
    const parent = chip(group.name, allItems([group]).filter(matchesMechanism).length, selected, () => choose(group.id, ''));
    parent.classList.add('parent-category'); parent.dataset.filterKey = group.id;
    parent.setAttribute('aria-expanded', String(selected)); parent.setAttribute('aria-controls', 'children-' + index);
    const children = el('div', 'child-categories'); children.id = 'children-' + index;
    children.hidden = !selected; children.setAttribute('role', 'group'); children.setAttribute('aria-label', group.name + '子类别');
    children.append(...group.children.map(child => {
      const button = chip(child.name, child.items.filter(matchesMechanism).length, activeChild === child.id, () => choose(group.id, child.id));
      button.dataset.filterKey = child.id; return button;
    }));
    wrapper.append(parent, children); return wrapper;
  }));
  const scope = allItems(categoryGroups());
  $('mechanismFilters').replaceChildren(...[{name:'', label:'全部机制'}, ...library.mechanisms.map(m => ({name:m.name, label:m.name}))].map(({name, label}) => {
    const count = name ? scope.filter(item => item.innovationMechanisms.includes(name)).length : scope.length;
    const button = chip(label, count, activeMechanism === name, () => chooseMechanism(name));
    button.dataset.filterKey = 'mechanism-' + name; button.dataset.mechanism = name;
    button.classList.toggle('zero-count', !count); return button;
  }));
  const group = library.groups.find(g => g.id === activeGroup);
  const child = group?.children.find(c => c.id === activeChild);
  const label = group ? group.name + ' / ' + (child?.name || '全部子类') : '全部分类';
  $('resultLine').replaceChildren(el('span', 'result-path', label), el('span', 'filter-join', '∩'),
    el('span', 'result-mechanism', activeMechanism || '全部机制'),
    el('strong', '', number(allItems(visibleGroups()).length) + ' 条作品记录'));
  $('resetFilters').disabled = !activeGroup && !activeMechanism;
  if (focusKey) [...document.querySelectorAll('[data-filter-key]')].find(button => button.dataset.filterKey === focusKey)?.focus({preventScroll:true});
}
function choose(group, child) {
  activeGroup = group; activeChild = child;
  refreshResults();
}
function chooseMechanism(name) { activeMechanism = name; refreshResults(); }
function resetFilters() { activeGroup = ''; activeChild = ''; activeMechanism = ''; refreshResults(); }
function refreshResults() {
  renderFilters(); renderCollection();
  setFeature(topItem(allItems(visibleGroups())));
}
function insightRows(entry = {}) {
  return [['用户', entry.user], ['场景', entry.scenario], ['痛点', entry.painPoint]];
}
function makeCard(item) {
  const card = el('button', 'card'); card.type = 'button';
  card.dataset.recordId = item.id;
  const mechanisms = item.innovationMechanisms || [];
  card.style.setProperty('--card-min-height', (190 + mechanisms.length * 27) + 'px');
  card.style.setProperty('--ratio', String(Math.max(.65, Math.min(1.7, item.ratio))));
  card.setAttribute('aria-label', item.title + '，' + displayAward(item) + ' ' + item.year + '，查看详情');
  let visual = el('span', 'image-placeholder', '图片待补充');
  if (item.images.length) {
    visual = new Image(); visual.src = item.thumbnail || item.images[0]; visual.alt = item.title; visual.loading = 'lazy'; visual.decoding = 'async';
  }
  const hover = el('span', 'hover-info');
  hover.id = 'insight-' + item.id;
  card.setAttribute('aria-describedby', hover.id);
  for (const [name, value] of insightRows(item.userScenarioPain?.[0])) {
    const row = el('span', 'hover-insight-row');
    row.append(el('span', 'hover-insight-label', name), el('span', 'hover-insight-value', value || '暂未记录'));
    hover.append(row);
  }
  const tags = el('span', 'hover-mechanisms');
  tags.append(...mechanisms.map(name => el('span', 'mechanism-tag', name)));
  hover.append(tags);
  const label = el('span', 'card-label'); label.append(el('span', 'card-title', item.title), el('span', 'card-sub', displayAward(item) + ' · ' + item.year));
  card.append(visual, el('span', 'veil'), hover, label);
  card.addEventListener('mouseenter', () => setFeature(item));
  card.addEventListener('focus', () => setFeature(item));
  card.addEventListener('click', () => openModal(item));
  return card;
}
function layoutRail(rail, cards) {
  const heights = Array(columnCount).fill(0);
  const columnWidth = (rail.clientWidth - 26 - 14 * (columnCount - 1)) / columnCount || 240;
  const columns = Array.from({length:columnCount}, () => el('div', 'waterfall-column'));
  for (const card of cards) {
    const index = heights.indexOf(Math.min(...heights));
    columns[index].append(card);
    heights[index] += Math.max(columnWidth / Number(card.style.getPropertyValue('--ratio')), parseFloat(card.style.getPropertyValue('--card-min-height'))) + 14;
  }
  rail.replaceChildren(...columns);
  rail._cards = cards;
}
function categoryAnalysis(data) {
  const analysis = el('div', 'category-analysis');
  const summary = el('p', 'category-analysis-summary');
  // Keep percentages in the conclusion, with emphasis that does not change the text.
  for (const part of (data.lead || data.summary).split(/((?:约)?\d+(?:\.\d+)?%(?:-\d+(?:\.\d+)?%)?)/g)) {
    summary.append(/%/.test(part) ? el('strong', 'analysis-percentage', part) : document.createTextNode(part));
  }
  analysis.append(summary);
  if (data.directions?.length) {
    const directions = el('ul', 'analysis-directions' + (data.directions.length > 1 ? ' analysis-directions-grid' : ''));
    for (const entry of data.directions) {
      const row = el('li', 'analysis-direction');
      row.append(el('strong', 'analysis-direction-label', entry.label), el('span', '', entry.text));
      directions.append(row);
    }
    analysis.append(directions);
  }
  const source = '文档分析 · ' + data.sampleCount + ' 个案例' +
    (data.distribution ? '；占比统计样本 · ' + data.distributionSampleCount + ' 个' : '');
  analysis.append(el('p', 'category-analysis-source', source));
  return analysis;
}
function renderCollection() {
  const fragment = document.createDocumentFragment();
  for (const group of visibleGroups()) {
    const wrapper = el('section', 'main-category'); wrapper.dataset.group = group.id;
    const head = el('header', 'group-head');
    const heading = el('h2', '', group.name); heading.id = 'group-' + group.id.split('_')[0];
    head.append(el('span', 'group-index', group.id.split('_')[0]), heading,
      el('p', '', group.children.length + ' 个子类 · ' + number(group.children.reduce((n,c) => n + c.count, 0)) + ' 条作品记录'));
    wrapper.setAttribute('aria-labelledby', heading.id); wrapper.append(head);
    for (const child of group.children) {
      const section = el('section', 'category-section'); section.dataset.category = child.id;
      const sectionHead = el('div', 'section-head'); const text = el('div');
      text.append(el('h3', '', child.name));
      if (child.analysis) {
        text.append(categoryAnalysis(child.analysis));
      } else {
        text.append(el('p', '', number(child.count) + ' 条作品记录 · 框内上下滚动查看作品，框外滚动浏览类别'));
      }
      sectionHead.append(text);
      const rail = el('div', 'rail'); rail.tabIndex = 0; rail.setAttribute('role', 'region'); rail.setAttribute('aria-label', child.name + '作品瀑布流');
      section.append(sectionHead, rail); wrapper.append(section);
      rail._cards = child.items.map(makeCard);
    }
    fragment.append(wrapper);
  }
  if (!fragment.childElementCount) {
    const empty = el('div', 'empty-results');
    const clear = el('button', 'chip', '清除机制筛选'); clear.type = 'button'; clear.addEventListener('click', () => chooseMechanism(''));
    empty.append(el('h3', '', '当前组合暂无作品'), el('p', '', '试试其他创新机制，或清除机制筛选查看此分类。'), clear);
    fragment.append(empty);
  }
  $('rails').replaceChildren(fragment);
  document.querySelectorAll('.rail').forEach(rail => layoutRail(rail, rail._cards));
}
function setFeature(item) {
  $('featured').hidden = !item;
  if (!item) { featuredItem = undefined; return; }
  if (item === featuredItem) return;
  featuredItem = item;
  $('featureImage').hidden = !item.images.length; $('featurePlaceholder').hidden = !!item.images.length;
  if (item.images.length) $('featureImage').src = item.images[0];
  else $('featureImage').removeAttribute('src');
  $('featureImage').alt = item.title;
  $('featureTitle').textContent = item.title;
  $('featureAward').textContent = displayAward(item) + ' · ' + item.year;
  $('featureCategory').textContent = item.group + ' / ' + item.category;
  $('featureDesc').textContent = item.summary || item.productType;
}
function infoRow(label, value) {
  const row = el('div', 'info-row'); row.append(el('span', '', label), el('span', '', value || '未记录')); return row;
}
function openModal(item) {
  focusBeforeModal = document.activeElement;
  $('modalGallery').replaceChildren(...item.images.map((url, i) => {
    const image = new Image(); image.src = url; image.alt = item.title + ' · 图片 ' + (i+1); image.loading = i ? 'lazy' : 'eager'; return image;
  }));
  if (!item.images.length) $('modalGallery').append(el('p', 'image-placeholder', '图片待补充'));
  $('modalAward').textContent = item.award + ' · ' + item.year;
  $('modalTitle').textContent = item.title;
  $('modalSummary').textContent = item.summary;
  $('modalDesc').textContent = item.description || '当前资料尚未记录作品说明。';
  const rows = [['网页分类', item.group + ' / ' + item.category], ['奖项等级', item.awardLevel], ['年份', item.year],
    ['官方领域', item.discipline], ['官方类别', item.officialCategory], ['产品类型', item.productType], ['作品图片', item.images.length + ' 张']];
  const represented = new Set(['奖项与等级','获奖年份','年份','官方领域','官方类别','作品类型','产品类型']);
  for (const row of item.overview) if (!represented.has(row[0])) rows.push(row);
  $('modalInfo').replaceChildren(...rows.filter(([,v]) => v).map(([k,v]) => infoRow(k,v)));
  const insights = item.userScenarioPain || [];
  $('modalInsights').replaceChildren(...(insights.length ? insights.map((entry, index) => {
    const block = el('div', 'insight-block');
    if (insights.length > 1) block.append(el('p', 'insight-index', '分析 ' + (index + 1) + ' / ' + insights.length));
    block.append(...insightRows(entry).map(([name, value]) => infoRow(name, value || '暂未记录')));
    return block;
  }) : [el('p', 'desc', '当前资料尚未记录用户、场景、痛点。')]));
  $('modalInsightStatus').textContent = item.uspAnalysisStatus ? '分析状态：' + item.uspAnalysisStatus : '';
  $('modalTranslation').textContent = item.translation ? '译文来源：' + item.translation : '';
  const link = $('modalSource'); let url;
  try { url = new URL(item.url); } catch {}
  link.hidden = !url || !['https:','http:'].includes(url.protocol);
  if (!link.hidden) link.href = url.href;
  $('modalBackdrop').classList.add('open'); document.body.style.overflow = 'hidden';
  document.querySelector('.shell').inert = true;
  $('modal').scrollTop = 0; $('closeModal').focus({preventScroll:true});
}
function closeModal() {
  $('modalBackdrop').classList.remove('open'); document.body.style.overflow = '';
  document.querySelector('.shell').inert = false; focusBeforeModal?.focus({preventScroll:true});
}
function renderStats() {
  const {stats, groups} = library;
  $('totalCount').textContent = number(stats.records); $('groupCount').textContent = stats.groups;
  $('catCount').textContent = stats.categories;
  $('awardCount').textContent = new Set(allItems().map(i => /red\s*dot/i.test(i.award) ? 'Red Dot' : /\bif\b/i.test(i.award) ? 'iF' : i.award)).size;
  const max = Math.max(...groups.map(g => g.count));
  $('distribution').replaceChildren(...groups.map(g => {
    const row = el('div', 'distribution-row');
    row.append(el('span', '', g.name), el('b', '', number(g.count) + ' · ' + (100*g.count/stats.records).toFixed(1) + '%'));
    const track = el('div', 'distribution-track'); const fill = el('div', 'distribution-fill'); fill.style.width = (100*g.count/max) + '%';
    track.setAttribute('aria-hidden', 'true'); track.append(fill); row.append(track); return row;
  }));
  $('categoryBreakdown').replaceChildren(...groups.flatMap(g => g.children.map(c => {
    const row = el('tr'); row.append(el('td','',g.name), el('td','',c.name), el('td','',number(c.count))); return row;
  })));
  $('statsNote').textContent = '统计范围：全库 ' + stats.yearFrom + '—' + stats.yearTo + ' 年记录，包含 iF 设计奖、iF 学生奖及历史 Talent Award、Red Dot 和红点概念奖。按作品记录计数，同名作品的不同奖项或官方类别记录分别保留。';
  $('syncDate').textContent = '更新于 ' + new Intl.DateTimeFormat('zh-CN', {dateStyle:'medium', timeStyle:'short', timeZone:'Asia/Shanghai'}).format(new Date(library.generatedAt));
}
async function init() {
  try {
    const response = await fetch('./library.json', {cache:'no-store'});
    if (!response.ok) throw new Error('Library HTTP ' + response.status);
    library = await response.json();
    renderFilters(); renderCollection(); renderStats(); setFeature(topItem(allItems()));
  } catch (error) {
    console.error(error); const retry = el('button', 'chip', '重新加载'); retry.addEventListener('click', init);
    $('rails').replaceChildren(el('p', 'load-error', '作品资料暂时无法加载，请稍后重试。'), retry);
  }
}
$('closeModal').addEventListener('click', closeModal);
$('modalBackdrop').addEventListener('click', e => { if(e.target === $('modalBackdrop')) closeModal(); });
document.addEventListener('keydown', e => {
  if (!$('modalBackdrop').classList.contains('open')) return;
  if (e.key === 'Escape') closeModal();
  if (e.key === 'Tab') {
    const nodes = [...$('modal').querySelectorAll('button, a[href]')].filter(n => !n.hidden);
    const first = nodes[0], last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
$('featureAction').addEventListener('click', () => { if(featuredItem) openModal(featuredItem); });
$('categoryReset').addEventListener('click', () => choose('', ''));
$('resetFilters').addEventListener('click', resetFilters);
window.addEventListener('resize', () => {
  const count = getColumnCount();
  columnCount = count;
  document.querySelectorAll('.rail').forEach(rail => layoutRail(rail, rail._cards));
});
init();
