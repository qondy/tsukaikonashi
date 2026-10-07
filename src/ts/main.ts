import { User } from 'firebase/auth';
import { loginWithGoogle, logout, onAuthChange } from './auth';
import { submitFeedback } from './feedback';
import { processPhoto, thumbFromDataUrl } from './image';
import { SAMPLE_ITEMS } from './samples';
import {
  createCategory, createItem, deleteCategory, deleteItem, ensureDefaultCategories, loadPhotos,
  MAX_CATEGORIES, MAX_FEATURES, MAX_FEATURE_TEXT, MAX_MANUALS, MAX_PHOTOS, newId, renameCategory,
  safeUrl, subscribeCategories, subscribeItems, updateFeatures, updateItem,
} from './store';
import { Category, Feature, FeatureStatus, Item, ItemData, ManualLink } from './types';
import { button, closeOverlay, iconEl, openOverlay, showToast, textEl } from './ui';

// ============================================================
// 固定アイコン（開発者定義のSVGのみ。ユーザー入力は含めない）
// ============================================================
const svg = (inner: string, size = 18): string =>
  `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
const ICON_APP = '<path d="M14 24 H50 L47 54 H17 Z"/><path d="M24 24 V19 C24 14 27.5 10 32 10 C36.5 10 40 14 40 19 V24"/><path d="M24 39 L30 45 L41 34"/>';
const ICON_LINK = '<path d="M28 36 C31 40 37 40 40 37 L50 27 C53 24 53 18 50 15 C47 12 41 12 38 15 L34 19"/><path d="M36 28 C33 24 27 24 24 27 L14 37 C11 40 11 46 14 49 C17 52 23 52 26 49 L30 45"/>';
const ICON_EDIT = '<path d="M40 12 L52 24 L24 52 H12 V40 Z"/><path d="M34 18 L46 30"/>';
const ICON_TRASH = '<path d="M12 18 H52"/><path d="M26 18 V12 H38 V18"/><path d="M17 18 L20 54 H44 L47 18"/>';
const ICON_CHEVRON_L = '<path d="M40 14 L22 32 L40 50"/>';
const ICON_CHEVRON_R = '<path d="M24 14 L42 32 L24 50"/>';

const STATUS_LABEL: Record<FeatureStatus, string> = { todo: 'まだ', tried: '試した', mastered: '使いこなし' };
const SORT_KEY = 'tsukaikonashi:sort';
const CATEGORY_KEY = 'tsukaikonashi:category';
const UNCATEGORIZED = '__none__';
const ALL = '__all__';

// ============================================================
// 状態
// ============================================================
let currentUser: User | null = null;
let items: Item[] = [];
let categories: Category[] = [];
let itemsLoaded = false;
let unsubItems: (() => void) | null = null;
let unsubCategories: (() => void) | null = null;

let searchQuery = '';
let selectedCategory = lsGet(CATEGORY_KEY) || ALL;
let sortKey = lsGet(SORT_KEY) || 'purchased';
let nextSeed = 0;

let detailId: string | null = null;
let detailPhotos: string[] = [];
let detailPhotoIndex = 0;
let detailPhotoToken = 0;

let editingId: string | null = null;
let editorPhotos: string[] = [];
let editorPhotosLoaded = true;
let editorPhotosChanged = false;
let editorSnapshot = '';
let editorBusy = false;
let photoBusy = false;

let editingFeatureId: string | null = null;
let confirmAction: (() => Promise<void>) | null = null;

// ============================================================
// 要素
// ============================================================
const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

const loginScreen = $('login-screen');
const appEl = $('app');
const itemList = $<HTMLUListElement>('item-list');
const loadingEl = $('loading');
const emptyFirst = $('empty-first');
const emptyMatch = $('empty-match');
const summaryEl = $('summary');
const categoryBar = $('category-bar');
const searchInput = $<HTMLInputElement>('input-search');
const sortSelect = $<HTMLSelectElement>('select-sort');
const nextSection = $('next-section');
const nextList = $<HTMLUListElement>('next-list');

const detailOverlay = $('detail-overlay');
const editorOverlay = $('editor-overlay');
const editorForm = $<HTMLFormElement>('editor-form');
const featureOverlay = $('feature-overlay');
const categoryOverlay = $('category-overlay');
const discardOverlay = $('discard-dialog-overlay');
const confirmOverlay = $('confirm-dialog-overlay');
const feedbackOverlay = $('feedback-modal-overlay');

const photoPicker = $('photo-picker');
const photoAdd = $('photo-add');
const photoInput = $<HTMLInputElement>('input-photo');
const nameInput = $<HTMLInputElement>('input-name');
const makerInput = $<HTMLInputElement>('input-maker');
const purchasedInput = $<HTMLInputElement>('input-purchased');
const categorySelect = $<HTMLSelectElement>('input-category');
const featuresField = $('field-features');
const featuresInput = $<HTMLTextAreaElement>('input-features');
const manualRows = $('manual-rows');
const memoInput = $<HTMLTextAreaElement>('input-memo');
const editorSaveBtn = $<HTMLButtonElement>('btn-editor-save');

// ============================================================
// ユーティリティ
// ============================================================
function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || '';
  } catch {
    return '';
  }
}

function lsSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDate(s: string): string {
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}

/** 買った日からの経過日数（未来の日付や未入力は null） */
function daysSince(s: string): number | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diff = Math.round((today - then) / 86_400_000);
  return diff >= 0 ? diff : null;
}

/** 使いこなし度: 試した=半分、使いこなし=満点として計算 */
function mastery(features: Feature[]): { pct: number; todo: number; tried: number; mastered: number } {
  const tried = features.filter((f) => f.status === 'tried').length;
  const mastered = features.filter((f) => f.status === 'mastered').length;
  const n = features.length;
  const pct = n ? Math.round(((tried + mastered * 2) / (n * 2)) * 100) : 0;
  return { pct, todo: n - tried - mastered, tried, mastered };
}

function categoryName(id: string): string {
  return categories.find((c) => c.id === id)?.name ?? '';
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function findItem(id: string | null): Item | undefined {
  return id ? items.find((i) => i.id === id) : undefined;
}

// ============================================================
// 一覧
// ============================================================
function filteredItems(): Item[] {
  const q = searchQuery.trim().toLowerCase();
  const list = items.filter((item) => {
    if (selectedCategory === UNCATEGORIZED) {
      if (item.categoryId && categoryName(item.categoryId)) return false;
    } else if (selectedCategory !== ALL && item.categoryId !== selectedCategory) {
      return false;
    }
    if (!q) return true;
    const hay = [item.name, item.maker, item.memo, categoryName(item.categoryId), ...item.features.map((f) => `${f.text} ${f.note}`)]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });

  const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, 'ja');
  list.sort((a, b) => {
    switch (sortKey) {
      case 'growth': {
        // 未試行の数が多い順 → 使いこなし度が低い順
        const ma = mastery(a.features);
        const mb = mastery(b.features);
        return mb.todo - ma.todo || ma.pct - mb.pct || byName(a, b);
      }
      case 'new':
        return b.createdAt - a.createdAt;
      case 'name':
        return byName(a, b);
      default:
        // 買った日が新しい順（未入力は登録日で代用）
        return (b.purchasedAt || toDateStr(b.createdAt)).localeCompare(a.purchasedAt || toDateStr(a.createdAt)) || b.createdAt - a.createdAt;
    }
  });
  return list;
}

function toDateStr(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderCategoryBar(): void {
  categoryBar.textContent = '';
  const hasUncategorized = items.some((i) => !i.categoryId || !categoryName(i.categoryId));
  const valid = selectedCategory === ALL
    || (selectedCategory === UNCATEGORIZED && hasUncategorized)
    || categories.some((c) => c.id === selectedCategory);
  if (!valid) selectedCategory = ALL;

  const chip = (id: string, label: string, count: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'category-chip' + (selectedCategory === id ? ' is-active' : '');
    b.setAttribute('aria-pressed', String(selectedCategory === id));
    b.append(textEl('span', '', label), textEl('span', 'category-chip__count', String(count)));
    b.addEventListener('click', () => {
      selectedCategory = id;
      lsSet(CATEGORY_KEY, id);
      render();
    });
    categoryBar.append(b);
  };

  chip(ALL, 'すべて', items.length);
  categories.forEach((c) => chip(c.id, c.name, items.filter((i) => i.categoryId === c.id).length));
  if (hasUncategorized) chip(UNCATEGORIZED, '未分類', items.filter((i) => !i.categoryId || !categoryName(i.categoryId)).length);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'category-chip category-chip--edit';
  edit.append(iconEl(svg(ICON_EDIT, 14)), textEl('span', '', 'カテゴリを編集'));
  edit.addEventListener('click', openCategoryEditor);
  categoryBar.append(edit);
}

function renderItemCard(item: Item): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item-card';

  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item-card__btn';
  b.setAttribute('aria-label', `${item.name}の詳細を開く`);
  b.addEventListener('click', () => openDetail(item.id));

  const thumb = document.createElement('div');
  thumb.className = 'item-card__thumb';
  if (item.thumb) {
    const img = document.createElement('img');
    img.src = item.thumb;
    img.alt = '';
    img.loading = 'lazy';
    thumb.append(img);
  } else {
    thumb.append(iconEl(svg(ICON_APP, 40), 'item-card__placeholder'));
  }
  if (item.photoCount > 1) thumb.append(textEl('span', 'item-card__photo-count', `${item.photoCount}枚`));

  const body = document.createElement('div');
  body.className = 'item-card__body';
  const cat = categoryName(item.categoryId);
  if (cat) body.append(textEl('span', 'chip chip--category', cat));
  body.append(textEl('h3', 'item-card__name', item.name));
  const metaParts: string[] = [];
  if (item.maker) metaParts.push(item.maker);
  const days = daysSince(item.purchasedAt);
  if (days !== null) metaParts.push(days === 0 ? '今日買った' : `買って${days}日`);
  if (metaParts.length) body.append(textEl('p', 'item-card__meta', metaParts.join(' ・ ')));

  const m = mastery(item.features);
  const prog = document.createElement('div');
  prog.className = 'progress';
  if (item.features.length) {
    const top = document.createElement('div');
    top.className = 'progress__top';
    top.append(textEl('span', 'progress__label', `できること ${item.features.length}`), textEl('span', 'progress__value', `${m.pct}%`));
    const bar = document.createElement('div');
    bar.className = 'progress__bar';
    const fill = document.createElement('span');
    fill.className = 'progress__fill';
    fill.style.width = `${m.pct}%`;
    bar.append(fill);
    prog.append(top, bar);
    if (m.todo) prog.append(textEl('p', 'progress__hint', `まだ試していない ${m.todo}`));
    else prog.append(textEl('p', 'progress__hint is-done', m.pct === 100 ? 'ぜんぶ使いこなし！' : 'ぜんぶ試した！'));
  } else {
    prog.append(textEl('p', 'progress__hint', 'できることを登録しよう'));
  }
  body.append(prog);

  b.append(thumb, body);
  li.append(b);
  return li;
}

/** まだ試していない「できること」から、次に試す候補を選ぶ */
function renderNext(): void {
  const candidates: { item: Item; feature: Feature }[] = [];
  items.forEach((item) => item.features.forEach((f) => {
    if (f.status === 'todo') candidates.push({ item, feature: f });
  }));
  nextList.textContent = '';
  if (!candidates.length) {
    nextSection.classList.add('hidden');
    return;
  }
  nextSection.classList.remove('hidden');
  // 最近買ったものを優先しつつ、「ほかの候補」で順にずらす
  candidates.sort((a, b) => (b.item.purchasedAt || toDateStr(b.item.createdAt)).localeCompare(a.item.purchasedAt || toDateStr(a.item.createdAt)));
  const start = (nextSeed * 3) % candidates.length;
  const picked = [...candidates.slice(start), ...candidates.slice(0, start)].slice(0, 3);
  $('btn-next-shuffle').classList.toggle('hidden', candidates.length <= 3);

  picked.forEach(({ item, feature }) => {
    const li = document.createElement('li');
    li.className = 'next__item';
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'next__info';
    info.append(textEl('span', 'next__feature', feature.text), textEl('span', 'next__product', item.name));
    info.addEventListener('click', () => openDetail(item.id));
    const done = button('試した', 'btn btn--ghost btn--sm next__done', () => {
      void setFeatureStatus(item.id, feature.id, 'tried', done);
    });
    li.append(info, done);
    nextList.append(li);
  });
}

function render(): void {
  if (!itemsLoaded) return;
  loadingEl.classList.add('hidden');
  renderCategoryBar();
  renderNext();

  itemList.textContent = '';
  const list = filteredItems();
  list.forEach((item) => itemList.append(renderItemCard(item)));

  const total = items.reduce((acc, i) => acc + i.features.length, 0);
  const mastered = items.reduce((acc, i) => acc + i.features.filter((f) => f.status === 'mastered').length, 0);
  summaryEl.textContent = items.length
    ? `${list.length}件 / 使いこなし ${mastered} / できること ${total}`
    : '';

  emptyFirst.classList.toggle('hidden', items.length > 0);
  emptyMatch.classList.toggle('hidden', items.length === 0 || list.length > 0);

  if (detailId) {
    if (findItem(detailId)) renderDetail();
    else closeDetail();
  }
}

// ============================================================
// 詳細
// ============================================================
function openDetail(id: string): void {
  if (!findItem(id)) return;
  const switching = detailId !== id;
  detailId = id;
  if (switching) {
    detailPhotos = [];
    detailPhotoIndex = 0;
    void fetchDetailPhotos(id);
  }
  renderDetail();
  openOverlay(detailOverlay);
}

async function fetchDetailPhotos(id: string): Promise<void> {
  const item = findItem(id);
  if (!currentUser || !item || item.photoCount === 0) return;
  const token = ++detailPhotoToken;
  try {
    const photos = await loadPhotos(currentUser.uid, id);
    if (token !== detailPhotoToken || detailId !== id) return;
    detailPhotos = photos;
    detailPhotoIndex = 0;
    renderDetailPhotos();
  } catch {
    if (token === detailPhotoToken) showToast('写真を読み込めませんでした');
  }
}

function closeDetail(): void {
  detailId = null;
  detailPhotos = [];
  detailPhotoToken++;
  closeOverlay(detailOverlay);
}

function renderDetailPhotos(): void {
  const item = findItem(detailId);
  const wrap = $('detail-photos');
  wrap.textContent = '';
  if (!item) return;
  if (!detailPhotos.length) {
    if (item.thumb) {
      // 本体の写真を読み込むまではサムネイルを表示
      const img = document.createElement('img');
      img.src = item.thumb;
      img.alt = `${item.name}の写真`;
      img.className = 'photo-viewer__img is-loading';
      wrap.append(img);
    } else {
      wrap.append(iconEl(svg(ICON_APP, 56), 'photo-viewer__placeholder'));
    }
    return;
  }
  const idx = Math.min(detailPhotoIndex, detailPhotos.length - 1);
  const img = document.createElement('img');
  img.src = detailPhotos[idx];
  img.alt = `${item.name}の写真（${idx + 1}/${detailPhotos.length}）`;
  img.className = 'photo-viewer__img';
  wrap.append(img);
  if (detailPhotos.length > 1) {
    const nav = (dir: number, icon: string, label: string, cls: string) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `photo-viewer__nav ${cls}`;
      b.setAttribute('aria-label', label);
      b.append(iconEl(svg(icon, 22), ''));
      b.addEventListener('click', () => {
        detailPhotoIndex = (idx + dir + detailPhotos.length) % detailPhotos.length;
        renderDetailPhotos();
      });
      return b;
    };
    wrap.append(
      nav(-1, ICON_CHEVRON_L, '前の写真', 'photo-viewer__nav--prev'),
      nav(1, ICON_CHEVRON_R, '次の写真', 'photo-viewer__nav--next'),
      textEl('span', 'photo-viewer__count', `${idx + 1} / ${detailPhotos.length}`),
    );
  }
}

function renderDetail(): void {
  const item = findItem(detailId);
  if (!item) return;

  const cat = categoryName(item.categoryId);
  const catEl = $('detail-category');
  catEl.textContent = cat || '未分類';
  $('detail-name').textContent = item.name;
  const meta: string[] = [];
  if (item.maker) meta.push(item.maker);
  if (item.purchasedAt) {
    const days = daysSince(item.purchasedAt);
    const ago = days === null ? '' : days === 0 ? '（今日）' : `（${days}日前）`;
    meta.push(`${formatDate(item.purchasedAt)}に購入${ago}`);
  }
  $('detail-meta').textContent = meta.join(' ・ ');

  renderDetailPhotos();

  const m = mastery(item.features);
  $('detail-progress-value').textContent = item.features.length ? `${m.pct}%` : '—';
  ($('detail-progress-fill') as HTMLElement).style.width = `${m.pct}%`;
  $('detail-progress-counts').textContent = item.features.length
    ? `使いこなし ${m.mastered} ・ 試した ${m.tried} ・ まだ ${m.todo}`
    : '下の欄から「できること」を登録すると、使いこなし度が表示されます。';

  // できることリスト
  const list = $<HTMLUListElement>('feature-list');
  list.textContent = '';
  if (!item.features.length) {
    list.append(textEl('li', 'feature-list__empty', 'まだ登録されていません。説明書や公式サイトを見ながら追加してみましょう。'));
  }
  item.features.forEach((f) => {
    const li = document.createElement('li');
    li.className = `feature feature--${f.status}`;
    const main = document.createElement('div');
    main.className = 'feature__main';
    main.append(textEl('p', 'feature__text', f.text));
    if (f.note) main.append(textEl('p', 'feature__note', f.note));

    const seg = document.createElement('div');
    seg.className = 'status-seg';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', `${f.text}の状態`);
    (['todo', 'tried', 'mastered'] as FeatureStatus[]).forEach((s) => {
      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = `status-seg__btn status-seg__btn--${s}` + (f.status === s ? ' is-active' : '');
      sb.textContent = STATUS_LABEL[s];
      sb.setAttribute('aria-pressed', String(f.status === s));
      sb.addEventListener('click', () => {
        if (f.status !== s) void setFeatureStatus(item.id, f.id, s, sb);
      });
      seg.append(sb);
    });

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'icon-btn feature__edit';
    edit.setAttribute('aria-label', `${f.text}を編集`);
    edit.append(iconEl(svg(ICON_EDIT, 16), ''));
    edit.addEventListener('click', () => openFeatureEditor(f.id));

    const side = document.createElement('div');
    side.className = 'feature__side';
    side.append(seg, edit);
    li.append(main, side);
    list.append(li);
  });
  const full = item.features.length >= MAX_FEATURES;
  ($('input-feature-new') as HTMLInputElement).disabled = full;
  ($('btn-feature-add') as HTMLButtonElement).disabled = full;

  // 説明書
  const manuals = $<HTMLUListElement>('detail-manuals');
  manuals.textContent = '';
  if (!item.manuals.length) {
    manuals.append(textEl('li', 'manual-links__empty', '「基本情報・写真を編集」から、説明書PDFやサポートページのURLを登録できます。'));
  }
  item.manuals.forEach((mn) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'manual-link';
    a.href = mn.url; // 保存時・読込時に http/https のみに検証済み
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.append(iconEl(svg(ICON_LINK, 18), 'manual-link__icon'), textEl('span', 'manual-link__label', mn.label));
    let host = '';
    try {
      host = new URL(mn.url).hostname;
    } catch {
      host = '';
    }
    if (host) a.append(textEl('span', 'manual-link__host', host));
    li.append(a);
    manuals.append(li);
  });

  $('detail-memo').textContent = item.memo;
  $('detail-memo-section').classList.toggle('hidden', !item.memo);
}

const featureBusy = new Set<string>();

async function setFeatureStatus(itemId: string, featureId: string, status: FeatureStatus, btn?: HTMLButtonElement): Promise<void> {
  const item = findItem(itemId);
  if (!currentUser || !item || featureBusy.has(itemId)) return;
  const features = item.features.map((f) => (f.id === featureId ? { ...f, status } : f));
  featureBusy.add(itemId);
  if (btn) btn.disabled = true;
  try {
    await updateFeatures(currentUser.uid, itemId, features);
    const target = features.find((f) => f.id === featureId);
    if (status === 'mastered') showToast(`「${target?.text ?? ''}」を使いこなし！`);
    else if (status === 'tried') showToast('試した！の記録をつけました');
  } catch {
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    featureBusy.delete(itemId);
    if (btn) btn.disabled = false;
  }
}

async function addFeature(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('input-feature-new');
  const text = input.value.trim().slice(0, MAX_FEATURE_TEXT);
  const item = findItem(detailId);
  if (!text || !item || !currentUser || featureBusy.has(item.id)) {
    if (!text) input.focus();
    return;
  }
  if (item.features.length >= MAX_FEATURES) {
    showToast(`できることは${MAX_FEATURES}件まで登録できます`);
    return;
  }
  const btn = $<HTMLButtonElement>('btn-feature-add');
  featureBusy.add(item.id);
  btn.disabled = true;
  try {
    await updateFeatures(currentUser.uid, item.id, [...item.features, { id: newId(), text, note: '', status: 'todo' }]);
    input.value = '';
    input.focus();
  } catch {
    showToast('追加に失敗しました');
  } finally {
    featureBusy.delete(item.id);
    btn.disabled = false;
  }
}

// ============================================================
// できることの編集
// ============================================================
function openFeatureEditor(featureId: string): void {
  const f = findItem(detailId)?.features.find((x) => x.id === featureId);
  if (!f) return;
  editingFeatureId = featureId;
  ($('input-feature-text') as HTMLInputElement).value = f.text;
  ($('input-feature-note') as HTMLTextAreaElement).value = f.note;
  openOverlay(featureOverlay);
  $<HTMLInputElement>('input-feature-text').focus();
}

async function saveFeature(e: Event): Promise<void> {
  e.preventDefault();
  const item = findItem(detailId);
  const textInput = $<HTMLInputElement>('input-feature-text');
  const text = textInput.value.trim();
  if (!text) {
    showToast('できることを入力してください');
    textInput.focus();
    return;
  }
  if (!item || !currentUser || !editingFeatureId || featureBusy.has(item.id)) return;
  const note = $<HTMLTextAreaElement>('input-feature-note').value.trim();
  const btn = $<HTMLButtonElement>('btn-feature-save');
  featureBusy.add(item.id);
  btn.disabled = true;
  try {
    await updateFeatures(currentUser.uid, item.id, item.features.map((f) => (f.id === editingFeatureId ? { ...f, text, note } : f)));
    closeOverlay(featureOverlay);
    editingFeatureId = null;
  } catch {
    showToast('保存に失敗しました');
  } finally {
    featureBusy.delete(item.id);
    btn.disabled = false;
  }
}

function askDeleteFeature(): void {
  const item = findItem(detailId);
  const f = item?.features.find((x) => x.id === editingFeatureId);
  if (!item || !f) return;
  const featureId = f.id;
  closeOverlay(featureOverlay);
  askConfirm('できることを削除しますか？', `「${f.text}」を削除します。`, async () => {
    const latest = findItem(item.id);
    if (!currentUser || !latest) return;
    await updateFeatures(currentUser.uid, latest.id, latest.features.filter((x) => x.id !== featureId));
    editingFeatureId = null;
    showToast('削除しました');
  });
}

// ============================================================
// 登録・編集
// ============================================================
function fillCategorySelect(selected: string): void {
  categorySelect.textContent = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '未分類';
  categorySelect.append(none);
  categories.forEach((c) => {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name;
    categorySelect.append(o);
  });
  categorySelect.value = categories.some((c) => c.id === selected) ? selected : '';
}

function addManualRow(m: ManualLink = { label: '', url: '' }): void {
  if (manualRows.children.length >= MAX_MANUALS) {
    showToast(`リンクは${MAX_MANUALS}件まで登録できます`);
    return;
  }
  const row = document.createElement('div');
  row.className = 'manual-row';
  const label = document.createElement('input');
  label.type = 'text';
  label.className = 'manual-row__label';
  label.maxLength = 30;
  label.placeholder = '名前（例：取扱説明書）';
  label.value = m.label;
  label.setAttribute('aria-label', 'リンクの名前');
  const url = document.createElement('input');
  url.type = 'url';
  url.className = 'manual-row__url';
  url.maxLength = 500;
  url.placeholder = 'https://';
  url.value = m.url;
  url.inputMode = 'url';
  url.setAttribute('aria-label', 'URL');
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn';
  del.setAttribute('aria-label', 'このリンクを削除');
  del.append(iconEl(svg(ICON_TRASH, 16), ''));
  del.addEventListener('click', () => {
    row.remove();
    updateManualAddBtn();
  });
  row.append(label, url, del);
  manualRows.append(row);
  updateManualAddBtn();
}

function updateManualAddBtn(): void {
  $('btn-manual-add').classList.toggle('hidden', manualRows.children.length >= MAX_MANUALS);
}

function readManuals(): { list: ManualLink[]; invalid: boolean } {
  const list: ManualLink[] = [];
  let invalid = false;
  manualRows.querySelectorAll<HTMLElement>('.manual-row').forEach((row) => {
    const label = (row.querySelector('.manual-row__label') as HTMLInputElement).value.trim();
    const raw = (row.querySelector('.manual-row__url') as HTMLInputElement).value.trim();
    if (!raw && !label) return;
    const url = safeUrl(raw);
    if (!url) {
      invalid = true;
      return;
    }
    list.push({ label: label || '説明書', url });
  });
  return { list, invalid };
}

function renderPhotoPicker(): void {
  photoPicker.querySelectorAll('.photo-picker__item, .photo-picker__loading').forEach((el) => el.remove());
  if (!editorPhotosLoaded) {
    photoPicker.insertBefore(textEl('div', 'photo-picker__loading', '写真を読み込み中…'), photoAdd);
  }
  editorPhotos.forEach((p, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'photo-picker__item';
    const img = document.createElement('img');
    img.src = p;
    img.alt = `写真${i + 1}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'photo-picker__remove';
    del.setAttribute('aria-label', `写真${i + 1}を削除`);
    del.textContent = '×';
    del.addEventListener('click', () => {
      editorPhotos.splice(i, 1);
      editorPhotosChanged = true;
      renderPhotoPicker();
    });
    wrap.append(img, del);
    if (i === 0 && editorPhotos.length > 1) wrap.append(textEl('span', 'photo-picker__main', 'メイン'));
    photoPicker.insertBefore(wrap, photoAdd);
  });
  const full = editorPhotos.length >= MAX_PHOTOS || !editorPhotosLoaded || photoBusy;
  photoAdd.classList.toggle('is-disabled', full);
  photoInput.disabled = full;
  const label = photoAdd.querySelector('span');
  if (label) label.textContent = photoBusy ? '処理中…' : editorPhotos.length >= MAX_PHOTOS ? '最大3枚' : '写真を追加';
}

