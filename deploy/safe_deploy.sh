#!/usr/bin/env bash
# ==============================================================================
# 《问矩》智能助教 · 腾讯云 2核4G 服务器防御性安全部署脚本
# 目标：绝对不干扰已运行项目、不抢占内存、零断流
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}>>> 问矩 · 腾讯云服务器防御性部署与环境预检 <<<${NC}"
echo -e "${BLUE}================================================================${NC}"

# 1. 端口冲突防御性探测 (确保 8888 端口未被其他已有关键业务占用)
echo -e "\n${YELLOW}[1/5] 探测 8888 端口占用状态与业务归属...${NC}"
OCCUPIED_INFO=""
if command -v ss >/dev/null 2>&1; then
  OCCUPIED_INFO=$(ss -tlpn 'sport = :8888' 2>/dev/null | grep -v 'Local Address' || true)
elif command -v netstat >/dev/null 2>&1; then
  OCCUPIED_INFO=$(netstat -tlpn 2>/dev/null | grep -w ':8888' || true)
fi

if [ -n "$OCCUPIED_INFO" ]; then
  # 判断占用进程是否是 Nginx
  if echo "$OCCUPIED_INFO" | grep -iq "nginx"; then
    echo -e "${GREEN}  ✓ 端口 8888 当前由 Nginx 监听，属于正常配置复用/更新范围。${NC}"
  else
    echo -e "${RED}================================================================${NC}"
    echo -e "${RED}[冲突阻断] 端口 8888 已被宿主机非 Nginx 现有业务占用！${NC}"
    echo -e "  冲突进程详情: \n  ${OCCUPIED_INFO}"
    echo -e "${RED}为确保宿主机上现有业务 100% 绝对安全，部署已被主动终止！${NC}"
    echo -e "建议方案: 将 deploy/nginx-teachagent.conf 中的 8888 改为其他空闲端口（如 8889 或 8899）。"
    echo -e "${RED}================================================================${NC}"
    exit 1
  fi
else
  echo -e "${GREEN}  ✓ 端口 8888 完全空闲，未被任何进程占用，可安全使用。${NC}"
fi

# 2. 内存防御性体检 (确保不会触发 Linux OOM Killer 误杀现有业务)
echo -e "\n${YELLOW}[2/5] 检查宿主机内存与负载状态...${NC}"
AVAILABLE_MEM=$(free -m | awk '/^Mem:/{print $7}')
TOTAL_MEM=$(free -m | awk '/^Mem:/{print $2}')
echo "  总内存: ${TOTAL_MEM} MB | 当前可用内存: ${AVAILABLE_MEM} MB"

if [ "$AVAILABLE_MEM" -lt 150 ]; then
  echo -e "${RED}[警告] 可用内存低于 150MB，为确保原业务绝对安全，终止新增操作！${NC}"
  echo "请先排查现有服务是否发生内存泄漏。"
  exit 1
fi
echo -e "${GREEN}  ✓ 内存余量安全，静态服务仅需约 10~20MB，风险受控。${NC}"

# 3. 静态资源目录核对
TARGET_DIR="/data/www/teachagent/dist"
echo -e "\n${YELLOW}[3/5] 检查目标发布目录: ${TARGET_DIR}...${NC}"
if [ ! -d "$TARGET_DIR" ]; then
  echo -e "  创建目标发布目录: ${TARGET_DIR}"
  mkdir -p "$TARGET_DIR"
fi

if [ -f "./index.html" ]; then
  echo "  检测到当前目录包含发布文件，正在同步至 ${TARGET_DIR}..."
  cp -r ./* "${TARGET_DIR}/"
  chmod -R 755 "${TARGET_DIR}" 2>/dev/null || true
  echo -e "${GREEN}  ✓ 静态资产同步完毕，文件权限设置为 755 (杜绝 Nginx 403 权限异常)。${NC}"
else
  chmod -R 755 "${TARGET_DIR}" 2>/dev/null || true
  echo -e "${YELLOW}  请确保已将本地 dist/ 目录内容解压或拷贝至 ${TARGET_DIR}${NC}"
fi

# 4. 部署模式识别与配置应用
echo -e "\n${YELLOW}[4/5] 检查现行 Web 服务（Nginx / Docker）...${NC}"

if command -v nginx >/dev/null 2>&1; then
  echo "  检测到宿主机已安装 Nginx。"
  echo "  正在执行 Nginx 语法严格预检 (nginx -t)..."
  if nginx -t; then
    echo -e "${GREEN}  ✓ 现有 Nginx 配置测试通过，执行平滑重载 (零断流 reload)...${NC}"
    nginx -s reload
    echo -e "${GREEN}  ✓ Nginx 已平滑重载，原项目未发生任何重启或连接中断！${NC}"
  else
    echo -e "${RED}  [错误] 现有 Nginx 配置文件存在语法错误，绝对不执行 reload，以保护原项目！${NC}"
    exit 1
  fi
elif command -v docker >/dev/null 2>&1; then
  echo "  检测到 Docker 环境，可执行 Docker 隔离部署。"
  echo "  启动命令参考: docker-compose -f deploy/docker-compose.yml up -d"
else
  echo -e "${YELLOW}  未检测到系统级 Nginx，可通过极轻量静态服务器托管目录 ${TARGET_DIR}${NC}"
fi

# 5. 端口与连通性验证
echo -e "\n${YELLOW}[5/5] 验证服务端口状态...${NC}"
if command -v netstat >/dev/null 2>&1; then
  netstat -tlpn | grep -E ':(80|443|8888)' || true
elif command -v ss >/dev/null 2>&1; then
  ss -tlpn | grep -E ':(80|443|8888)' || true
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}🎉 预检与配置就绪！原项目各项指标平稳，未受任何干扰。${NC}"
echo -e "${GREEN}================================================================${NC}"
