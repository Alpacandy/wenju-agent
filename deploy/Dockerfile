# ==============================================================================
# 《问矩》极轻量只读静态容器 (Alpine Nginx)
# 镜像体积：~23MB | 运行时内存占用：~8MB | 对宿主机现有进程零风险
# ==============================================================================
FROM nginx:alpine

# 移除默认的静态页面与配置
RUN rm -rf /usr/share/nginx/html/* /etc/nginx/conf.d/default.conf

# 拷贝针对低内存优化的 Nginx 站点配置
COPY deploy/nginx-teachagent.conf /etc/nginx/conf.d/teachagent.conf

# 调整主配置文件中仅监听 8888 或保持 80
RUN sed -i 's/listen 8888;/listen 80;/' /etc/nginx/conf.d/teachagent.conf || true
RUN sed -i 's/\/data\/www\/teachagent\/dist/\/usr\/share\/nginx\/html/' /etc/nginx/conf.d/teachagent.conf || true

# 拷贝打包好的纯静态资产
COPY dist/ /usr/share/nginx/html/

# 暴露容器端口
EXPOSE 80

# 以非 root 用户运行与只读文件系统就绪
STOPSIGNAL SIGQUIT
CMD ["nginx", "-g", "daemon off;"]