async function onPhotoSelected(): Promise<void> {
  const files = Array.from(photoInput.files ?? []);
  photoInput.value = '';
  if (!files.length || photoBusy) return;
  const room = MAX_PHOTOS - editorPhotos.length;
  if (room <= 0) return;
  if (files.length > room) showToast(`写真は${MAX_PHOTOS}枚までです。先頭の${room}枚を追加します`);
  photoBusy = true;
  renderPhotoPicker();
  try {
    for (const file of files.slice(0, room)) {
      try {
        const { photo } = await processPhoto(file);
        editorPhotos.push(photo);
        editorPhotosChanged = true;
      } catch (err) {
        showToast(errMessage(err, 'この画像は追加できませんでした'));
      }
    }
  } finally {
    photoBusy = false;
    renderPhotoPicker();
  }
}

function editorState(): string {
  return JSON.stringify([
    nameInput.value, makerInput.value, purchasedInput.value, categorySelect.value, featuresInput.value, memoInput.value,
    Array.from(manualRows.querySelectorAll('input')).map((i) => (i as HTMLInputElement).value),
    editorPhotosChanged,
  ]);
}

function openEditor(id: string | null): void {
  const item = findItem(id);
  editingId = item ? item.id : null;
  editorPhotosChanged = false;
  $('editor-title').textContent = item ? '基本情報・写真を編集' : '買ったものを登録';
  nameInput.value = item?.name ?? '';
  makerInput.value = item?.maker ?? '';
  purchasedInput.value = item ? item.purchasedAt : todayStr();
  purchasedInput.max = todayStr();
  const defaultCat = !item && selectedCategory !== ALL && selectedCategory !== UNCATEGORIZED ? selectedCategory : '';
  fillCategorySelect(item ? item.categoryId : defaultCat);
  featuresField.classList.toggle('hidden', !!item);
  featuresInput.value = '';
  memoInput.value = item?.memo ?? '';
  manualRows.textContent = '';
  (item?.manuals ?? []).forEach((m) => addManualRow(m));
  if (!item) addManualRow();
  updateManualAddBtn();

  if (item && item.photoCount > 0) {
    // 詳細画面で読み込み済みならそれを使う
    if (detailId === item.id && detailPhotos.length) {
      editorPhotos = [...detailPhotos];
      editorPhotosLoaded = true;
    } else {
      editorPhotos = [];
      editorPhotosLoaded = false;
      const uid = currentUser?.uid;
      if (uid) {
        loadPhotos(uid, item.id)
          .then((photos) => {
            if (editingId !== item.id) return;
            editorPhotos = photos;
            editorPhotosLoaded = true;
            renderPhotoPicker();
          })
          .catch(() => {
            showToast('写真を読み込めませんでした。写真以外は編集できます');
            editorPhotosLoaded = true;
            renderPhotoPicker();
          });
      }
    }
  } else {
    editorPhotos = [];
    editorPhotosLoaded = true;
  }
  renderPhotoPicker();
  editorSnapshot = editorState();
  openOverlay(editorOverlay);
  if (!item) nameInput.focus();
}

