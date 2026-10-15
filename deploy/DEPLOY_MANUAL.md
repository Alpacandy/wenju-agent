# 《问矩》腾讯云 2核4G 服务器【方案 B 独立端口 8888】安全共存实操指南

> **目标主机**：腾讯云 蜂驰型BF1（2核 4GB 内存 / 公网 IP: `42.194.242.124`）  
> **运行策略**：采用**方案 B（新开独立端口 8888）**。  
> **四大硬性指标**：
> 1. **零危害现存业务**：完全不触碰现有项目的配置与端口，内存限制 ≤ 50MB，CPU 限制 ≤ 0.2 核；
> 2. **第三端 API 万能接入**：原生解决客户端跨域 (CORS) 与网络直连阻断；
> 3. **8 分钟阅后即焚**：用户离开或闲置超 8 分钟自动清空，弹出温和提示，不同用户 100% 隔离；
> 4. **秒级加载提速**：Gzip 强压缩（4.48MB 压缩至 1.2MB 传输）+ 30 天强缓存 + Pyodide 按需加载。

---

## 一、 部署前准备：腾讯云控制台放行 8888 端口（只需做一次）

在启动部署前，先在腾讯云放行 8888 端口：
1. 登录 [腾讯云控制台](https://console.cloud.tencent.com/)，进入【轻量应用服务器】或【云服务器 CVM】；
2. 找到实例 `22222`（IP: `42.194.242.124`），点击进入实例详情；
3. 点击【安全组】或【防火墙】标签页，点击【添加规则】：
   - **协议端口**：`TCP:8888`
   - **来源**：`0.0.0.0/0`（允许所有客户端访问）
   - **策略**：`允许`
4. 点击保存，即可完成底层防火墙放行。

---

## 二、 本地打包与上传

### 1. 本地打包（生成最新 8 分钟即焚与加速发布包）
在本地工程根目录下执行：
```bash
node scripts/bundle-static.js
```
产出目录为 `dist/`，总计 131 个文件，体积仅 4.48 MB。

### 2. 上传发布包到服务器
```bash
# 在本地命令行运行（将 root 替换为你的服务器登录用户）：
ssh root@42.194.242.124 "mkdir -p /data/www/teachagent/dist /data/www/teachagent/deploy"
scp -r ./dist/* root@42.194.242.124:/data/www/teachagent/dist/
scp -r ./deploy/* root@42.194.242.124:/data/www/teachagent/deploy/
```

---

## 三、 服务器端启动（二选一，均严格隔离）

### 途径 1：Docker Compose 启动（最推荐，物理锁死 50MB 内存）
如果服务器装有 Docker，这是最安全的部署方式，有 cgroups 硬件级限流保护，绝对不会抢占原项目内存：
```bash
cd /data/www/teachagent/deploy
docker compose up -d
# 或老版本 docker-compose up -d
```
- **内存防护**：`wenju-teachagent` 容器被硬性限制内存上限 50MB，CPU 上限 0.2 核；
- **健康核查**：运行 `docker stats --no-stream`，可看到该容器内存仅占用约 **8MB ~ 12MB**！

### 途径 2：原生 Nginx 托管（如果服务器已装 Nginx）
如果服务器没有 Docker 但已有 Nginx，只需将独立配置文件放入 Nginx 配置目录：
```bash
# 拷贝独立配置文件到 Nginx 配置目录（绝不改动已有的任何站点配置文件）
cp /data/www/teachagent/deploy/nginx-teachagent.conf /etc/nginx/conf.d/wenju-teachagent.conf

# 严格执行配置检查（语法无误才继续）
nginx -t

# 零断流平滑重载（原项目的现有连接完全不受影响）
nginx -s reload
```

---

## 四、 必备功能实测验证

### 1. 访问系统
在浏览器打开：
👉 `http://42.194.242.124:8888/`

### 2. 第三方大模型 API 灵活接入测试
- **场景 A（支持 CORS 的 API，如 DeepSeek 原厂端点）**：
  - 点击界面右上角齿轮（`⚙`），直接填入 BaseURL（如 `https://api.deepseek.com/v1`）与 API Key，前端直连，速度快且不耗费服务器流量。
- **场景 B（无 CORS 或存在网络阻断的第三方 API）**：
  - 在 BaseURL 中填入我们预设的反代端点：
    `http://42.194.242.124:8888/api/proxy/https://<目标第三方API域名>/v1`
  - 流量通过 Nginx 服务端流式透传，解决浏览器 CORS 跨域限制，且 Nginx 单 Token 流式代理内存开销极低。

### 3. 8 分钟会话超时与温和归位提示验证
- 用户正常对话时，任意键盘输入或鼠标交互都会实时刷新活跃时间；
- 若闲置或切换标签离开超过 8 分钟，界面将自动归位全新会话并提示：
  `“检测到您已离开超过 8 分钟，为保护隐私已自动归位全新探究任务”`
  有效避免用户产生“网页崩溃或死锁”的误解。

### 4. 加载提速实操验证
- 打开浏览器 F12 -> Network 选项卡：
  - 静态资源全部以 `Content-Encoding: gzip` 传输，实际网络传输下载体积仅约 **1.2 MB**；
  - 刷新网页测试，所有静态 JS/CSS 显示 `200 (from disk cache)`，二次加载直接命中本地磁盘缓存。

---

## 五、 一键回滚与卸载（1 秒恢复）

若你需要停止或卸载本项目，只需一条命令：
- **Docker 模式**：`docker stop wenju-teachagent && docker rm wenju-teachagent`
- **Nginx 模式**：`rm -f /etc/nginx/conf.d/wenju-teachagent.conf && nginx -s reload`

宿主机上已有的原项目没有任何配置文件被修改，保持绝对纯净。
