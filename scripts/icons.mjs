// 앱 아이콘 생성: 회사 로고의 S 마크(public/brand/s-mark.png — 로고 원본에서 오려 낸 204×304)를
// 흰 타일 가운데에 놓아 파비콘·아이폰·안드로이드 아이콘을 만든다.
//   node scripts/icons.mjs
// 출력: app/icon.png(512, 둥근 타일), public/favicon.ico(16·32·48), public/apple-touch-icon*.png(180),
//       public/icons/icon-192.png·icon-512.png·maskable-512.png
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire(import.meta.url);
// sharp는 next의 선택 의존성 — next 위치에서 찾는다 (직접 의존성으로 추가하지 않아도 됨)
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const SRC = "public/brand/s-mark.png";

/**
 * 흰 타일 위 S 마크.
 * rx: 모서리 둥글기(512 기준, 0 = 꽉 찬 사각형) · scale: 마크 높이 / 타일 (마스커블은 안전 영역 때문에 작게)
 * opaque: 투명 없이 (아이폰·안드로이드 아이콘)
 */
async function tile(size, { rx = 0, scale = 0.7, opaque = true } = {}) {
  const h = Math.round(size * scale);
  const mark = await sharp(SRC).resize({ height: h, kernel: "lanczos3" }).png().toBuffer();
  const { width: w } = await sharp(mark).metadata();
  const r = Math.round((rx * size) / 512);
  const bg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${r}" fill="#ffffff"/></svg>`;
  let img = sharp(Buffer.from(bg)).composite([{ input: mark, left: Math.round((size - w) / 2), top: Math.round((size - h) / 2) }]);
  if (opaque) img = img.flatten({ background: "#ffffff" });
  return img.png().toBuffer();
}

/** PNG 여러 장을 ICO 하나로 (PNG 압축 ICO — 모든 최신 브라우저·윈도우가 읽는다) */
function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, buf }, i) => {
    const e = 6 + i * 16;
    head[e] = size === 256 ? 0 : size; head[e + 1] = size === 256 ? 0 : size; head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(buf.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += buf.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.buf)]);
}

// 파비콘: 둥근 흰 타일 (브라우저 탭) — 작은 크기는 마크를 조금 크게
writeFileSync("app/icon.png", await tile(512, { rx: 96, opaque: false }));
writeFileSync("public/favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, buf: await tile(size, { rx: 96, scale: 0.78, opaque: false }) })))));
// 아이폰: 꽉 찬 사각형 (iOS가 모서리를 깎는다), 투명 없음
const apple = await tile(180);
writeFileSync("public/apple-touch-icon.png", apple);
writeFileSync("public/apple-touch-icon-precomposed.png", apple);
// 안드로이드: 일반 아이콘은 꽉 찬 사각형, 마스커블은 안전 영역(가운데 80%) 안에 마크
writeFileSync("public/icons/icon-192.png", await tile(192));
writeFileSync("public/icons/icon-512.png", await tile(512));
writeFileSync("public/icons/maskable-512.png", await tile(512, { scale: 0.52 }));
console.log("아이콘 생성 완료");