function requestCloseEditor(): void {
  if (editorBusy) return;
  if (editorState() !== editorSnapshot) openOverlay(discardOverlay);
  else closeEditor();
}

function closeEditor(): void {
  closeOverlay(editorOverlay);
  closeOverlay(discardOverlay);
  editingId = null;
  editorPhotos = [];
}

async function saveEditor(e: Event): Promise<void> {
  e.preventDefault();
  if (editorBusy || !currentUser) return;
  const name = nameInput.value.trim();
  if (!name) {
    showToast('製品名を入力してください');
    nameInput.focus();
    return;
  }
  if (photoBusy || !editorPhotosLoaded) {
    showToast('写真の処理が終わるまでお待ちください');
    return;
  }
  const manuals = readManuals();
  if (manuals.invalid) {
    showToast('URLは https:// から始まる形で入力してください');
    return;
  }

  editorBusy = true;
  editorSaveBtn.disabled = true;
  editorSaveBtn.textContent = '保存中…';
  try {
    const existing = findItem(editingId);
    let thumb = existing?.thumb ?? '';
    if (!existing || editorPhotosChanged) thumb = editorPhotos[0] ? await thumbFromDataUrl(editorPhotos[0]) : '';
    const data: ItemData = {
      name,
      maker: makerInput.value,
      categoryId: categorySelect.value,
      purchasedAt: purchasedInput.value,
      manuals: manuals.list,
      memo: memoInput.value,
      thumb,
      photoCount: existing && !editorPhotosChanged ? existing.photoCount : editorPhotos.length,
    };

    if (existing) {
      await updateItem(currentUser.uid, existing.id, data, editorPhotosChanged ? editorPhotos : null);
      if (editorPhotosChanged && detailId === existing.id) {
        detailPhotos = [...editorPhotos];
        detailPhotoIndex = 0;
      }
      closeEditor();
      showToast('保存しました');
    } else {
      const features: Feature[] = featuresInput.value
        .split('\n')
        .map((t) => t.trim().slice(0, MAX_FEATURE_TEXT))
        .filter(Boolean)
        .slice(0, MAX_FEATURES)
        .map((text) => ({ id: newId(), text, note: '', status: 'todo' as FeatureStatus }));
      const photos = [...editorPhotos];
      const id = await createItem(currentUser.uid, data, features, photos);
      closeEditor();
      showToast('登録しました');
      // 登録した製品の詳細をそのまま開く（写真は手元のものを使う）
      detailId = id;
      detailPhotos = photos;
      detailPhotoIndex = 0;
      if (findItem(id)) renderDetail();
      openOverlay(detailOverlay);
    }
  } catch (err) {
    console.error(err);
    showToast('保存に失敗しました。通信環境を確認してください');
  } finally {
    editorBusy = false;
    editorSaveBtn.disabled = false;
    editorSaveBtn.textContent = '保存する';
  }
}

