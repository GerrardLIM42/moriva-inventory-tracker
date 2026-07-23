/**
 * MORIVA 쿠팡 재고 자동 수집 스크립트 (GitHub Actions용)
 * ------------------------------------------------------
 * Node.js 내장 crypto 모듈을 사용합니다 (Worker와 달리 여기선 Node 런타임이라 가능).
 * 실행: node scripts/collect-inventory.mjs
 *
 * 필요한 환경변수 (GitHub Secrets에서 주입됨):
 *   COUPANG_ACCESS_KEY
 *   COUPANG_SECRET_KEY
 *   COUPANG_VENDOR_ID
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const API_HOST = "https://api-gateway.coupang.com";
const DATA_DIR = path.resolve("data");

// ---------- 1. HMAC 서명 ----------

function getCoupangDatetime() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function buildAuthorizationHeader({ method, urlPath, query, accessKey, secretKey }) {
  const datetime = getCoupangDatetime();
  const message = `${datetime}${method}${urlPath}${query}`;
  const signature = crypto.createHmac("sha256", secretKey).update(message).digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`;
}

async function callCoupangApi(method, urlPath, queryObj = {}) {
  const accessKey = process.env.COUPANG_ACCESS_KEY;
  const secretKey = process.env.COUPANG_SECRET_KEY;
  const vendorId = process.env.COUPANG_VENDOR_ID;

  if (!accessKey || !secretKey || !vendorId) {
    throw new Error("환경변수 COUPANG_ACCESS_KEY / COUPANG_SECRET_KEY / COUPANG_VENDOR_ID 가 설정되지 않았습니다.");
  }

  const query = new URLSearchParams(queryObj).toString();
  const authorization = buildAuthorizationHeader({
    method,
    urlPath,
    query,
    accessKey,
    secretKey,
  });

  const url = `${API_HOST}${urlPath}${query ? "?" + query : ""}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: authorization,
      "X-Requested-By": vendorId,
      "Content-Type": "application/json;charset=UTF-8",
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`쿠팡 API 오류 [${res.status}] ${urlPath}: ${errText}`);
  }
  return res.json();
}

// ---------- 2. 상품/재고 조회 ----------

async function fetchSellerProducts(vendorId, nextToken = null) {
  const urlPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products`;
  return callCoupangApi("GET", urlPath, {
    vendorId,
    maxPerPage: "50",
    ...(nextToken ? { token: nextToken } : {}),
  });
}

async function fetchSellerProductDetail(sellerProductId) {
  const urlPath = `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/${sellerProductId}`;
  return callCoupangApi("GET", urlPath);
}

// ---------- 3. 날짜 유틸 (KST 기준) ----------

function todayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function yesterdayKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000 - 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

// ---------- 4. 메인 로직 ----------

async function main() {
  const vendorId = process.env.COUPANG_VENDOR_ID;
  await fs.mkdir(DATA_DIR, { recursive: true });

  const today = todayKST();
  const yesterday = yesterdayKST();

  // 4-1. 전체 상품 목록 페이징 수집
  const allOptions = [];
  let nextToken = null;
  do {
    const page = await fetchSellerProducts(vendorId, nextToken);
    const items = page.data ?? [];

    for (const product of items) {
      const detail = await fetchSellerProductDetail(product.sellerProductId);
      // ⚠️ 실제 응답을 한 번 콘솔로 찍어보고 필드명이 다르면 아래 매핑을 조정하세요.
      for (const option of detail.data?.items ?? []) {
        allOptions.push({
          sellerProductId: product.sellerProductId,
          vendorItemId: option.vendorItemId,
          itemName: option.itemName ?? product.sellerProductName ?? "",
          stockQuantity: option.maximumBuyCount ?? option.stockQuantity ?? null,
          salePrice: option.salePrice ?? null,
        });
      }
    }
    nextToken = page.nextToken || null;
  } while (nextToken);

  // 4-2. 오늘자 스냅샷 저장
  const todaySnapshotPath = path.join(DATA_DIR, `snapshot-${today}.json`);
  await fs.writeFile(todaySnapshotPath, JSON.stringify(allOptions, null, 2), "utf-8");

  // 4-3. 어제자 스냅샷과 비교
  const yesterdaySnapshotPath = path.join(DATA_DIR, `snapshot-${yesterday}.json`);
  let prevMap = new Map();
  try {
    const prevRaw = await fs.readFile(yesterdaySnapshotPath, "utf-8");
    for (const row of JSON.parse(prevRaw)) {
      prevMap.set(row.vendorItemId, row.stockQuantity);
    }
  } catch {
    console.log(`전일(${yesterday}) 스냅샷이 없어 이번 회차는 판매량 추정 없이 기록만 합니다.`);
  }

  const report = allOptions.map((row) => {
    const prevStock = prevMap.has(row.vendorItemId) ? prevMap.get(row.vendorItemId) : null;
    const estimatedSold =
      typeof prevStock === "number" && typeof row.stockQuantity === "number"
        ? Math.max(prevStock - row.stockQuantity, 0)
        : null;
    return { ...row, prevStock, estimatedSold, date: today };
  });

  // 4-4. 날짜별 리포트 + 대시보드가 바로 읽을 최신 리포트 저장
  const reportPath = path.join(DATA_DIR, `report-${today}.json`);
  const latestReportPath = path.join(DATA_DIR, `report-latest.json`);
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  await fs.writeFile(latestReportPath, JSON.stringify(report, null, 2), "utf-8");

  console.log(`완료: 상품 옵션 ${allOptions.length}개 수집, ${today} 리포트 저장됨.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
