# Cuecut

Linux 优先的时间线视频剪辑原型。桌面端用 Electron，也可在浏览器里当本地 Web 应用运行。界面以中文为主，关键操作带英文。

名称、界面与文字样式均为原创，未使用第三方剪辑产品的商标或素材。

本项目以 MIT 许可开源，仓库：https://github.com/yellatiamo/cuecut

## 安装

### Debian / Ubuntu

```bash
sudo apt install ./cuecut_0.1.0_amd64.deb
# 依赖 ffmpeg；若未装: sudo apt install ffmpeg
```

安装包可从 GitHub Releases 或 Actions 产物下载。

### 从源码

```bash
npm install && npm start
```

`npm start` 启动 Electron；未打包时若本机 5173 端口空闲，主进程会自行拉起 Vite。开发时也可用 `npm run dev`。