// ============================================================
// カテゴリ編集
// ============================================================
function openCategoryEditor(): void {
  renderCategoryEditor();
  openOverlay(categoryOverlay);
}

function renderCategoryEditor(): void {
  const list = $<HTMLUListElement>('category-edit-list');
  list.textContent = '';
  if (!categories.length) list.append(textEl('li', 'category-edit__empty', 'カテゴリがありません。下の欄から追加できます。'));
  categories.forEach((c) => {
    const li = document.createElement('li');
    li.className = 'category-edit__row';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 20;
    input.value = c.name;
    input.setAttribute('aria-label', `${c.name}の名前`);
    const commit = async () => {
      const v = input.value.trim();
      if (!currentUser || v === c.name) return;
      if (!v) {
        input.value = c.name;
        return;
      }
      try {
        await renameCategory(currentUser.uid, c.id, v);
        showToast('名前を変更しました');
      } catch {
        input.value = c.name;
        showToast('変更に失敗しました');
      }
    };
    input.addEventListener('change', () => void commit());
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && !ev.isComposing) {
        ev.preventDefault();
        input.blur();
      }
    });
    const count = items.filter((i) => i.categoryId === c.id).length;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'icon-btn is-danger';
    del.setAttribute('aria-label', `${c.name}を削除`);
    del.append(iconEl(svg(ICON_TRASH, 16), ''));
    del.addEventListener('click', () => {
      closeOverlay(categoryOverlay);
      askConfirm(
        'カテゴリを削除しますか？',
        count ? `「${c.name}」を削除します。中の${count}件の製品は「未分類」になります。` : `「${c.name}」を削除します。`,
        async () => {
          if (!currentUser) return;
          const ids = items.filter((i) => i.categoryId === c.id).map((i) => i.id);
          await deleteCategory(currentUser.uid, c.id, ids);
          showToast('カテゴリを削除しました');
        },
      );
    });
    li.append(input, textEl('span', 'category-edit__count', `${count}件`), del);
    list.append(li);
  });
  const full = categories.length >= MAX_CATEGORIES;
  ($('input-category-new') as HTMLInputElement).disabled = full;
  ($('btn-category-add') as HTMLButtonElement).disabled = full;
}

