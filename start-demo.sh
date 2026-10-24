#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
command -v node >/dev/null || { echo '请先安装 Node.js 22 或更新版本。'; exit 1; }
command -v docker >/dev/null || { echo '请先安装并启动 Docker（含 Compose v2）。'; exit 1; }
node --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)' || { echo '需要 Node.js 22 或更新版本；使用 fnm 时请先激活对应版本。'; exit 1; }
docker compose version >/dev/null 2>&1 || { echo '未检测到 Docker Compose 插件。请安装或更新 Docker Desktop，并在新终端重试 docker compose version。'; exit 1; }
docker info >/dev/null 2>&1 || { echo '无法连接 Docker 引擎。请启动 Docker Desktop，等待其就绪后重试，并检查 docker context show。'; exit 1; }
if [[ ! -f .env ]]; then
  (umask 077; node --input-type=module -e 'import {randomBytes} from "node:crypto";console.log("POSTGRES_PASSWORD="+randomBytes(24).toString("hex"))' > .env)
fi
chmod 644 db/migrations/001_initial.sql
docker compose up -d --wait
npm ci --no-audit --no-fund
npm run catalog:import
printf '\n打开浏览器访问 http://127.0.0.1:3000 ，按 Ctrl+C 停止网页服务。\n\n'
npm start
