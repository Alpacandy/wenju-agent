#!/usr/bin/env bash
# ==============================================================================
# 《问矩》端口 8888 与环境安全独立预检探针 (只读命令 · 绝对 0 写入 · 0 影响)
# ==============================================================================

PORT=${1:-8888}
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}>>> 问矩 · 端口与宿主机环境安全探针 (Port: ${PORT}) <<<${NC}"
echo -e "${BLUE}================================================================${NC}"

# 1. 端口占用探测
echo -e "\n${YELLOW}[1] 探测端口 ${PORT} 当前网络监听状态...${NC}"
OCCUPIED=""
if command -v ss >/dev/null 2>&1; then
  OCCUPIED=$(ss -tlpn "sport = :${PORT}" 2>/dev/null | grep -v 'Local Address' || true)
elif command -v netstat >/dev/null 2>&1; then
  OCCUPIED=$(netstat -tlpn 2>/dev/null | grep -w ":${PORT}" || true)
elif command -v lsof >/dev/null 2>&1; then
  OCCUPIED=$(lsof -i ":${PORT}" 2>/dev/null || true)
fi

if [ -z "$OCCUPIED" ]; then
  echo -e "${GREEN}  ✓ 端口 ${PORT} 处于完全空闲状态！${NC}"
  echo -e "${GREEN}  ✓ 可以安全用于《问矩》Nginx 独立部署，对现有任何其他服务均无碰撞风险。${NC}"
else
  echo -e "${RED}  ! 端口 ${PORT} 已被占用，占用信息如下:${NC}"
  echo "$OCCUPIED"
  if echo "$OCCUPIED" | grep -iq "nginx"; then
    echo -e "${YELLOW}  ℹ 占用进程为 Nginx。若为已部署的问矩旧版本，可通过 nginx -s reload 平滑升级。${NC}"
  else
    echo -e "${RED}  ⚠ 占用进程非 Nginx（可能是现有的其他关键服务）！${NC}"
    echo -e "${RED}  建议：请勿占用该端口！请在 deploy/nginx-teachagent.conf 中将 8888 更换为其他空闲端口（例如 8889 或 8899）。${NC}"
  fi
fi

# 2. 宿主机现有高频业务端口概览 (80, 443, 3306, 6379, 8080 等)
echo -e "\n${YELLOW}[2] 检查宿主机当前运行中的主要业务端口...${NC}"
if command -v ss >/dev/null 2>&1; then
  ss -tlpn | grep -E ':(80|443|3306|6379|8080|9000)' || echo "  (无标准预留端口占用)"
elif command -v netstat >/dev/null 2>&1; then
  netstat -tlpn | grep -E ':(80|443|3306|6379|8080|9000)' || echo "  (无标准预留端口占用)"
fi

# 3. 内存与负载核验
echo -e "\n${YELLOW}[3] 宿主机内存余量核查...${NC}"
free -m

echo -e "\n${BLUE}================================================================${NC}"
echo -e "${GREEN}探针检测完成。此探针为纯只读命令，未对系统做出任何变更。${NC}"
echo -e "${BLUE}================================================================${NC}"
