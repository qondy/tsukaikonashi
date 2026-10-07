import { FeatureStatus } from './types';

export interface SampleItem {
  name: string;
  maker: string;
  categoryName: string;
  memo: string;
  features: { text: string; note: string; status: FeatureStatus }[];
}

export const SAMPLE_ITEMS: SampleItem[] = [
  {
    name: 'ワイヤレスイヤホン',
    maker: '',
    categoryName: 'ガジェット',
    memo: '通勤とオンライン会議で使う。ケースはカバンの内ポケットが定位置。',
    features: [
      { text: 'ノイズキャンセリングの切り替え', note: '左耳を長押しで切り替え', status: 'mastered' },
      { text: '外音取り込みモード', note: 'レジや駅のアナウンスを聞くときに', status: 'tried' },
      { text: '耳から外すと自動で一時停止', note: '', status: 'tried' },
      { text: '2台の機器に同時接続（マルチポイント）', note: 'PCとスマホを自動で切り替えたい', status: 'todo' },
      { text: 'アプリでイコライザーを調整', note: '', status: 'todo' },
      { text: '置き忘れたときに場所を探す', note: '', status: 'todo' },
    ],
  },
  {
    name: '電気圧力鍋',
    maker: '',
    categoryName: 'キッチン',
    memo: '平日の夕飯を楽にするために購入。',
    features: [
      { text: '圧力調理（カレー・肉じゃが）', note: '', status: 'mastered' },
      { text: '予約調理', note: '朝セットして帰宅時に完成させたい', status: 'todo' },
      { text: '無水調理', note: '', status: 'todo' },
      { text: '低温調理（サラダチキン）', note: '', status: 'todo' },
      { text: '自動メニューでパンをこねる', note: '', status: 'todo' },
    ],
  },
];