let categoryBusy = false;
async function addCategory(e: Event): Promise<void> {
  e.preventDefault();
  const input = $<HTMLInputElement>('input-category-new');
  const name = input.value.trim();
  if (!name || !currentUser || categoryBusy) return;
  if (categories.some((c) => c.name === name)) {
    showToast('同じ名前のカテゴリがあります');
    return;
  }
  if (categories.length >= MAX_CATEGORIES) {
    showToast(`カテゴリは${MAX_CATEGORIES}個まで作れます`);
    return;
  }
  categoryBusy = true;
  try {
    await createCategory(currentUser.uid, name);
    input.value = '';
  } catch {
    showToast('追加に失敗しました');
  } finally {
    categoryBusy = false;
  }
}

// ============================================================
// 確認ダイアログ（カスタムUI）
// ============================================================
function askConfirm(title: string, text: string, action: () => Promise<void>, okLabel = '削除する'): void {
  $('confirm-dialog-title').textContent = title;
  $('confirm-dialog-text').textContent = text;
  $('btn-confirm-delete').textContent = okLabel;
  confirmAction = action;
  openOverlay(confirmOverlay);
}

async function runConfirm(): Promise<void> {
  const action = confirmAction;
  if (!action) return;
  const btn = $<HTMLButtonElement>('btn-confirm-delete');
  btn.disabled = true;
  try {
    await action();
    confirmAction = null;
    closeOverlay(confirmOverlay);
  } catch {
    showToast('処理に失敗しました。もう一度お試しください');
  } finally {
    btn.disabled = false;
  }
}

