# Deploy artifacts

> 部署相关的反代/反向代理/服务器配置模板,不算业务代码。

## 目录

- `nginx.ziyun.pudafo.com.conf` — 字·韵当前域名的 Nginx 配置
  - HTTPS (Let's Encrypt 路径)
  - WebSocket / 500M body / 静态 1 年缓存 / /api/auth & /api/init 限流
  - 已留好 Cloudflare / 阿里云 CDN 真实 IP 段的位置(默认注释)

## 部署流程

1. 服务器先解包 Up.zip,装依赖,配 .env,跑 `npm run build`
2. 后台起 Node: `HOST=127.0.0.1 nohup npm start &` (固定 listen :4444)
3. 申请 TLS: `sudo certbot --nginx -d ziyun.pudafo.com` (会写证书到标准路径)
4. 拷贝本目录的 nginx 配置到服务器,启用:
   ```bash
   sudo cp deploy/nginx.ziyun.pudafo.com.conf /etc/nginx/sites-available/
   sudo ln -s /etc/nginx/sites-available/ziyun.pudafo.com.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
5. 浏览器访问 `https://ziyun.pudafo.com/`,被中间件重定向到 `/init`,走三步向导
6. **首次部署完成 → admin 登录 → `/admin/settings/site-url` 把 `NEXT_PUBLIC_SITE_URL` 设为 `https://ziyun.pudafo.com`** (这一步不要手动改 .env)

## 配套文档

- `DEPLOY.md` (项目根) — 完整部署指南 + 自检清单 + 升级流程 + 踩坑
- `Up.zip` (项目根) — 部署用的源码包(已过滤 tests/.env/node_modules)
