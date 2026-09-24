// 首帧渲染前的同步引导：主题模式、界面字体/字号、界面缩放。
// 这三项都由设置窗口写入 localStorage，这里在 <head> 中同步读取并应用，
// 避免窗口打开后先按默认值渲染再跳变（切换窗口时的闪烁）。
//
// 该文件放在 public/ 下：必须作为同步脚本（非 module）在样式表之前执行，
// 打包器不会处理非 module 脚本，放到 public 才能原样输出到构建产物。
(function () {
  var root = document.documentElement;

  // 1) 主题：system 模式需要在此解析成明确的 light/dark，
  //    这样 CSS 只需维护 :root（浅色）与 [data-theme="dark"] 两份取值
  try {
    var mode = localStorage.getItem("snipjet.theme");
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (mode === "dark" || (mode === "system" && prefersDark)) {
      root.setAttribute("data-theme", "dark");
    }
  } catch (e) {}

  // 2) 界面字体与基础字号
  try {
    var family = localStorage.getItem("snipjet.font_family");
    if (family) root.style.setProperty("--font-family", family);
    var size = localStorage.getItem("snipjet.font_size");
    if (size) root.style.setProperty("--font-size-base", size + "px");
  } catch (e) {}

  // 3) 界面缩放
  try {
    var zoom = parseFloat(localStorage.getItem("snipjet.zoom_level"));
    if (zoom && zoom !== 1 && window.__TAURI__ && window.__TAURI__.webview) {
      window.__TAURI__.webview.getCurrentWebview().setZoom(zoom).catch(function () {});
    }
  } catch (e) {}
})();