// ============================================================
// サンプル
// ============================================================
let samplesBusy = false;
async function addSamples(): Promise<void> {
  if (!currentUser || samplesBusy) return;
  samplesBusy = true;
  const btn = $<HTMLButtonElement>('btn-add-samples');
  btn.disabled = true;
  try {
    for (const s of SAMPLE_ITEMS) {
      const cat = categories.find((c) => c.name === s.categoryName);
      await createItem(
        currentUser.uid,
        { name: s.name, maker: s.maker, categoryId: cat?.id ?? '', purchasedAt: todayStr(), manuals: [], memo: s.memo, thumb: '', photoCount: 0 },
        s.features.map((f) => ({ ...f, id: newId() })),
        [],
      );
    }
    showToast('サンプルを追加しました');
  } catch {
    showToast('追加に失敗しました');
  } finally {
    samplesBusy = false;
    btn.disabled = false;
  }
}

// ============================================================
// 認証
// ============================================================
function startSession(user: User): void {
  currentUser = user;
  loginScreen.classList.add('hidden');
  appEl.classList.remove('hidden');
  $('user-info').classList.remove('hidden');
  const avatar = $<HTMLImageElement>('user-avatar');
  if (user.photoURL) {
    avatar.src = user.photoURL;
    avatar.classList.remove('hidden');
  } else {
    avatar.classList.add('hidden');
  }
  $('user-name').textContent = user.displayName ?? '';

  ensureDefaultCategories(user.uid).catch((err) => console.error(err));
  unsubCategories = subscribeCategories(user.uid, (list) => {
    categories = list;
    render();
    if (categoryOverlay.classList.contains('is-open')) renderCategoryEditor();
  }, (err) => console.error(err));
  unsubItems = subscribeItems(user.uid, (list) => {
    items = list;
    itemsLoaded = true;
    render();
  }, (err) => {
    console.error(err);
    loadingEl.textContent = 'データを読み込めませんでした。ページを再読み込みしてください。';
  });
}

