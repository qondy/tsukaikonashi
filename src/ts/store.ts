import {
  collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { Category, Feature, FeatureStatus, Item, ItemData, ManualLink } from './types';
import { isSafeImageDataUrl, MAX_PHOTO_CHARS, MAX_THUMB_CHARS } from './image';

export const MAX_NAME = 60;
export const MAX_MAKER = 40;
export const MAX_MEMO = 2000;
export const MAX_FEATURES = 60;
export const MAX_FEATURE_TEXT = 80;
export const MAX_FEATURE_NOTE = 300;
export const MAX_MANUALS = 5;
export const MAX_MANUAL_LABEL = 30;
export const MAX_URL = 500;
export const MAX_PHOTOS = 3;
export const MAX_CATEGORY_NAME = 20;
export const MAX_CATEGORIES = 30;

const DEFAULT_CATEGORIES = ['家電', 'ガジェット', 'キッチン', '生活雑貨', 'アウトドア', '趣味'];

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const msOrNull = (v: unknown): number | null => (typeof v === 'number' && v > 0 ? v : null);
const STATUSES: FeatureStatus[] = ['todo', 'tried', 'mastered'];

/** http/https のURLだけを許可する（javascript: などを弾く） */
export function safeUrl(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > MAX_URL) return '';
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch {
    return '';
  }
}

export function safeDate(v: unknown): string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normFeatures(v: unknown): Feature[] {
  if (!Array.isArray(v)) return [];
  const out: Feature[] = [];
  v.forEach((f) => {
    if (!f || typeof f !== 'object' || out.length >= MAX_FEATURES) return;
    const o = f as Record<string, unknown>;
    const text = str(o.text, MAX_FEATURE_TEXT).trim();
    if (!text) return;
    const status = STATUSES.includes(o.status as FeatureStatus) ? (o.status as FeatureStatus) : 'todo';
    out.push({ id: str(o.id, 20) || newId(), text, note: str(o.note, MAX_FEATURE_NOTE), status });
  });
  return out;
}

function normManuals(v: unknown): ManualLink[] {
  if (!Array.isArray(v)) return [];
  const out: ManualLink[] = [];
  v.forEach((m) => {
    if (!m || typeof m !== 'object' || out.length >= MAX_MANUALS) return;
    const o = m as Record<string, unknown>;
    const url = safeUrl(o.url);
    if (!url) return;
    out.push({ label: str(o.label, MAX_MANUAL_LABEL).trim() || '説明書', url });
  });
  return out;
}

function sanitize(data: ItemData): ItemData {
  return {
    name: data.name.trim().slice(0, MAX_NAME),
    maker: data.maker.trim().slice(0, MAX_MAKER),
    categoryId: data.categoryId.slice(0, 40),
    purchasedAt: safeDate(data.purchasedAt),
    manuals: normManuals(data.manuals),
    memo: data.memo.slice(0, MAX_MEMO),
    thumb: isSafeImageDataUrl(data.thumb, MAX_THUMB_CHARS) ? data.thumb : '',
    photoCount: Math.max(0, Math.min(MAX_PHOTOS, Math.floor(data.photoCount) || 0)),
  };
}

// ============================================================
// Items
// ============================================================
const itemsCol = (uid: string) => collection(db, 'users', uid, 'items');
const itemDoc = (uid: string, id: string) => doc(db, 'users', uid, 'items', id);
const photosDoc = (uid: string, id: string) => doc(db, 'users', uid, 'itemPhotos', id);

export function subscribeItems(
  uid: string,
  onData: (list: Item[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(itemsCol(uid), (snap) => {
    const list: Item[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_NAME).trim();
      if (!createdAt || !name) return;
      list.push({
        id: d.id,
        name,
        maker: str(data.maker, MAX_MAKER),
        categoryId: str(data.categoryId, 40),
        purchasedAt: safeDate(data.purchasedAt),
        manuals: normManuals(data.manuals),
        memo: str(data.memo, MAX_MEMO),
        thumb: isSafeImageDataUrl(data.thumb, MAX_THUMB_CHARS) ? data.thumb : '',
        photoCount: typeof data.photoCount === 'number' ? Math.max(0, Math.min(MAX_PHOTOS, Math.floor(data.photoCount))) : 0,
        features: normFeatures(data.features),
        createdAt,
        updatedAt: msOrNull(data.updatedAt) ?? createdAt,
      });
    });
    onData(list);
  }, onError);
}

