export type FeatureStatus = 'todo' | 'tried' | 'mastered';

export interface Feature {
  id: string;
  text: string;
  note: string;
  status: FeatureStatus;
}

export interface ManualLink {
  label: string;
  url: string;
}

/** 製品の基本情報（写真の本体は別ドキュメント。一覧の読み込みを軽くするため） */
export interface ItemData {
  name: string;
  maker: string;
  categoryId: string; // '' は未分類
  purchasedAt: string; // 'YYYY-MM-DD' または ''
  price: number | null; // 円（税込みなど自由）。未入力は null
  manuals: ManualLink[];
  memo: string;
  thumb: string; // 一覧用の小さな写真（data URL）または ''
  photoCount: number;
}

export interface Item extends ItemData {
  id: string;
  features: Feature[];
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  createdAt: number;
}