function endSession(): void {
  unsubItems?.();
  unsubCategories?.();
  unsubItems = null;
  unsubCategories = null;
  currentUser = null;
  items = [];
  categories = [];
  itemsLoaded = false;
  itemList.textContent = '';
  loadingEl.classList.remove('hidden');
  loadingEl.textContent = '読み込み中…';
  [detailOverlay, editorOverlay, featureOverlay, categoryOverlay, discardOverlay, confirmOverlay].forEach(closeOverlay);
  detailId = null;
  appEl.classList.add('hidden');
  loginScreen.classList.remove('hidden');
}

// ============================================================
// イベント
// ============================================================
function bindEvents(): void {
  let loginBusy = false;
  $('btn-google-login').addEventListener('click', async () => {
    if (loginBusy) return;
    loginBusy = true;
    try {
      await loginWithGoogle();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        showToast('ログインに失敗しました。ポップアップを許可して再度お試しください');
      }
    } finally {
      loginBusy = false;
    }
  });
  $('btn-logout').addEventListener('click', () => {
    logout().catch(() => showToast('ログアウトに失敗しました'));
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    render();
  });
  sortSelect.value = ['purchased', 'growth', 'new', 'name'].includes(sortKey) ? sortKey : 'purchased';
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value;
    lsSet(SORT_KEY, sortKey);
    render();
  });
  $('btn-clear-filter').addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    selectedCategory = ALL;
    lsSet(CATEGORY_KEY, ALL);
    render();
  });
  $('btn-next-shuffle').addEventListener('click', () => {
    nextSeed++;
    renderNext();
  });

  $('btn-new').addEventListener('click', () => openEditor(null));
  $('btn-empty-new').addEventListener('click', () => openEditor(null));
  $('btn-add-samples').addEventListener('click', () => void addSamples());

  // 詳細
  $('btn-detail-close').addEventListener('click', closeDetail);
  $('btn-detail-edit').addEventListener('click', () => openEditor(detailId));
  $('btn-detail-delete').addEventListener('click', () => {
    const item = findItem(detailId);
    if (!item) return;
    askConfirm('製品を削除しますか？', `「${item.name}」と、写真・できること・メモをすべて削除します。元に戻せません。`, async () => {
      if (!currentUser) return;
      await deleteItem(currentUser.uid, item.id);
      closeDetail();
      showToast('削除しました');
    });
  });
  $('feature-add-form').addEventListener('submit', (e) => void addFeature(e));

  // できることの編集
  $('feature-form').addEventListener('submit', (e) => void saveFeature(e));
  $('btn-feature-close').addEventListener('click', () => closeOverlay(featureOverlay));
  $('btn-feature-cancel').addEventListener('click', () => closeOverlay(featureOverlay));
  $('btn-feature-delete').addEventListener('click', askDeleteFeature);

  // 登録・編集
  editorForm.addEventListener('submit', (e) => void saveEditor(e));
  $('btn-editor-close').addEventListener('click', requestCloseEditor);
  $('btn-editor-cancel').addEventListener('click', requestCloseEditor);
  $('btn-manual-add').addEventListener('click', () => addManualRow());
  photoInput.addEventListener('change', () => void onPhotoSelected());
  $('btn-discard-cancel').addEventListener('click', () => closeOverlay(discardOverlay));
  $('btn-discard-ok').addEventListener('click', closeEditor);

  // カテゴリ
  $('btn-category-close').addEventListener('click', () => closeOverlay(categoryOverlay));
  $('category-add-form').addEventListener('submit', (e) => void addCategory(e));

  // 確認ダイアログ
  $('btn-confirm-cancel').addEventListener('click', () => {
    confirmAction = null;
    closeOverlay(confirmOverlay);
  });
  $('btn-confirm-delete').addEventListener('click', () => void runConfirm());

  // フィードバック
  const fbInput = $<HTMLTextAreaElement>('input-feedback-message');
  const fbSend = $<HTMLButtonElement>('btn-feedback-send');
  $('feedback-btn').addEventListener('click', () => {
    openOverlay(feedbackOverlay);
    fbInput.focus();
  });
  $('btn-feedback-close').addEventListener('click', () => closeOverlay(feedbackOverlay));
  fbSend.addEventListener('click', async () => {
    const msg = fbInput.value.trim();
    if (!msg) {
      showToast('内容を入力してください');
      return;
    }
    if (fbSend.disabled) return;
    fbSend.disabled = true;
    fbSend.textContent = '送信中…';
    const ok = await submitFeedback(msg);
    fbSend.disabled = false;
    fbSend.textContent = '送信する';
    if (ok) {
      fbInput.value = '';
      closeOverlay(feedbackOverlay);
      showToast('送信しました。ありがとうございます！');
    } else {
      showToast('送信に失敗しました。時間をおいてお試しください');
    }
  });

  // 背景クリック・Escで閉じる（編集中のものは確認を挟む）
  const closers: [HTMLElement, () => void][] = [
    [detailOverlay, closeDetail],
    [editorOverlay, requestCloseEditor],
    [featureOverlay, () => closeOverlay(featureOverlay)],
    [categoryOverlay, () => closeOverlay(categoryOverlay)],
    [discardOverlay, () => closeOverlay(discardOverlay)],
    [confirmOverlay, () => { confirmAction = null; closeOverlay(confirmOverlay); }],
    [feedbackOverlay, () => closeOverlay(feedbackOverlay)],
  ];
  closers.forEach(([overlay, close]) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // 一番手前に開いているものだけ閉じる
    const open = [...closers].reverse().find(([o]) => o.classList.contains('is-open'));
    open?.[1]();
  });
}

bindEvents();
onAuthChange((user) => {
  if (user) {
    if (currentUser?.uid !== user.uid) {
      if (currentUser) endSession();
      startSession(user);
    }
  } else if (currentUser) {
    endSession();
  }
});