/** 製品を作成し、写真があれば別ドキュメントに保存する */
export async function createItem(uid: string, data: ItemData, features: Feature[], photos: string[]): Promise<string> {
  const now = Date.now();
  const ref = doc(itemsCol(uid));
  const batch = writeBatch(db);
  const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
  batch.set(ref, {
    ...sanitize({ ...data, photoCount: clean.length }),
    features: normFeatures(features),
    createdAt: now,
    updatedAt: now,
  });
  if (clean.length) batch.set(photosDoc(uid, ref.id), { photos: clean });
  await batch.commit();
  return ref.id;
}

/** 基本情報と写真をまとめて更新する（photos が null のときは写真に触らない） */
export async function updateItem(uid: string, id: string, data: ItemData, photos: string[] | null): Promise<void> {
  const batch = writeBatch(db);
  if (photos) {
    const clean = photos.filter((p) => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
    batch.update(itemDoc(uid, id), { ...sanitize({ ...data, photoCount: clean.length }), updatedAt: Date.now() });
    if (clean.length) batch.set(photosDoc(uid, id), { photos: clean });
    else batch.delete(photosDoc(uid, id));
  } else {
    batch.update(itemDoc(uid, id), { ...sanitize(data), updatedAt: Date.now() });
  }
  await batch.commit();
}

export function updateFeatures(uid: string, id: string, features: Feature[]): Promise<void> {
  return updateDoc(itemDoc(uid, id), { features: normFeatures(features), updatedAt: Date.now() });
}

export async function deleteItem(uid: string, id: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(itemDoc(uid, id));
  batch.delete(photosDoc(uid, id));
  await batch.commit();
}

export async function loadPhotos(uid: string, id: string): Promise<string[]> {
  const snap = await getDoc(photosDoc(uid, id));
  if (!snap.exists()) return [];
  const photos = snap.data().photos;
  if (!Array.isArray(photos)) return [];
  return photos.filter((p): p is string => isSafeImageDataUrl(p, MAX_PHOTO_CHARS)).slice(0, MAX_PHOTOS);
}

// ============================================================
// Categories
// ============================================================
const categoriesCol = (uid: string) => collection(db, 'users', uid, 'categories');
const metaDoc = (uid: string) => doc(db, 'users', uid, 'meta', 'profile');

export function subscribeCategories(
  uid: string,
  onData: (list: Category[]) => void,
  onError: (err: Error) => void,
): () => void {
  return onSnapshot(categoriesCol(uid), (snap) => {
    const list: Category[] = [];
    snap.forEach((d) => {
      const data = d.data();
      const createdAt = msOrNull(data.createdAt);
      const name = str(data.name, MAX_CATEGORY_NAME).trim();
      if (!createdAt || !name) return;
      list.push({ id: d.id, name, createdAt });
    });
    list.sort((a, b) => a.createdAt - b.createdAt);
    onData(list);
  }, onError);
}

/** 初回ログイン時だけ、よく使うカテゴリを用意しておく（全部消した後に復活させないようフラグで管理） */
export async function ensureDefaultCategories(uid: string): Promise<void> {
  const meta = await getDoc(metaDoc(uid));
  if (meta.exists() && meta.data().categoriesSeeded === true) return;
  const batch = writeBatch(db);
  const now = Date.now();
  DEFAULT_CATEGORIES.forEach((name, i) => {
    batch.set(doc(categoriesCol(uid)), { name, createdAt: now + i });
  });
  batch.set(metaDoc(uid), { categoriesSeeded: true }, { merge: true });
  await batch.commit();
}

export async function createCategory(uid: string, name: string): Promise<string> {
  const ref = await addDoc(categoriesCol(uid), { name: name.trim().slice(0, MAX_CATEGORY_NAME), createdAt: Date.now() });
  return ref.id;
}

export function renameCategory(uid: string, id: string, name: string): Promise<void> {
  return updateDoc(doc(db, 'users', uid, 'categories', id), { name: name.trim().slice(0, MAX_CATEGORY_NAME) });
}

/** カテゴリを削除し、中の製品は未分類に戻す（製品自体は消さない） */
export async function deleteCategory(uid: string, id: string, itemIds: string[]): Promise<void> {
  for (let i = 0; i < itemIds.length; i += 400) {
    const batch = writeBatch(db);
    itemIds.slice(i, i + 400).forEach((iid) => batch.update(itemDoc(uid, iid), { categoryId: '' }));
    await batch.commit();
  }
  await deleteDoc(doc(db, 'users', uid, 'categories', id));
}
