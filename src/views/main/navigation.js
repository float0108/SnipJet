// 导航功能
import { emit } from '@tauri-apps/api/event';

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

      // 获取目标项目的数据
      const content = targetItem.getAttribute("data-content");
      const format = targetItem.getAttribute("data-format");
      const timestamp = targetItem.getAttribute("data-timestamp");
      const targetId = targetItem.id.replace("item-", "");

      console.log("目标项目数据:", { content, format, timestamp, targetId });

      // 使用 localStorage 传递大数据内容，避免 URL 长度限制
      const storageKey = `transfer-${targetId}`;
      localStorage.setItem(storageKey, content);

      // 发送事件给当前reader窗口，通知其刷新内容
      console.log("准备发送刷新事件");
      await emit("refresh-reader", {
        id: targetId,
        cacheKey: storageKey,
        format: format,
        timestamp: timestamp,
      });
      console.log("发送刷新reader窗口的事件成功");
    } else {
      console.log("没有更多项目可以导航");

      // 发送事件给当前reader窗口，通知其没有更多项目
      await emit("refresh-reader", {
        error: "没有更多项目可以导航",
      });
      console.log("发送没有更多项目的事件");
    }
  } catch (err) {
    console.error("处理导航事件失败:", err);

    // 发送事件给当前reader窗口，通知其导航失败
    try {
      await emit("refresh-reader", {
        error: "导航失败，请重试",
      });
      console.log("发送导航失败的事件");
    } catch (e) {
      console.error("发送事件失败:", e);
    }
  }
}

export { handleNavigation };
