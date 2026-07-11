#!/bin/bash
set -e
echo "=== Atlas Sprint 003 — Full Verification ==="
echo ""

echo "[1/6] npm install"
npm install
echo ""

echo "[2/6] Prisma generate"
npx prisma generate
echo ""

echo "[3/6] TypeScript type-check"
npm run type-check
echo ""

echo "[4/6] ESLint"
npm run lint
echo ""

echo "[5/6] Prettier format check"
npm run format:check
echo ""

echo "[6/6] Next.js production build"
npm run build
echo ""

echo "=== ALL CHECKS PASSED ==="
