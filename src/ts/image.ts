// 写真はブラウザ側で縮小し、JPEGのdata URLとしてFirestoreに保存する
// （Cloud Storage は新規プロジェクトだと有料プランが必要なため使わない）

/** 写真1枚あたりの上限（data URLの文字数）。3枚でもFirestoreの1MiB制限に収まる */
export const MAX_PHOTO_CHARS = 280_000;
export const MAX_THUMB_CHARS = 40_000;

const DATA_URL_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

export function isSafeImageDataUrl(v: unknown, max: number): v is string {
  return typeof v === 'string' && v.length <= max && DATA_URL_RE.test(v);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('この画像は読み込めませんでした'));
    };
    img.src = url;
  });
}

function draw(img: HTMLImageElement, maxSide: number, quality: number): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を処理できませんでした');
  // 透過PNGが黒くならないよう白で塗ってから描く
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

/** 上限サイズに収まるまで画質→解像度の順に落として圧縮する */
function compress(img: HTMLImageElement, maxSide: number, maxChars: number): string {
  let side = maxSide;
  for (let attempt = 0; attempt < 6; attempt++) {
    for (const q of [0.8, 0.68, 0.56]) {
      const url = draw(img, side, q);
      if (url.length <= maxChars) return url;
    }
    side = Math.round(side * 0.8);
  }
  throw new Error('画像を十分に小さくできませんでした');
}

export async function processPhoto(file: File): Promise<{ photo: string; thumb: string }> {
  if (!file.type.startsWith('image/')) throw new Error('画像ファイルを選んでください');
  const img = await loadImage(file);
  return {
    photo: compress(img, 1200, MAX_PHOTO_CHARS),
    thumb: compress(img, 320, MAX_THUMB_CHARS),
  };
}

/** 保存済みの写真から一覧用サムネイルを作り直す（先頭の写真を消したとき用） */
export async function thumbFromDataUrl(dataUrl: string): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('画像を読み込めませんでした'));
    el.src = dataUrl;
  });
  return compress(img, 320, MAX_THUMB_CHARS);
}
