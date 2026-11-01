export type FeatureStatus = 'todo' | 'tried' | 'mastered';

export interface Feature {
  id: string;
  text: string;
  note: string;
  status: FeatureStatus;
}

/** お手入れ・メンテナンスの項目。intervalDays=0 は「気づいたときに」（時期の通知なし） */
export interface CareTask {
  id: string;
  text: string;
  note: string; // やり方・使う道具など
  intervalDays: number;
  lastDoneAt: string; // 'YYYY-MM-DD' または ''（まだ一度もやっていない）
  doneCount: number;
}

/** リンクの種類。product=商品ページ（既定） / manual=取扱説明書 */
export type LinkKind = 'product' | 'manual';

export interface ManualLink {
  kind: LinkKind;
  label: string; // '' のときは種類名で表示する
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
  care: CareTask[];
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: string;
  name: string;
  createdAt: number;
}
