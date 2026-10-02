// 导航功能
import { emit } from '@tauri-apps/api/event';
import { getClipboardContent } from "../../services/tauri-api.js";
// 导航提示会由查看器窗口以 toast 形式展示，属于用户可见文案
import { t } from "../../utils/i18n.js";

// 当前 reader 正在使用的 transfer-* 键，切换条目时不能删
let currentReaderKey = null;

/**
 * 处理导航事件
 * @param {Object} payload - 导航事件数据
 * @param {string} payload.direction - 导航方向 ("previous" 或 "next")
 * @param {string} payload.currentId - 当前剪贴板项的ID
 * @param {HTMLElement} container - 剪贴板历史容器
 */
async function handleNavigation(payload, container) {
  try {
    const { direction, currentId } = payload;
    console.log("处理导航事件:", { direction, currentId });

    // 获取所有剪贴板项
    const items = container.querySelectorAll(".clipboard-item");
    let currentIndex = -1;

    // 找到当前项目的索引
    items.forEach((item, index) => {
      if (item.id === `item-${currentId}`) {
        currentIndex = index;
      }
    });

    console.log("当前项目索引:", currentIndex);

    // 计算目标索引
    let targetIndex = currentIndex;
    if (direction === "previous") {
      targetIndex = currentIndex + 1;
    } else if (direction === "next") {
      targetIndex = currentIndex - 1;
    }

    console.log("目标项目索引:", targetIndex);

    // 检查目标索引是否有效
    if (targetIndex >= 0 && targetIndex < items.length) {
      const targetItem = items[targetIndex];
      console.log("找到目标项目:", targetItem.id);

      // 获取目标项目的数据（完整内容按需从后端懒加载）
      const targetId = targetItem.id.replace("item-", "");
      const targetData = await getClipboardContent(targetId);
      if (!targetData) {
        await emit("refresh-reader", { error: t("navigation.notFound") });
        return;
      }
      const content = targetData.content || "";
      const format = targetItem.getAttribute("data-format");
      const timestamp = targetItem.getAttribute("data-timestamp");
      // 图片元数据
      const imageWidth = targetItem.getAttribute("data-image-width");
      const imageHeight = targetItem.getAttribute("data-image-height");
      const imageSize = targetItem.getAttribute("data-image-size");
      const imageFormat = targetItem.getAttribute("data-image-format");
      // 收藏状态
      const isFavorite = targetItem.classList.contains("is-favorite");

      console.log("目标项目数据:", { format, timestamp, targetId });

      // 使用 localStorage 传递大数据内容，避免 URL 长度限制
      const storageKey = `transfer-${targetId}`;
      // 先清掉其他 transfer-* 键：内容可能含敏感信息，不该在阅读器关闭后仍留盘，
      // 也避免写满配额；当前 reader 正在用的那个键要保留
      const keepKey = currentReaderKey || storageKey;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith("transfer-") && key !== keepKey) {
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.error("[navigate] 清理内容缓存失败:", e);
      }
      try {
        localStorage.setItem(storageKey, content);
        currentReaderKey = storageKey;
      } catch (e) {
        console.error("[navigate] 写入内容缓存失败:", e);
      }

      // 发送事件给当前reader窗口，通知其刷新内容
      console.log("准备发送刷新事件");
      const payload = {
        id: targetId,
        cacheKey: storageKey,
        format: format,
        timestamp: timestamp,
        isFavorite: isFavorite,
      };
      // 添加图片元数据
      if (imageWidth) payload.imageWidth = imageWidth;
      if (imageHeight) payload.imageHeight = imageHeight;
      if (imageSize) payload.imageSize = imageSize;
      if (imageFormat) payload.imageFormat = imageFormat;

      await emit("refresh-reader", payload);
      console.log("发送刷新reader窗口的事件成功");
    } else {
      console.log("没有更多项目可以导航");

      // 发送事件给当前reader窗口，通知其没有更多项目
      await emit("refresh-reader", {
        error: t("navigation.noMoreItems"),
      });
      console.log("发送没有更多项目的事件");
    }
  } catch (err) {
    console.error("处理导航事件失败:", err);

    // 发送事件给当前reader窗口，通知其导航失败
    try {
      await emit("refresh-reader", {
        error: t("navigation.failed"),
      });
      console.log("发送导航失败的事件");
    } catch (e) {
      console.error("发送事件失败:", e);
    }
  }
}

export { handleNavigation };
